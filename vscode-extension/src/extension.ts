import * as vscode from "vscode";
import * as path from "path";
import { Review } from "./review";
import { ReviewServer } from "./server";
import { SidebarProvider } from "./sidebar";
import { ReviewComments } from "./comments";
import {
	EMPTY_SCHEME,
	EmptyContentProvider,
	GIT_HEAD_SCHEME,
	GitHeadContentProvider,
	hunkRange,
	openHunkDiff,
} from "./diff";
import { clearHighlights, disposeHighlights, markActiveHunk } from "./highlight";
import type { AgentMessage, FromWebviewMessage, Hunk } from "./types";

const ACTIVE_CONTEXT = "codeReviewer.reviewActive";

export function activate(context: vscode.ExtensionContext): void {
	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";

	const review = new Review();
	const server = new ReviewServer(review, workspaceRoot);
	const sidebar = new SidebarProvider(context.extensionUri, workspaceRoot);
	const comments = new ReviewComments();

	context.subscriptions.push(
		vscode.workspace.registerTextDocumentContentProvider(GIT_HEAD_SCHEME, new GitHeadContentProvider()),
		vscode.workspace.registerTextDocumentContentProvider(EMPTY_SCHEME, new EmptyContentProvider()),
		vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebar, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
	);

	vscode.commands.executeCommand("setContext", ACTIVE_CONTEXT, false);

	server.start().then((port) => {
		console.log(`[code-reviewer] Server listening on port ${port}`);
	});

	/** Agents may send workspace-relative paths; comment threads and diffs need absolute ones. */
	function absolutize(hunks: Hunk[]): Hunk[] {
		return hunks.map((h) =>
			path.isAbsolute(h.file) || !workspaceRoot ? h : { ...h, file: path.join(workspaceRoot, h.file) },
		);
	}

	let showGeneration = 0;
	async function showHunk(hunk: Hunk): Promise<void> {
		const gen = ++showGeneration;
		try {
			const editor = await openHunkDiff(hunk, review.getBase());
			if (gen !== showGeneration) return;
			if (editor) markActiveHunk(editor, hunkRange(hunk));
			comments.setActive(hunk.id);
		} catch (err) {
			console.error("[code-reviewer] Failed to open diff:", err);
			vscode.window.showWarningMessage(`Code Review: could not open ${path.basename(hunk.file)}`);
		}
	}

	// ── Review events ──

	review.on("hunk", (hunk: Hunk) => {
		showHunk(hunk).catch(() => {});
	});

	review.on("review", () => {
		const state = review.getState();
		sidebar.updateState(state);
		server.broadcastState();
		// Keep thread headers (flagged / fixed) in sync with per-hunk state.
		for (const h of state.hunks) comments.update(h, h);
	});

	review.on("hunk_updated", (hunk: Hunk) => {
		comments.update(hunk, review.getHunkState(hunk.id));
		if (review.getCurrent()?.id === hunk.id) showHunk(hunk).catch(() => {});
	});

	review.on("status", (status: string) => {
		vscode.commands.executeCommand("setContext", ACTIVE_CONTEXT, status === "active");
		if (status !== "active") {
			clearHighlights();
			comments.clear();
		}
	});

	// ── Commands (thread title action, keybindings, palette) ──

	context.subscriptions.push(
		vscode.commands.registerCommand("codeReviewer.markReviewed", (thread: vscode.CommentThread) => {
			const id = comments.hunkIdOf(thread);
			if (id !== undefined) review.toggleReviewed(id);
		}),
		vscode.commands.registerCommand("codeReviewer.next", () => {
			review.next();
		}),
		vscode.commands.registerCommand("codeReviewer.prev", () => {
			review.prev();
		}),
		vscode.commands.registerCommand("codeReviewer.close", () => {
			review.close();
		}),
	);

	/**
	 * VS Code falls back to an inline diff when the editor is narrower than ~900px, which defeats
	 * the side-by-side review. Offer once to pin side-by-side; the user's choice is remembered.
	 */
	const SIDE_BY_SIDE_ASKED = "codeReviewer.sideBySideAsked";
	async function offerSideBySide(): Promise<void> {
		if (context.globalState.get<boolean>(SIDE_BY_SIDE_ASKED)) return;
		const cfg = vscode.workspace.getConfiguration("diffEditor");
		const renderSideBySide = cfg.get<boolean>("renderSideBySide", true);
		const inlineWhenLimited = cfg.get<boolean>("useInlineViewWhenSpaceIsLimited", true);
		if (renderSideBySide && !inlineWhenLimited) return;
		const choice = await vscode.window.showInformationMessage(
			"Code Review: VS Code may show diffs inline when the editor is narrow. Always render side-by-side?",
			"Always side-by-side",
			"Keep my settings",
		);
		if (choice === undefined) return; // dismissed: ask again next time
		await context.globalState.update(SIDE_BY_SIDE_ASKED, true);
		if (choice === "Always side-by-side") {
			await cfg.update("renderSideBySide", true, vscode.ConfigurationTarget.Global);
			await cfg.update("useInlineViewWhenSpaceIsLimited", false, vscode.ConfigurationTarget.Global);
		}
	}

	// ── Agent messages ──

	server.setMessageHandler((msg: AgentMessage) => {
		switch (msg.type) {
			case "set_review": {
				const hunks = absolutize(msg.hunks);
				review.setReview(msg.title, msg.summary, hunks, msg.base || "HEAD");
				comments.setReview(hunks, (id) => review.getHunkState(id), review.getCurrent()?.id);
				sidebar.reveal();
				offerSideBySide().catch(() => {});
				break;
			}
			case "goto":
				review.goto(msg.hunkId);
				break;
			case "update_hunk": {
				const patch = { ...msg.hunk };
				if (patch.file && !path.isAbsolute(patch.file) && workspaceRoot) {
					patch.file = path.join(workspaceRoot, patch.file);
				}
				review.updateHunk(msg.id, patch);
				break;
			}
			case "remove_hunks":
				comments.remove(msg.ids);
				review.removeHunks(msg.ids);
				break;
			case "resolve":
				comments.setFixNote(msg.hunkId, msg.text?.trim() || "Fixed.");
				review.resolve(msg.hunkId);
				break;
			case "close":
				review.close();
				break;
		}
	});

	// ── Webview messages ──

	sidebar.setMessageHandler((msg: FromWebviewMessage) => {
		switch (msg.type) {
			case "goto_hunk":
				review.goto(msg.hunkId);
				break;
			case "next":
				review.next();
				break;
			case "prev":
				review.prev();
				break;
			case "toggle_reviewed":
				review.toggleReviewed(msg.hunkId);
				break;
			case "close":
				review.close();
				break;
		}
	});

	// ── Cleanup ──

	context.subscriptions.push({
		dispose: () => {
			server.stop();
			comments.dispose();
			disposeHighlights();
		},
	});
}

export function deactivate(): void {}
