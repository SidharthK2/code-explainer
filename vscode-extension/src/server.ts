import * as http from "http";
import * as crypto from "crypto";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { WebSocketServer, WebSocket } from "ws";
import type { Review } from "./review";
import type { AgentMessage, ExtensionMessage } from "./types";

export const PORT_FILE = path.join(os.homedir(), ".claude-reviewer-port");
export const TOKEN_FILE = path.join(os.homedir(), ".claude-reviewer-token");
/** Per-workspace endpoint files: one VS Code window per workspace, so the agent can target the right one. */
export const ENDPOINTS_DIR = path.join(os.homedir(), ".claude-reviewer", "endpoints");

export function endpointFileFor(workspaceRoot: string): string {
	const key = crypto.createHash("sha1").update(workspaceRoot).digest("hex");
	return path.join(ENDPOINTS_DIR, `${key}.json`);
}
const MAX_BODY_SIZE = 4 * 1024 * 1024; // 4MB — a review of a large diff can be sizeable

const SEVERITIES = new Set(["info", "attention", "risk"]);

function isHunk(h: unknown): boolean {
	if (!h || typeof h !== "object") return false;
	const x = h as Record<string, unknown>;
	return (
		typeof x.id === "number" &&
		typeof x.file === "string" &&
		typeof x.start === "number" &&
		typeof x.end === "number" &&
		typeof x.title === "string" &&
		typeof x.severity === "string" && SEVERITIES.has(x.severity) &&
		typeof x.what === "string" &&
		typeof x.why === "string" &&
		(x.check === undefined || typeof x.check === "string")
	);
}

export class ReviewServer {
	private httpServer: http.Server;
	private wss: WebSocketServer;
	private review: Review;
	private wsClients: Set<WebSocket> = new Set();
	private port = 0;
	private authToken: string;
	private onAgentMessage?: (msg: AgentMessage) => void;
	private workspaceRoot: string;
	private heartbeat: NodeJS.Timeout | undefined;

	constructor(review: Review, workspaceRoot: string) {
		this.review = review;
		this.workspaceRoot = workspaceRoot;
		this.authToken = crypto.randomBytes(32).toString("hex");
		this.httpServer = http.createServer(this.handleHttp.bind(this));
		this.wss = new WebSocketServer({
			server: this.httpServer,
			verifyClient: (info: { req: http.IncomingMessage }) => this.checkAuth(info.req),
		});
		this.wss.on("connection", this.handleWs.bind(this));
	}

	setMessageHandler(handler: (msg: AgentMessage) => void): void {
		this.onAgentMessage = handler;
	}

	async start(): Promise<number> {
		return new Promise((resolve) => {
			this.httpServer.listen(0, "127.0.0.1", () => {
				const addr = this.httpServer.address();
				this.port = typeof addr === "object" && addr ? addr.port : 0;
				// Global files: last window to activate wins (fallback for single-window use).
				// Per-workspace file: lets review.sh pick the window whose workspace matches the repo.
				this.writeEndpointFiles();
				this.heartbeat = setInterval(() => this.healEndpointFiles(), 15_000);
				resolve(this.port);
			});
		});
	}

	stop(): void {
		if (this.heartbeat) clearInterval(this.heartbeat);
		for (const ws of this.wsClients) ws.close();
		this.wss.close();
		this.httpServer.close();
		// Only remove files that still point at this instance. During a window reload the new
		// extension host may already have written its own files; those must survive.
		try { if (fs.readFileSync(PORT_FILE, "utf-8").trim() === String(this.port)) fs.unlinkSync(PORT_FILE); } catch {}
		try { if (fs.readFileSync(TOKEN_FILE, "utf-8").trim() === this.authToken) fs.unlinkSync(TOKEN_FILE); } catch {}
		if (this.workspaceRoot) {
			try {
				const f = endpointFileFor(this.workspaceRoot);
				const cur = JSON.parse(fs.readFileSync(f, "utf-8")) as { pid?: number };
				if (cur.pid === process.pid) fs.unlinkSync(f);
			} catch {}
		}
	}

	/** Write the endpoint files. Called on start and periodically, so a stale cleanup cannot leave a live server unreachable. */
	private writeEndpointFiles(): void {
		try {
			fs.writeFileSync(PORT_FILE, String(this.port), "utf-8");
			fs.writeFileSync(TOKEN_FILE, this.authToken, { encoding: "utf-8", mode: 0o600 });
		} catch (err) {
			console.error("[code-reviewer] Could not write port/token files:", err);
		}
		if (!this.workspaceRoot) return;
		try {
			fs.mkdirSync(ENDPOINTS_DIR, { recursive: true, mode: 0o700 });
			fs.writeFileSync(
				endpointFileFor(this.workspaceRoot),
				JSON.stringify({ port: this.port, token: this.authToken, root: this.workspaceRoot, pid: process.pid }),
				{ encoding: "utf-8", mode: 0o600 },
			);
		} catch (err) {
			console.error("[code-reviewer] Could not write endpoint file:", err);
		}
	}

	/** Re-create missing files. Leaves files that point at another live instance alone, except the per-workspace one, which is ours by definition. */
	private healEndpointFiles(): void {
		const globalMissing = !fs.existsSync(PORT_FILE) || !fs.existsSync(TOKEN_FILE);
		let mineMissing = false;
		if (this.workspaceRoot) {
			try {
				const cur = JSON.parse(fs.readFileSync(endpointFileFor(this.workspaceRoot), "utf-8")) as { pid?: number; port?: number };
				mineMissing = cur.port !== this.port;
			} catch {
				mineMissing = true;
			}
		}
		if (globalMissing || mineMissing) this.writeEndpointFiles();
	}

