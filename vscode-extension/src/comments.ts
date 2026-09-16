import * as vscode from "vscode";
import { hunkRange, modifiedSideUri } from "./diff";
import type { Hunk, HunkState, Severity } from "./types";

export const CONTROLLER_ID = "codeReviewer";

const SEVERITY_LABEL: Record<Severity, string> = {
	info: "info",
	attention: "attention",
	risk: "risk",
};

const SEVERITY_ICON: Record<Severity, string> = {
	info: "$(info)",
	attention: "$(warning)",
	risk: "$(error)",
};

function noteBody(hunk: Hunk, state: HunkState): vscode.MarkdownString {
	const md = new vscode.MarkdownString(undefined, true);
	md.isTrusted = false;
	const badge = `${SEVERITY_ICON[hunk.severity]} **${SEVERITY_LABEL[hunk.severity]}**`;
	const status = state.resolved ? " · fixed" : state.flagged ? " · flagged" : "";
	md.appendMarkdown(`### ${hunk.title}\n\n${badge}${status}\n\n`);
	md.appendMarkdown(`**What changed**\n\n${hunk.what.trim()}\n\n`);
	md.appendMarkdown(`**Why**\n\n${hunk.why.trim()}\n\n`);
	if (hunk.check && hunk.check.trim()) {
		md.appendMarkdown(`**Check**\n\n${hunk.check.trim()}\n`);
	}
	return md;
}

function plainComment(author: string, text: string, contextValue: string): vscode.Comment {
	const body = new vscode.MarkdownString(text, true);
	body.isTrusted = false;
	return {
		body,
		mode: vscode.CommentMode.Preview,
		author: { name: author },
		contextValue,
	};
}

/**
 * One comment thread per hunk, anchored on the modified side of the diff editor.
 * The first comment is the reviewer note; later comments are the user's questions or flags
 * and the agent's replies.
 */
export class ReviewComments {
	private controller: vscode.CommentController;
	private threads = new Map<number, vscode.CommentThread>();

	constructor() {
		this.controller = vscode.comments.createCommentController(CONTROLLER_ID, "Code Review");
		this.controller.options = {
			prompt: "Ask the agent a question, or flag this hunk for a fix",
			placeHolder: "Type here, then choose Ask or Flag",
		};
	}

	setReview(hunks: Hunk[], stateOf: (id: number) => HunkState, currentId: number | undefined): void {
		this.clear();
		for (const hunk of hunks) this.createThread(hunk, stateOf(hunk.id), hunk.id === currentId);
	}

	private createThread(hunk: Hunk, state: HunkState, active: boolean): void {
		const thread = this.controller.createCommentThread(modifiedSideUri(hunk.file), hunkRange(hunk), [
			{
				body: noteBody(hunk, state),
				mode: vscode.CommentMode.Preview,
				author: { name: "Reviewer" },
				contextValue: "reviewer-note",
			},
		]);
		thread.label = SEVERITY_LABEL[hunk.severity];
		thread.canReply = true;
		thread.contextValue = `hunk:${hunk.id}`;
		thread.collapsibleState = active
			? vscode.CommentThreadCollapsibleState.Expanded
			: vscode.CommentThreadCollapsibleState.Collapsed;
		thread.state = state.resolved
			? vscode.CommentThreadState.Resolved
			: vscode.CommentThreadState.Unresolved;
		this.threads.set(hunk.id, thread);
	}

	/** Expand the active hunk's thread and collapse the rest. */
	setActive(id: number): void {
		for (const [hid, thread] of this.threads) {
			thread.collapsibleState =
				hid === id
					? vscode.CommentThreadCollapsibleState.Expanded
					: vscode.CommentThreadCollapsibleState.Collapsed;
		}
	}

	/** Re-render the reviewer note and move the thread when the hunk's range or text changed. */
	update(hunk: Hunk, state: HunkState): void {
		const thread = this.threads.get(hunk.id);
		if (!thread) return;
		const [, ...rest] = thread.comments;
		thread.comments = [
			{ ...thread.comments[0], body: noteBody(hunk, state) },
			...rest,
		];
		thread.label = SEVERITY_LABEL[hunk.severity];
		thread.range = hunkRange(hunk);
		thread.state = state.resolved
			? vscode.CommentThreadState.Resolved
			: vscode.CommentThreadState.Unresolved;
	}

	addUserComment(id: number, text: string, kind: "question" | "flag"): void {
		const thread = this.threads.get(id);
		if (!thread) return;
		const prefix = kind === "flag" ? "$(tools) **Flag:** " : "$(question) ";
		thread.comments = [...thread.comments, plainComment("You", prefix + text, `user-${kind}`)];
		thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
	}

	addAgentReply(id: number, text: string): void {
		const thread = this.threads.get(id);
		if (!thread) return;
		thread.comments = [...thread.comments, plainComment("Agent", text, "agent-reply")];
		thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
	}

	remove(ids: number[]): void {
		for (const id of ids) {
			this.threads.get(id)?.dispose();
			this.threads.delete(id);
		}
	}

	hunkIdOf(thread: vscode.CommentThread): number | undefined {
		const m = /^hunk:(\d+)$/.exec(thread.contextValue ?? "");
		return m ? Number(m[1]) : undefined;
	}

	clear(): void {
		for (const thread of this.threads.values()) thread.dispose();
		this.threads.clear();
	}

	dispose(): void {
		this.clear();
		this.controller.dispose();
	}
}
