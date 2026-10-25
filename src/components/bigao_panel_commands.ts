import { App, MarkdownFileInfo, MarkdownView, Notice, WorkspaceLeaf } from 'obsidian';
import { panelViewType } from './bigao_panel_view.ts';
import { pickCompareFile } from './bigao_compare_file_modal.ts';
import { clearInlineDiffForLeaves, scheduleInlineDiffRefresh } from './inline_diff.ts';
import { getStrings } from '../i18n.ts';

type SplitDirection = 'horizontal' | 'vertical';

interface SplitComparison {
	comparePath: string;
	sourcePath?: string;
	direction: SplitDirection;
	sourceLeaf: WorkspaceLeaf;
}

/** Serializable form of a tracked comparison; panes are re-resolved on restore. */
export interface SerializedSplitComparison {
	comparePath: string;
	sourcePath?: string;
	direction: SplitDirection;
}

const splitComparisonWindow = window as Window & {
	__bigaoSplitComparisonsV1?: Map<WorkspaceLeaf, SplitComparison>;
};
const splitComparisons =
	(splitComparisonWindow.__bigaoSplitComparisonsV1 ??= new Map<
		WorkspaceLeaf,
		SplitComparison
	>());

function leafShowing(
	leaves: readonly WorkspaceLeaf[],
	path: string,
	exclude?: WorkspaceLeaf
): WorkspaceLeaf | undefined {
	return leaves.find(
		(leaf) =>
			leaf !== exclude &&
			leaf.view instanceof MarkdownView &&
			leaf.view.file?.path === path
	);
}

/**
 * Drops entries whose pane was closed or repurposed and returns what is worth
 * persisting: one entry per comparison note path.
 */
export function snapshotComparisons(app: App): SerializedSplitComparison[] {
	const markdownLeaves = app.workspace.getLeavesOfType('markdown');
	const snapshot: SerializedSplitComparison[] = [];
	const seenPaths = new Set<string>();
	for (const [leaf, comparison] of splitComparisons) {
		const stillTracked =
			markdownLeaves.includes(leaf) &&
			leaf.view instanceof MarkdownView &&
			leaf.view.file?.path === comparison.comparePath;
		if (!stillTracked) {
			splitComparisons.delete(leaf);
			continue;
		}
		if (seenPaths.has(comparison.comparePath)) continue;
		seenPaths.add(comparison.comparePath);
		snapshot.push({
			comparePath: comparison.comparePath,
			sourcePath: comparison.sourcePath,
			direction: comparison.direction,
		});
	}
	return snapshot;
}

/** Re-registers persisted comparisons onto panes that still show both notes. */
export function restoreComparisons(
	app: App,
	saved: readonly SerializedSplitComparison[]
): number {
	const leaves = app.workspace.getLeavesOfType('markdown');
	const trackedPaths = new Set(
		[...splitComparisons.values()].map((comparison) => comparison.comparePath)
	);
	let restored = 0;
	for (const entry of saved) {
		if (!entry.sourcePath || trackedPaths.has(entry.comparePath)) continue;
		const compareLeaf = leafShowing(leaves, entry.comparePath);
		if (!compareLeaf) continue;
		const sourceLeaf = leafShowing(leaves, entry.sourcePath, compareLeaf);
		if (!sourceLeaf) continue;
		splitComparisons.set(compareLeaf, {
			comparePath: entry.comparePath,
			sourcePath: entry.sourcePath,
			direction: entry.direction,
			sourceLeaf,
		});
		trackedPaths.add(entry.comparePath);
		restored += 1;
	}
	return restored;
}

export function closeSplitComparison(app: App): number {
	const workspace = app.workspace;
	const markdownLeaves = new Set(workspace.getLeavesOfType('markdown'));
	let closedCount = 0;
	for (const [leaf, comparison] of splitComparisons) {
		clearInlineDiffForLeaves(comparison.sourceLeaf, leaf);
		if (
			markdownLeaves.has(leaf) &&
			leaf.view instanceof MarkdownView &&
			leaf.view.file?.path === comparison.comparePath
		) {
			leaf.detach();
			closedCount += 1;
		}
	}
	splitComparisons.clear();
	return closedCount;
}

