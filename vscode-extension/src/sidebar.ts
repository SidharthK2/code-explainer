import * as vscode from "vscode";
import type { FromWebviewMessage, ToWebviewMessage } from "./types";
import type { ReviewState } from "./review";

export class SidebarProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "codeReviewer.sidebar";

	private view?: vscode.WebviewView;
	private onMessage?: (msg: FromWebviewMessage) => void | Promise<void>;
	private lastState?: ReviewState;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly workspaceRoot: string,
	) {}

	setMessageHandler(handler: (msg: FromWebviewMessage) => void | Promise<void>): void {
		this.onMessage = handler;
	}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
		};
		webviewView.webview.html = this.getHtml(webviewView.webview);
		webviewView.webview.onDidReceiveMessage((msg: FromWebviewMessage) => this.onMessage?.(msg));
		if (this.lastState) this.updateState(this.lastState);
	}

	reveal(): void {
		if (this.view) this.view.show?.(true);
		else vscode.commands.executeCommand("codeReviewer.sidebar.focus");
	}

	postMessage(msg: ToWebviewMessage): void {
		this.view?.webview.postMessage(msg);
	}

	updateState(state: ReviewState): void {
		this.lastState = state;
		this.postMessage({
			type: "update",
			title: state.title,
			summary: state.summary,
			hunks: state.hunks,
			currentHunk: state.hunks[state.currentIndex]?.id ?? -1,
			status: state.status,
			workspaceRoot: this.workspaceRoot,
		});
	}

	private getHtml(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "sidebar.js"));
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "sidebar.css"));
		const nonce = getNonce();

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy"
		content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" href="${styleUri}">
	<title>Code Review</title>
</head>
<body>
	<div id="idle-view">
		<div class="header"><span class="header-label">CODE REVIEW</span></div>
		<div class="idle-hero">
			<p class="idle-text">No review loaded</p>
			<p class="idle-hint">Run <code>/review</code> in your coding agent after it edits code</p>
		</div>
	</div>

	<div id="active-view" style="display:none;">
		<div class="sticky-top">
			<div class="header">
				<span class="header-label">CODE REVIEW</span>
				<div class="header-actions">
					<button id="btn-close" class="icon-btn" title="Close review">
						<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
							<path d="M8 8.707l3.646 3.647.708-.708L8.707 8l3.647-3.646-.708-.708L8 7.293 4.354 3.646l-.708.708L7.293 8l-3.647 3.646.708.708L8 8.707z"/>
						</svg>
					</button>
				</div>
			</div>
			<h2 id="review-title"></h2>
			<div id="summary" class="summary"></div>

			<div class="progress-row">
				<div class="progress-bar"><div id="progress-fill" class="progress-fill"></div></div>
				<span id="progress-text" class="counter"></span>
			</div>

			<div class="controls">
				<button id="btn-prev" title="Previous hunk (Ctrl+Shift+[)">
					<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M10 2L4 8l6 6V2z"/></svg>
					Prev
				</button>
				<button id="btn-next" title="Next hunk, marks current as reviewed (Ctrl+Shift+])">
					Next
					<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M6 2l6 6-6 6V2z"/></svg>
				</button>
				<button id="btn-finish" class="finish-btn" title="Hand the review back to the agent">Finish review</button>
			</div>
		</div>

		<div class="hunk-list">
			<ul id="hunk-list"></ul>
		</div>
	</div>

	<div id="closed-view" style="display:none;">
		<div class="header"><span class="header-label">CODE REVIEW</span></div>
		<div class="idle-hero">
			<p class="idle-text">Review closed</p>
			<p class="idle-hint">Ask your agent for another <code>/review</code> when it has new changes</p>
		</div>
	</div>

	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}

function getNonce(): string {
	let text = "";
	const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
	return text;
}
