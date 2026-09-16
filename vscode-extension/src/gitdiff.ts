import * as path from "path";
import { execFile } from "child_process";
import type { HunkKind } from "./types";

/** A change region computed by the extension from git. Ranges are working-tree (new side) lines, 1-based. */
export interface DiffHunk {
	id: number;
	/** Absolute path in the working tree. */
	file: string;
	/** Path relative to the repo root, forward slashes. */
	relPath: string;
	kind: HunkKind;
	/** First and last changed line on the new side. For a pure deletion both equal the line below the removed code. */
	start: number;
	end: number;
	/** Lines added and removed in this hunk. */
	added: number;
	removed: number;
	/** The hunk as unified diff text (header plus lines), for the agent to read. */
	patch: string;
}

export interface DiffResult {
	base: string;
	repoRoot: string;
	hunks: DiffHunk[];
	/** Files skipped because git marks them binary. */
	binaryFiles: string[];
}

function git(cwd: string, args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
	return new Promise((resolve) => {
		execFile("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
			resolve({ ok: !error, out: stdout ?? "", err: stderr ?? "" });
		});
	});
}

export async function repoRootOf(dir: string): Promise<string | undefined> {
	const r = await git(dir, ["rev-parse", "--show-toplevel"]);
	return r.ok ? r.out.trim() : undefined;
}

/**
 * Parse `git diff` output (unified, any context) into hunks with exact new-side line ranges.
 * Files are visited in the order git prints them (path order).
 */
export function parseUnifiedDiff(text: string, repoRoot: string, startId = 1): { hunks: DiffHunk[]; binaryFiles: string[] } {
	const hunks: DiffHunk[] = [];
	const binaryFiles: string[] = [];
	const lines = text.split("\n");
	let id = startId;

	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (!line.startsWith("diff --git ")) { i++; continue; }

		// File header block: read until first @@ or next diff --git
		let oldPath: string | undefined;
		let newPath: string | undefined;
		let isBinary = false;
		let fileAdded = false;
		let fileDeleted = false;
		i++;
		while (i < lines.length && !lines[i].startsWith("@@ ") && !lines[i].startsWith("diff --git ")) {
			const h = lines[i];
			if (h.startsWith("--- ")) oldPath = h.slice(4).trim();
			else if (h.startsWith("+++ ")) newPath = h.slice(4).trim();
			else if (h.startsWith("Binary files") || h.startsWith("GIT binary patch")) isBinary = true;
			else if (h.startsWith("new file mode")) fileAdded = true;
			else if (h.startsWith("deleted file mode")) fileDeleted = true;
			i++;
		}

		const strip = (p: string | undefined): string | undefined => {
			if (!p || p === "/dev/null") return undefined;
			return p.replace(/^[ab]\//, "");
		};
		const rel = strip(newPath) ?? strip(oldPath);
		if (!rel) continue;
		const abs = path.join(repoRoot, ...rel.split("/"));
		if (isBinary) { binaryFiles.push(abs); continue; }
		if (newPath === "/dev/null") fileDeleted = true;
		if (oldPath === "/dev/null") fileAdded = true;

		// Hunks
		while (i < lines.length && lines[i].startsWith("@@ ")) {
			const header = lines[i];
			const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header);
			if (!m) { i++; continue; }
			let newLine = parseInt(m[3], 10);
			const newCount = m[4] === undefined ? 1 : parseInt(m[4], 10);
			if (newCount === 0) newLine = newLine + 1; // git reports the line *before* a pure deletion
			const body: string[] = [header];
			let first = -1;
			let last = -1;
			let added = 0;
			let removed = 0;
			let deletionAnchor = -1;
			i++;
			while (i < lines.length && !lines[i].startsWith("@@ ") && !lines[i].startsWith("diff --git ")) {
				const l = lines[i];
				if (l.startsWith("\\")) { body.push(l); i++; continue; } // "\ No newline at end of file"
				body.push(l);
				if (l.startsWith("+")) {
					added++;
					if (first === -1) first = newLine;
					last = newLine;
					newLine++;
				} else if (l.startsWith("-")) {
					removed++;
					if (deletionAnchor === -1) deletionAnchor = newLine;
				} else {
					// context line (starts with space) or empty trailing line
					if (l === "" && i === lines.length - 1) { i++; continue; }
					newLine++;
				}
				i++;
			}
			if (added === 0 && removed === 0) continue;

			let kind: HunkKind = fileAdded ? "added" : fileDeleted ? "deleted" : "modified";
			let start: number;
			let end: number;
			if (first === -1) {
				// pure deletion within a surviving file: anchor to the line below the removed block
				kind = fileDeleted ? "deleted" : "deleted";
				start = end = Math.max(1, deletionAnchor === -1 ? newLine : deletionAnchor);
			} else {
				start = first;
				end = last;
			}
			hunks.push({ id: id++, file: abs, relPath: rel, kind, start, end, added, removed, patch: body.join("\n") });
		}
	}
	return { hunks, binaryFiles };
}

/**
 * Compute the review hunks for the working tree vs `base`, including untracked files as additions.
 * Hunks are in file-path order, top to bottom within a file — the order a reviewer reads a PR.
 */
export async function computeDiff(workspaceRoot: string, base: string): Promise<DiffResult> {
	const repoRoot = (await repoRootOf(workspaceRoot)) ?? workspaceRoot;

	const tracked = await git(repoRoot, ["diff", base, "--no-color", "--no-ext-diff", "-U3", "--", "."]);
	if (!tracked.ok) throw new Error(tracked.err.trim() || `git diff ${base} failed`);
	const parsed = parseUnifiedDiff(tracked.out, repoRoot);
	const hunks = parsed.hunks;
	const binaryFiles = parsed.binaryFiles;

	const untracked = await git(repoRoot, ["ls-files", "--others", "--exclude-standard", "--", "."]);
	if (untracked.ok) {
		const files = untracked.out.split("\n").map((s) => s.trim()).filter(Boolean).sort();
		for (const rel of files) {
			const r = await git(repoRoot, ["diff", "--no-color", "--no-ext-diff", "--no-index", "-U3", "--", "/dev/null", rel]);
			// --no-index exits 1 when files differ; that is the normal case.
			if (!r.out) continue;
			const p = parseUnifiedDiff(r.out, repoRoot, hunks.length + 1);
			for (const h of p.hunks) hunks.push({ ...h, kind: "added" });
			binaryFiles.push(...p.binaryFiles);
		}
	}

	// Path order, then position. Renumber ids after the sort so ids follow reading order.
	hunks.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : a.start - b.start));
	hunks.forEach((h, idx) => { h.id = idx + 1; });

	return { base, repoRoot, hunks, binaryFiles };
}