export async function startSplitComparison(
	app: App,
	direction: SplitDirection,
	sourceView?: MarkdownFileInfo
): Promise<boolean> {
	const t = getStrings();
	try {
		const workspace = app.workspace;
		const view = sourceView?.file
			? sourceView
			: workspace.getActiveViewOfType(MarkdownView);
		const targetFile = view?.file ?? workspace.getActiveFile();
		let sourceLeaf = view instanceof MarkdownView ? view.leaf : null;
		if (!sourceLeaf && targetFile) {
			sourceLeaf =
				workspace
					.getLeavesOfType('markdown')
					.find((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === targetFile.path) ??
				null;
		}
		if (!targetFile || !sourceLeaf) {
			new Notice(t.noticeOpenEditorFirst);
			return false;
		}
		const compareFile = await pickCompareFile(app, targetFile);
		if (!compareFile) return false;

		const previousLeaves = workspace.getLeavesOfType(panelViewType()).slice();
		const existing = [...splitComparisons].find(([leaf, comparison]) => {
			const sourcePath = comparison.sourcePath ??
				(sourceLeaf.view instanceof MarkdownView ? sourceLeaf.view.file?.path : undefined);
			return comparison.sourceLeaf === sourceLeaf &&
				comparison.direction === direction &&
				sourcePath === targetFile.path &&
				workspace.getLeavesOfType('markdown').includes(leaf) &&
				leaf.view instanceof MarkdownView &&
				leaf.view.file?.path === comparison.comparePath;
		});
		if (existing) {
			const [existingLeaf, comparison] = existing;
			try {
				await existingLeaf.openFile(compareFile, { active: true });
				if (
					!(existingLeaf.view instanceof MarkdownView) ||
					existingLeaf.view.file?.path !== compareFile.path
				) {
					throw new Error(t.errorPaneNotLoaded(compareFile.name));
				}
				comparison.comparePath = compareFile.path;
				comparison.sourcePath = targetFile.path;
				await workspace.revealLeaf(existingLeaf);
				scheduleInlineDiffRefresh(app);
				new Notice(
					direction === 'vertical'
						? t.noticeOpenedVertical(compareFile.name)
						: t.noticeOpenedHorizontal(compareFile.name)
				);
				return true;
			} catch (error) {
				console.error('比稿：更新分屏对照失败', error);
				new Notice(
					t.noticeOpenFailed(error instanceof Error ? error.message : String(error))
				);
				return false;
			}
		}
		let leaf: WorkspaceLeaf | null = null;
		try {
			leaf = workspace.createLeafBySplit(sourceLeaf, direction);
			await leaf.openFile(compareFile, { active: true });
			if (!(leaf.view instanceof MarkdownView) || leaf.view.file?.path !== compareFile.path) {
				throw new Error(t.errorPaneNotLoaded(compareFile.name));
			}
			await workspace.revealLeaf(leaf);
			splitComparisons.set(leaf, {
				comparePath: compareFile.path,
				sourcePath: targetFile.path,
				direction,
				sourceLeaf,
			});
			for (const previousLeaf of previousLeaves) {
				if (previousLeaf !== leaf) previousLeaf.detach();
			}
			scheduleInlineDiffRefresh(app);
			new Notice(
				direction === 'vertical'
					? t.noticeOpenedVertical(compareFile.name)
					: t.noticeOpenedHorizontal(compareFile.name)
			);
			return true;
		} catch (error) {
			leaf?.detach();
			throw error;
		}
	} catch (error) {
		console.error('比稿：准备分屏对照失败', error);
		new Notice(
			t.noticeOpenFailed(error instanceof Error ? error.message : String(error))
		);
		return false;
	}
}
