import * as vscode from "vscode";

/** Marks the active hunk in the modified side of the diff editor. No dimming: diff colours must stay readable. */
const activeHunkDecoration = vscode.window.createTextEditorDecorationType({
	isWholeLine: true,
	borderWidth: "0 0 0 3px",
	borderStyle: "solid",
	borderColor: new vscode.ThemeColor("focusBorder"),
	overviewRulerColor: new vscode.ThemeColor("focusBorder"),
	overviewRulerLane: vscode.OverviewRulerLane.Full,
});

export function markActiveHunk(editor: vscode.TextEditor, range: vscode.Range): void {
	for (const other of vscode.window.visibleTextEditors) {
		if (other !== editor) other.setDecorations(activeHunkDecoration, []);
	}
	editor.setDecorations(activeHunkDecoration, [range]);
}

export function clearHighlights(): void {
	for (const editor of vscode.window.visibleTextEditors) {
		editor.setDecorations(activeHunkDecoration, []);
	}
}

export function disposeHighlights(): void {
	activeHunkDecoration.dispose();
}
