import { EventEmitter } from "events";
import type { Hunk, HunkState, HunkView, ReviewStatus } from "./types";

export interface ReviewState {
	title: string;
	summary: string;
	base: string;
	hunks: HunkView[];
	currentIndex: number;
	status: ReviewStatus;
}

const freshState = (): HunkState => ({ reviewed: false, flagged: false, resolved: false });

/**
 * Holds the review plan, per-hunk reviewer state, and the current position.
 *
 * Events:
 *   "hunk"    — current hunk changed (arg: Hunk)
 *   "review"  — plan or per-hunk state changed (arg: ReviewState)
 *   "status"  — status changed (arg: ReviewStatus)
 */
export class Review extends EventEmitter {
	private title = "";
	private summary = "";
	private base = "HEAD";
	private hunks: Hunk[] = [];
	private states = new Map<number, HunkState>();
	private currentIndex = -1;
	private status: ReviewStatus = "idle";

	getState(): ReviewState {
		return {
			title: this.title,
			summary: this.summary,
			base: this.base,
			hunks: this.hunks.map((h) => ({ ...h, ...(this.states.get(h.id) ?? freshState()) })),
			currentIndex: this.currentIndex,
			status: this.status,
		};
	}

	getCurrent(): Hunk | undefined {
		return this.hunks[this.currentIndex];
	}

	getHunk(id: number): Hunk | undefined {
		return this.hunks.find((h) => h.id === id);
	}

	getHunkState(id: number): HunkState {
		return this.states.get(id) ?? freshState();
	}

	// ── Lifecycle ──

	getBase(): string {
		return this.base;
	}

	setReview(title: string, summary: string, hunks: Hunk[], base = "HEAD"): void {
		this.title = title;
		this.summary = summary;
		this.base = base;
		this.hunks = hunks;
		this.states = new Map(hunks.map((h) => [h.id, freshState()]));
		this.currentIndex = hunks.length > 0 ? 0 : -1;
		this.status = hunks.length > 0 ? "active" : "idle";
		this.emit("status", this.status);
		this.emit("review", this.getState());
		if (this.currentIndex >= 0) this.emit("hunk", this.hunks[0]);
	}

	close(): void {
		if (this.status === "idle") return;
		this.status = "closed";
		this.emit("status", this.status);
		this.emit("review", this.getState());
	}

	// ── Navigation ──

	goto(id: number): boolean {
		const idx = this.hunks.findIndex((h) => h.id === id);
		if (idx === -1) return false;
		this.currentIndex = idx;
		this.emit("review", this.getState());
		this.emit("hunk", this.hunks[idx]);
		return true;
	}

	/** Advance to the next hunk. Leaving a hunk via "next" marks it reviewed. */
	next(): boolean {
		const cur = this.getCurrent();
		if (cur) this.setReviewed(cur.id, true, false);
		const nextIdx = this.currentIndex + 1;
		if (nextIdx >= this.hunks.length) {
			this.emit("review", this.getState());
			return false;
		}
		this.currentIndex = nextIdx;
		this.emit("review", this.getState());
		this.emit("hunk", this.hunks[nextIdx]);
		return true;
	}

	prev(): boolean {
		const prevIdx = this.currentIndex - 1;
		if (prevIdx < 0) return false;
		this.currentIndex = prevIdx;
		this.emit("review", this.getState());
		this.emit("hunk", this.hunks[prevIdx]);
		return true;
	}

	// ── Per-hunk state ──

	setReviewed(id: number, value: boolean, emit = true): void {
		const s = this.states.get(id);
		if (!s) return;
		s.reviewed = value;
		if (emit) this.emit("review", this.getState());
	}

	toggleReviewed(id: number): void {
		const s = this.states.get(id);
		if (!s) return;
		this.setReviewed(id, !s.reviewed);
	}

	flag(id: number): void {
		const s = this.states.get(id);
		if (!s) return;
		s.flagged = true;
		s.resolved = false;
		this.emit("review", this.getState());
	}

	resolve(id: number): void {
		const s = this.states.get(id);
		if (!s) return;
		s.flagged = false;
		s.resolved = true;
		this.emit("review", this.getState());
	}

	// ── Plan mutations ──

	updateHunk(id: number, patch: Partial<Omit<Hunk, "id">>): boolean {
		const idx = this.hunks.findIndex((h) => h.id === id);
		if (idx === -1) return false;
		this.hunks[idx] = { ...this.hunks[idx], ...patch, id };
		this.emit("review", this.getState());
		this.emit("hunk_updated", this.hunks[idx]);
		return true;
	}

	removeHunks(ids: number[]): void {
		const idSet = new Set(ids);
		const current = this.getCurrent();
		this.hunks = this.hunks.filter((h) => !idSet.has(h.id));
		for (const id of ids) this.states.delete(id);

		if (this.hunks.length === 0) {
			this.currentIndex = -1;
		} else if (current && !idSet.has(current.id)) {
			this.currentIndex = this.hunks.findIndex((h) => h.id === current.id);
		} else {
			this.currentIndex = Math.min(this.currentIndex, this.hunks.length - 1);
		}
		this.emit("review", this.getState());
	}

	// ── Counters ──

	reviewedCount(): number {
		let n = 0;
		for (const s of this.states.values()) if (s.reviewed) n++;
		return n;
	}

	flaggedIds(): number[] {
		return this.hunks.filter((h) => this.states.get(h.id)?.flagged).map((h) => h.id);
	}
}
