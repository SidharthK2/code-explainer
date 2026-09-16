import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";
import type { Hunk } from "./types";

/** Left side of the diff: the file as committed at HEAD. */
export const GIT_HEAD_SCHEME = "codeReviewerGit";
/** Right side for files deleted in the working tree. */
export const EMPTY_SCHEME = "codeReviewerEmpty";

function git(cwd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
	return new Promise((resolve) => {
		execFile("git", args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
			resolve({ ok: !err, out: stdout ?? "" });
		});
	});
}

async function repoRoot(dir: string): Promise<string | undefined> {
	const r = await git(dir, ["rev-parse", "--show-toplevel"]);
	return r.ok ? r.out.trim() : undefined;
}

export class GitHeadContentProvider implements vscode.TextDocumentContentProvider {
	async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
		const file = uri.fsPath;
		const root = await repoRoot(path.dirname(file));
		if (!root) return "";
		const rel = path.relative(root, file).split(path.sep).join("/");
		const ref = uri.query || "HEAD";
		const r = await git(root, ["show", `${ref}:${rel}`]);
		// A file that does not exist at the base is an addition; show an empty left side.
		return r.ok ? r.out : "";
	}
}

export class EmptyContentProvider implements vscode.TextDocumentContentProvider {
	provideTextDocumentContent(): string {
		return "";
	}
}

/** The URI comment threads and decorations attach to: the working file, or the empty stand-in for deleted files. */
export function modifiedSideUri(file: string): vscode.Uri {
	const right = vscode.Uri.file(file);
	return fs.existsSync(file) ? right : right.with({ scheme: EMPTY_SCHEME });
}

export function hunkRange(hunk: Hunk): vscode.Range {
	const start = Math.max(0, hunk.start - 1);
	const end = Math.max(start, hunk.end - 1);
	return new vscode.Range(start, 0, end, Number.MAX_SAFE_INTEGER);
}

/**
 * Open the side-by-side diff (HEAD vs working tree) for a hunk's file and reveal the hunk.
 * Returns the editor for the modified side when VS Code exposes it.
 */
export async function openHunkDiff(hunk: Hunk, base = "HEAD"): Promise<vscode.TextEditor | undefined> {
	const right = modifiedSideUri(hunk.file);
	const left = vscode.Uri.file(hunk.file).with({ scheme: GIT_HEAD_SCHEME, query: base });
	const shortBase = /^[0-9a-f]{40}$/.test(base) ? base.slice(0, 8) : base;
	const title = `${path.basename(hunk.file)} (${shortBase} ↔ Working Tree)`;
	const range = hunkRange(hunk);

	await vscode.commands.executeCommand("vscode.diff", left, right, title, {
		preview: false,
		preserveFocus: true,
		selection: new vscode.Range(range.start, range.start),
	} satisfies vscode.TextDocumentShowOptions);

	const editor = vscode.window.visibleTextEditors.find(
		(e) => e.document.uri.toString() === right.toString(),
	);
	editor?.revealRange(range, vscode.TextEditorRevealType.InCenter);
	return editor;
}
