// @ts-check
(function () {
	const vscode = acquireVsCodeApi();

	/** @type {{ title: string, summary: string, hunks: any[], currentHunk: number, status: string, workspaceRoot: string }} */
	let state = { title: "", summary: "", hunks: [], currentHunk: -1, status: "idle", workspaceRoot: "" };

	const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

	function escapeHtml(s) {
		return String(s)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	/** Small markdown subset: paragraphs, bullets, bold, italics, inline code. */
	function simpleMarkdown(text) {
		const lines = escapeHtml(text || "").split(/\r?\n/);
		let html = "";
		let inList = false;
		for (const raw of lines) {
			const line = raw.trim();
			const bullet = /^[-*]\s+(.*)$/.exec(line);
			if (bullet) {
				if (!inList) { html += "<ul>"; inList = true; }
				html += `<li>${inline(bullet[1])}</li>`;
				continue;
			}
			if (inList) { html += "</ul>"; inList = false; }
			if (line) html += `<p>${inline(line)}</p>`;
		}
		if (inList) html += "</ul>";
		return html;
	}

	function inline(s) {
		return s
			.replace(/`([^`]+)`/g, "<code>$1</code>")
			.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
			.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
	}

	function relPath(file) {
		const root = state.workspaceRoot;
		if (root && file.startsWith(root)) {
			return file.slice(root.length).replace(/^[\\/]/, "");
		}
		return file;
	}

	function render() {
		const idle = $("idle-view");
		const active = $("active-view");
		const closed = $("closed-view");
		idle.style.display = state.status === "idle" ? "" : "none";
		active.style.display = state.status === "active" ? "" : "none";
		closed.style.display = state.status === "closed" ? "" : "none";
		if (state.status !== "active") return;

		$("review-title").textContent = state.title;
		$("summary").innerHTML = simpleMarkdown(state.summary);

		const total = state.hunks.length;
		const reviewed = state.hunks.filter((h) => h.reviewed).length;
		const flagged = state.hunks.filter((h) => h.flagged).length;
		$("progress-fill").style.width = total ? `${Math.round((reviewed / total) * 100)}%` : "0%";
		$("progress-text").textContent =
			`${reviewed}/${total} reviewed` + (flagged ? ` · ${flagged} flagged` : "");

		const idx = state.hunks.findIndex((h) => h.id === state.currentHunk);
		/** @type {HTMLButtonElement} */ ($("btn-prev")).disabled = idx <= 0;
		/** @type {HTMLButtonElement} */ ($("btn-next")).disabled = idx === -1 || idx >= total - 1;

		renderList();
	}

	function renderList() {
		const list = $("hunk-list");
		list.innerHTML = "";
		let lastFile = null;

		for (const hunk of state.hunks) {
			if (hunk.file !== lastFile) {
				const fileLi = document.createElement("li");
				fileLi.className = "file-header";
				fileLi.textContent = relPath(hunk.file);
				fileLi.title = hunk.file;
				list.appendChild(fileLi);
				lastFile = hunk.file;
			}

			const li = document.createElement("li");
			li.className = "hunk" +
				(hunk.id === state.currentHunk ? " current" : "") +
				(hunk.reviewed ? " reviewed" : "") +
				(hunk.flagged ? " flagged" : "") +
				(hunk.resolved ? " resolved" : "");

			const check = document.createElement("button");
			check.className = "check";
			check.title = hunk.reviewed ? "Mark as not reviewed" : "Mark as reviewed";
			check.innerHTML = hunk.reviewed
				? '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M13.5 3.5L6 11 2.5 7.5l1-1L6 9l6.5-6.5z"/></svg>'
				: "";
			check.addEventListener("click", (e) => {
				e.stopPropagation();
				vscode.postMessage({ type: "toggle_reviewed", hunkId: hunk.id });
			});

			const sev = document.createElement("span");
			sev.className = `sev sev-${hunk.severity}`;
			sev.title = hunk.severity;

			const body = document.createElement("div");
			body.className = "hunk-body";
			const title = document.createElement("div");
			title.className = "hunk-title";
			title.textContent = hunk.title;
			const meta = document.createElement("div");
			meta.className = "hunk-meta";
			const range = hunk.start === hunk.end ? `L${hunk.start}` : `L${hunk.start}–${hunk.end}`;
			let status = "";
			if (hunk.resolved) status = " · fixed";
			else if (hunk.flagged) status = " · flagged";
			meta.textContent = `${range}${hunk.kind === "deleted" ? " · deletion" : ""}${status}`;
			body.appendChild(title);
			body.appendChild(meta);

			li.appendChild(check);
			li.appendChild(sev);
			li.appendChild(body);
			li.addEventListener("click", () => vscode.postMessage({ type: "goto_hunk", hunkId: hunk.id }));
			list.appendChild(li);
		}

		const current = list.querySelector(".hunk.current");
		if (current) current.scrollIntoView({ block: "nearest" });
	}

	$("btn-prev").addEventListener("click", () => vscode.postMessage({ type: "prev" }));
	$("btn-next").addEventListener("click", () => vscode.postMessage({ type: "next" }));
	$("btn-finish").addEventListener("click", () => vscode.postMessage({ type: "finish" }));
	$("btn-close").addEventListener("click", () => vscode.postMessage({ type: "close" }));

	window.addEventListener("message", (event) => {
		const msg = event.data;
		if (msg && msg.type === "update") {
			state = msg;
			render();
		}
	});

	render();
})();
