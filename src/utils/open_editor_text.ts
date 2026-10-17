import { App, MarkdownView, TFile } from 'obsidian';

export async function readOpenEditorText(app: App, file: TFile): Promise<string> {
	try {
		const activeView = app.workspace.getActiveViewOfType(MarkdownView);
		if (
			activeView?.file?.path === file.path &&
			typeof activeView.editor?.getValue === 'function'
		) {
			return activeView.editor.getValue();
		}

		for (const leaf of app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (
				view instanceof MarkdownView &&
				view.file?.path === file.path &&
				typeof view.editor?.getValue === 'function'
			) {
				return view.editor.getValue();
			}
		}
	} catch {
		// If an editor is closing or unavailable, compare the last saved content.
	}

	return app.vault.cachedRead(file);
}
