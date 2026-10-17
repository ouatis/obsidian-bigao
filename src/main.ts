import { Notice, Plugin, TFile } from 'obsidian';

import {
	DifferencesView,
	VIEW_TYPE_DIFFERENCES,
	ViewState,
} from './components/differences_view.ts';
import {
	BigaoPanelView,
	BIGAO_PANEL_VIEW,
} from './components/bigao_panel_view.ts';
import {
	closeSplitComparison,
	startSplitComparison,
} from './components/bigao_panel_commands.ts';
import { pickCompareFile } from './components/bigao_compare_file_modal.ts';
import { RiskyActionModal } from './components/modals/risky_action_modal.ts';
import { applyPalette } from './utils/palette.ts';
import { registerInlineDiffRuntime } from './components/inline_diff.ts';

export default class FileDiffPlugin extends Plugin {
	fileDiffMergeWarningKey = 'bigao-merge-warning';

	override onload(): void {
		applyPalette();
		registerInlineDiffRuntime(this);

		this.registerView(
			VIEW_TYPE_DIFFERENCES,
			(leaf) => new DifferencesView(leaf)
		);
		this.registerView(
			BIGAO_PANEL_VIEW,
			(leaf) => new BigaoPanelView(leaf, this.app)
		);

		this.addCommand({
			id: 'bigao-panel-on',
			name: '比稿：开启左右分屏对照',
			callback: () => startSplitComparison(this.app, 'vertical'),
		});
		this.addCommand({
			id: 'bigao-panel-on-horizontal',
			name: '比稿：开启上下分屏对照',
			callback: () => startSplitComparison(this.app, 'horizontal'),
		});
		this.addCommand({
			id: 'bigao-panel-off',
			name: '比稿：关闭分屏对照',
			callback: () => {
				const closedCount = closeSplitComparison(this.app);
				new Notice(
					closedCount > 0
						? '比稿：分屏对照已关闭'
						: '比稿：没有由比稿创建的分屏对照窗格'
				);
			},
		});

		this.addCommand({
			id: 'bigao-compare',
			name: '比稿：对比两篇',
			editorCallback: async () => {
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile == null) {
					return;
				}

				const compareFile = await this.getFileToCompare(activeFile);
				if (compareFile == null) {
					return;
				}

				this.openDifferencesView({
					file1: activeFile,
					file2: compareFile,
					showMergeOption: false,
				});
			},
		});

		this.addCommand({
			id: 'bigao-compare-and-merge',
			name: '比稿：对比并合并',
			editorCallback: async () => {
				// Show warning when this option is selected for the first time
				if (!localStorage.getItem(this.fileDiffMergeWarningKey)) {
					await this.showRiskyActionModal();
					if (!localStorage.getItem(this.fileDiffMergeWarningKey)) {
						return;
					}
				}

				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile == null) {
					return;
				}

				const compareFile = await this.getFileToCompare(activeFile);
				if (compareFile == null) {
					return;
				}

				this.openDifferencesView({
					file1: activeFile,
					file2: compareFile,
					showMergeOption: true,
				});
			},
		});

		this.addCommand({
			id: 'bigao-find-sync-conflicts',
			name: '比稿：查找同步冲突并合并',
			callback: async () => {
				// Show warning when this option is selected for the first time
				if (!localStorage.getItem(this.fileDiffMergeWarningKey)) {
					await this.showRiskyActionModal();
					if (!localStorage.getItem(this.fileDiffMergeWarningKey)) {
						return;
					}
				}

				const syncConflicts = this.findSyncConflicts();

				for await (const syncConflict of syncConflicts) {
					const continuePromise = new Promise<boolean>((resolve) => {
						this.openDifferencesView({
							file1: syncConflict.originalFile,
							file2: syncConflict.syncConflictFile,
							showMergeOption: true,
							continueCallback: async (shouldContinue: boolean) =>
								resolve(shouldContinue),
						});
					});

					const shouldContinue = await continuePromise;
					if (!shouldContinue) {
						break;
					}
				}
			},
		});
	}

	override async onunload(): Promise<void> {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_DIFFERENCES);
		this.app.workspace.detachLeavesOfType(BIGAO_PANEL_VIEW);
	}

	private getFileToCompare(activeFile: TFile): Promise<TFile | null> {
		return pickCompareFile(this.app, activeFile);
	}

	private showRiskyActionModal(): Promise<void> {
		return new Promise((resolve, reject) => {
			new RiskyActionModal({
				app: this.app,
				onAccept: async (e: Error | null) => {
					if (e) {
						reject(e);
					} else {
						localStorage.setItem(
							this.fileDiffMergeWarningKey,
							'true'
						);
						// Wait for the set item dispatch event to be processed
						await sleep(50);

						resolve();
					}
				},
			}).open();
		});
	}

	async openDifferencesView(state: ViewState): Promise<void> {
		// Closes all leafs (views) of the type VIEW_TYPE_DIFFERENCES
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_DIFFERENCES);

		// Opens a new leaf (view) of the type VIEW_TYPE_DIFFERENCES
		const leaf = this.app.workspace.getLeaf(true);
		leaf.setViewState({
			type: VIEW_TYPE_DIFFERENCES,
			active: true,
			state: state as unknown as Record<string, unknown>,
		});
		this.app.workspace.revealLeaf(leaf);
	}

	findSyncConflicts(): { originalFile: TFile; syncConflictFile: TFile }[] {
		const syncConflicts: {
			originalFile: TFile;
			syncConflictFile: TFile;
		}[] = [];

		const files = this.app.vault.getMarkdownFiles();

		for (const file of files) {
			if (file.name.includes('sync-conflict')) {
				const originalFileName = file.name.replace(
					/\.sync-conflict-\d{8}-\d{6}-[A-Z0-9]+/,
					''
				);
				const originalFile = files.find(
					(f) => f.name === originalFileName && (file.parent?.path ?? "") === (f.parent?.path ?? "")
				);

				if (originalFile) {
					syncConflicts.push({
						originalFile,
						syncConflictFile: file,
					});
				}
			}
		}

		return syncConflicts;
	}
}
