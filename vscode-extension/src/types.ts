// ── Review data ──

export type Severity = "info" | "attention" | "risk";

/** How the hunk relates to HEAD. "deleted" hunks anchor to the line below the removed code. */
export type HunkKind = "added" | "modified" | "deleted";

export interface Hunk {
	id: number;
	/** Absolute path in the working tree (relative paths are resolved against the workspace root). */
	file: string;
	/** 1-based line numbers on the working-tree (modified) side of the diff. */
	start: number;
	end: number;
	kind?: HunkKind;
	title: string;
	severity: Severity;
	/** What the change does. Markdown, factual. */
	what: string;
	/** Why it was likely done. Markdown. */
	why: string;
	/** What a human should verify. Markdown. Empty for pure info notes. */
	check: string;
}

export interface HunkState {
	reviewed: boolean;
	/** The agent fixed this hunk after the user asked in chat. */
	resolved: boolean;
}

export type ReviewStatus = "idle" | "active" | "closed";

// ── Agent → Extension messages (HTTP + WS) ──

export interface SetReviewMessage {
	type: "set_review";
	title: string;
	/** Markdown summary of the whole change set. */
	summary: string;
	/** Git ref or sha the working tree is compared against. Default "HEAD". Shown on the left side of the diff. */
	base?: string;
	hunks: Hunk[];
}

export interface GotoMessage {
	type: "goto";
	hunkId: number;
}

export interface UpdateHunkMessage {
	type: "update_hunk";
	id: number;
	hunk: Partial<Omit<Hunk, "id">>;
}

export interface RemoveHunksMessage {
	type: "remove_hunks";
	ids: number[];
}

/** Agent marks a hunk as fixed; optional one-line note is shown under the reviewer note. */
export interface ResolveMessage {
	type: "resolve";
	hunkId: number;
	text?: string;
}

export interface CloseMessage {
	type: "close";
}

export type AgentMessage =
	| SetReviewMessage
	| GotoMessage
	| UpdateHunkMessage
	| RemoveHunksMessage
	| ResolveMessage
	| CloseMessage;

// ── Extension → Agent messages ──

export interface StateMessage {
	type: "state";
	status: ReviewStatus;
	currentHunk: number;
	totalHunks: number;
	reviewedCount: number;
}

export type ExtensionMessage = StateMessage;

// ── Extension ↔ Webview messages ──

export type HunkView = Hunk & HunkState;

export interface WebviewUpdateMessage {
	type: "update";
	title: string;
	summary: string;
	hunks: HunkView[];
	currentHunk: number;
	status: ReviewStatus;
	workspaceRoot: string;
}

export type ToWebviewMessage = WebviewUpdateMessage;

export interface WebviewGotoHunkMessage {
	type: "goto_hunk";
	hunkId: number;
}

export interface WebviewNextMessage {
	type: "next";
}

export interface WebviewPrevMessage {
	type: "prev";
}

export interface WebviewToggleReviewedMessage {
	type: "toggle_reviewed";
	hunkId: number;
}

export interface WebviewCloseMessage {
	type: "close";
}

export type FromWebviewMessage =
	| WebviewGotoHunkMessage
	| WebviewNextMessage
	| WebviewPrevMessage
	| WebviewToggleReviewedMessage
	| WebviewCloseMessage;