	stateMessage(): ExtensionMessage {
		const state = this.review.getState();
		return {
			type: "state",
			status: state.status,
			currentHunk: state.hunks[state.currentIndex]?.id ?? -1,
			totalHunks: state.hunks.length,
			reviewedCount: this.review.reviewedCount(),
		};
	}

	broadcastState(): void {
		this.broadcastToClients(this.stateMessage());
	}

	private broadcastToClients(msg: ExtensionMessage): void {
		const json = JSON.stringify(msg);
		for (const ws of this.wsClients) {
			if (ws.readyState === WebSocket.OPEN) ws.send(json);
		}
	}

	// ── Auth ──

	private checkAuth(req: http.IncomingMessage): boolean {
		const auth = req.headers["authorization"];
		if (auth === `Bearer ${this.authToken}`) return true;
		return req.headers["x-auth-token"] === this.authToken;
	}

	// ── HTTP ──

	private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
		res.setHeader("Content-Type", "application/json");

		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}
		if (!this.checkAuth(req)) {
			res.writeHead(401);
			res.end(JSON.stringify({ error: "Unauthorized" }));
			return;
		}

		const url = new URL(req.url || "/", `http://127.0.0.1:${this.port}`);

		if (req.method === "GET" && url.pathname === "/api/health") {
			res.writeHead(200);
			res.end(JSON.stringify({ status: "ok", workspaceRoot: this.workspaceRoot }));
		} else if (req.method === "GET" && url.pathname === "/api/state") {
			this.handleGetState(res);
		} else if (req.method === "POST" && url.pathname === "/api/message") {
			this.readBody(req, res, (body) => {
				let msg: unknown;
				try {
					msg = JSON.parse(body);
				} catch {
					res.writeHead(400);
					res.end(JSON.stringify({ error: "Invalid JSON" }));
					return;
				}
				const problem = this.validateAgentMessage(msg);
				if (problem) {
					res.writeHead(400);
					res.end(JSON.stringify({ error: problem }));
					return;
				}
				this.onAgentMessage?.(msg as AgentMessage);
				res.writeHead(200);
				res.end(JSON.stringify({ ok: true }));
			});
		} else {
			res.writeHead(404);
			res.end(JSON.stringify({ error: "Not found" }));
		}
	}

	private handleGetState(res: http.ServerResponse): void {
		const state = this.review.getState();
		const current = state.hunks[state.currentIndex] ?? null;
		res.writeHead(200);
		res.end(
			JSON.stringify({
				...this.stateMessage(),
				title: state.title,
				base: state.base,
				currentIndex: state.currentIndex,
				hunk: current,
				hunks: state.hunks.map(({ id, file, start, end, title, severity, reviewed, resolved }) => ({
					id, file, start, end, title, severity, reviewed, resolved,
				})),
			}),
		);
	}

	// ── WebSocket ──

	private handleWs(ws: WebSocket): void {
		this.wsClients.add(ws);
		ws.on("message", (data) => {
			try {
				const msg = JSON.parse(data.toString());
				const problem = this.validateAgentMessage(msg);
				if (problem) {
					ws.send(JSON.stringify({ type: "error", error: problem }));
					return;
				}
				this.onAgentMessage?.(msg as AgentMessage);
			} catch (err) {
				console.error("[code-reviewer] Invalid WS message:", err);
			}
		});
		ws.on("close", () => this.wsClients.delete(ws));
		ws.send(JSON.stringify(this.stateMessage()));
	}

	// ── Validation (returns a problem description, or null when valid) ──

	private validateAgentMessage(msg: unknown): string | null {
		if (!msg || typeof msg !== "object") return "Message must be an object";
		const m = msg as Record<string, unknown>;
		switch (m.type) {
			case "set_review": {
				if (typeof m.title !== "string") return "set_review: 'title' must be a string";
				if (typeof m.summary !== "string") return "set_review: 'summary' must be a string";
				if (m.base !== undefined && (typeof m.base !== "string" || !/^[\w./~^@-]+$/.test(m.base))) return "set_review: 'base' must be a git ref or sha";
				if (!Array.isArray(m.hunks)) return "set_review: 'hunks' must be an array";
				const bad = (m.hunks as unknown[]).findIndex((h) => !isHunk(h));
				if (bad !== -1) return `set_review: hunks[${bad}] is missing a required field (id, file, start, end, title, severity, what, why) or has an invalid severity`;
				const ids = new Set((m.hunks as Array<{ id: number }>).map((h) => h.id));
				if (ids.size !== (m.hunks as unknown[]).length) return "set_review: hunk ids must be unique";
				return null;
			}
			case "goto":
				return typeof m.hunkId === "number" ? null : "goto: 'hunkId' must be a number";
			case "update_hunk":
				if (typeof m.id !== "number") return "update_hunk: 'id' must be a number";
				if (!m.hunk || typeof m.hunk !== "object") return "update_hunk: 'hunk' must be an object";
				return null;
			case "remove_hunks":
				return Array.isArray(m.ids) ? null : "remove_hunks: 'ids' must be an array";
			case "resolve":
				if (typeof m.hunkId !== "number") return "resolve: 'hunkId' must be a number";
				if (m.text !== undefined && typeof m.text !== "string") return "resolve: 'text' must be a string";
				return null;
			case "close":
				return null;
			default:
				return `Unknown message type '${String(m.type)}'`;
		}
	}

	// ── Helpers ──

	private readBody(req: http.IncomingMessage, res: http.ServerResponse, cb: (body: string) => void): void {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
			if (body.length > MAX_BODY_SIZE) {
				res.writeHead(413);
				res.end(JSON.stringify({ error: "Request body too large" }));
				req.destroy();
			}
		});
		req.on("end", () => {
			if (!res.writableEnded) cb(body);
		});
	}
}
