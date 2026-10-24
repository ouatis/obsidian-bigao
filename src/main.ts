import { Notice, Plugin, TFile } from 'obsidian';

import {
	DifferencesView,
	differencesViewType,
	ViewState,
} from './components/differences_view.ts';
import {
	BigaoPanelView,
	panelViewType,
} from './components/bigao_panel_view.ts';
import {
	closeSplitComparison,
	restoreComparisons,
	SerializedSplitComparison,
	snapshotComparisons,
	startSplitComparison,
} from './components/bigao_panel_commands.ts';
import { pickCompareFile } from './components/bigao_compare_file_modal.ts';
import { RiskyActionModal } from './components/modals/risky_action_modal.ts';
import { applyPalette } from './utils/palette.ts';
import { registerInlineDiffRuntime, scheduleInlineDiffRefresh } from './components/inline_diff.ts';
import { configurePluginId, namespacedId } from './ids.ts';
import { getStrings } from './i18n.ts';

export default class FileDiffPlugin extends Plugin {
	get fileDiffMergeWarningKey(): string {
		return namespacedId('merge-warning');
	}

	override onload(): void {
		configurePluginId(this.manifest?.id);
		const t = getStrings();

		applyPalette();
		registerInlineDiffRuntime(this);

		// Comparisons persist in plugin data; after a restart the layout is
		// rebuilt onto fresh leaf objects, so tracked pairs are re-resolved by
		// note path once the workspace exists.
		this.app.workspace.onLayoutReady(() => void this.restoreSplitComparisons());

		this.registerView(
			differencesViewType(),
			(leaf) => new DifferencesView(leaf)
		);
		this.registerView(
			panelViewType(),
			(leaf) => new BigaoPanelView(leaf, this.app)
		);

		this.addCommand({
			id: namespacedId('panel-on'),
			name: t.commandPanelVertical,
			callback: async () => {
				const opened = await startSplitComparison(this.app, 'vertical');
				await this.saveSplitComparisons();
				return opened;
			},
		});
		this.addCommand({
			id: namespacedId('panel-on-horizontal'),
			name: t.commandPanelHorizontal,
			callback: async () => {
				const opened = await startSplitComparison(this.app, 'horizontal');
				await this.saveSplitComparisons();
				return opened;
			},
		});
		this.addCommand({
			id: namespacedId('panel-off'),
			name: t.commandPanelOff,
			callback: async () => {
				const closedCount = closeSplitComparison(this.app);
				new Notice(
					closedCount > 0
						? t.noticePanelClosed
						: t.noticeNoComparisonPanes
				);
				await this.saveSplitComparisons();
			},
		});

		this.addCommand({
			id: namespacedId('compare'),
			name: t.commandCompare,
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
			id: namespacedId('compare-and-merge'),
			name: t.commandCompareAndMerge,
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
			id: namespacedId('find-sync-conflicts'),
			name: t.commandFindSyncConflicts,
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
		await this.saveSplitComparisons();
		this.app.workspace.detachLeavesOfType(differencesViewType());
		this.app.workspace.detachLeavesOfType(panelViewType());
	}

	/** Re-registers persisted pairs whose two panes are both still open. */
	private async restoreSplitComparisons(): Promise<void> {
		try {
			const state = (await this.loadData()) as
				| { comparisons?: SerializedSplitComparison[] }
				| null;
			const saved = state?.comparisons;
			if (!saved?.length) return;
			const restored = restoreComparisons(this.app, saved);
			if (restored > 0) scheduleInlineDiffRefresh(this.app, 0);
			await this.saveSplitComparisons();
		} catch (error) {
			console.error('比稿：恢复分屏对照失败', error);
		}
	}

	/** Persists the live comparisons; closed or repurposed panes are pruned. */
	async saveSplitComparisons(): Promise<void> {
		try {
			await this.saveData({ comparisons: snapshotComparisons(this.app) });
		} catch (error) {
			console.error('比稿：保存分屏对照失败', error);
		}
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
		// Closes all leaves (views) of the differences view type
		this.app.workspace.detachLeavesOfType(differencesViewType());

		// Opens a new leaf (view) of the differences view type
		const leaf = this.app.workspace.getLeaf(true);
		leaf.setViewState({
			type: differencesViewType(),
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
