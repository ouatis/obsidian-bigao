import { structuredPatch, type PatchOptions } from 'diff';
import { ItemView, TFile, ViewStateResult, WorkspaceLeaf } from 'obsidian';
import { Difference } from '../data/difference.ts';
import { FileDifferences } from '../data/file_differences.ts';
import {
	COMPARISON_DIFF_TIMEOUT_MS,
	MAX_COMPARISON_CHARACTERS,
	MAX_COMPARISON_DIFF_EDITS,
	MAX_COMPARISON_LINES,
} from '../data/comparison_limits.ts';
import { preventEmptyString } from '../utils/string_utils.ts';
import { diffWordsWithTokenizer } from '../utils/word_diff.ts';
import { namespacedId } from '../ids.ts';
import { getStrings } from '../i18n.ts';
import { readOpenEditorText } from '../utils/open_editor_text.ts';
import { ActionLine } from './action_line.ts';
import { DeleteFileModal } from './modals/delete_file_modal.ts';

export function differencesViewType(): string {
	return namespacedId('differences-view');
}

export interface ViewState {
	file1: TFile;
	file2: TFile;
	showMergeOption: boolean;
	continueCallback?: (shouldContinue: boolean) => Promise<void>;
}

export class DifferencesView extends ItemView {
	private updateRevision = 0;
	private comparisonError: string | null = null;
	private editorUpdateTimer: number | null = null;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);

		this.registerEvent(
			this.app.vault.on('modify', async (file) => {
				if (
					!this.state ||
					(file !== this.state.file1 && file !== this.state.file2)
				) {
					return;
				}

				this.clearEditorUpdateTimer();
				if (await this.updateState()) this.build();
			})
		);
		this.registerEvent(
			this.app.workspace.on('editor-change', (_editor, info) => {
				const file = info?.file;
				if (
					!file ||
					!this.state ||
					(file.path !== this.state.file1.path && file.path !== this.state.file2.path)
				) {
					return;
				}
				this.scheduleEditorUpdate();
			})
		);
	}

	private state!: ViewState;

	private file1Content = '';

	private file2Content = '';

	private fileDifferences!: FileDifferences;

	private file1Lines: string[] = [];

	private file2Lines: string[] = [];

	private wasDeleteModalShown = false;

	override getViewType(): string {
		return differencesViewType();
	}

	override getDisplayText(): string {
		if (this.state?.file1 && this.state?.file2) {
			return getStrings().viewDisplayNamePair(
				this.state.file1.name,
				this.state.file2.name
			);
		}
		return getStrings().viewDisplayName;
	}

	override async setState(
		state: ViewState,
		result: ViewStateResult
	): Promise<void> {
		this.clearEditorUpdateTimer();
		super.setState(state, result);
		this.state = state;

		if (await this.updateState()) this.build();
	}

	async onunload(): Promise<void> {
		this.updateRevision += 1;
		this.clearEditorUpdateTimer();
		this.state?.continueCallback?.(false);
	}

	override async onClose(): Promise<void> {
		this.updateRevision += 1;
		this.clearEditorUpdateTimer();
		this.state?.continueCallback?.(false);
	}

	private scheduleEditorUpdate(): void {
		this.updateRevision += 1;
		this.clearEditorUpdateTimer();
		this.editorUpdateTimer = window.setTimeout(() => {
			this.editorUpdateTimer = null;
			void this.refreshComparison();
		}, 180);
	}

	private clearEditorUpdateTimer(): void {
		if (this.editorUpdateTimer === null) return;
		window.clearTimeout(this.editorUpdateTimer);
		this.editorUpdateTimer = null;
	}

	private async refreshComparison(): Promise<void> {
		if (await this.updateState()) this.build();
	}

	private async updateState(): Promise<boolean> {
		const state = this.state;
		if (!state?.file1 || !state?.file2) return false;
		const revision = ++this.updateRevision;

		try {
			const [file1Content, file2Content] = await Promise.all([
				readOpenEditorText(this.app, state.file1),
				readOpenEditorText(this.app, state.file2),
			]);
			if (revision !== this.updateRevision || state !== this.state) return false;

			const tooLongMessage = (file: TFile, content: string): string | null => {
				const t = getStrings();
				const lineCount = Math.max(
					1,
					content.split('\n').length - (content.endsWith('\n') ? 1 : 0)
				);
				if (lineCount > MAX_COMPARISON_LINES) {
					return t.limitLines(file.name, MAX_COMPARISON_LINES);
				}
				if (content.length > MAX_COMPARISON_CHARACTERS) {
					return t.limitCharacters(file.name, MAX_COMPARISON_CHARACTERS);
				}
				return null;
			};
			const limitMessage =
				tooLongMessage(state.file1, file1Content) ??
				tooLongMessage(state.file2, file2Content);
			if (limitMessage) {
				this.comparisonError = limitMessage;
				return true;
			}

			const file1Lines = file1Content
				.concat('\n')
				.split('\n')
				.map((line) => line.trimEnd());
			const file2Lines = file2Content
				.concat('\n')
				.split('\n')
				.map((line) => line.trimEnd());
			const diffOptions = {
				maxEditLength: MAX_COMPARISON_DIFF_EDITS,
				timeout: COMPARISON_DIFF_TIMEOUT_MS,
			} as PatchOptions & { timeout: number };
			const parsedDiff = structuredPatch(
				state.file1.path,
				state.file2.path,
				file1Lines.join('\n'),
				file2Lines.join('\n'),
				undefined,
				undefined,
				diffOptions
			) as ReturnType<typeof structuredPatch> | undefined;
			if (!parsedDiff) {
				this.comparisonError = getStrings().limitDiffBudget(
					MAX_COMPARISON_DIFF_EDITS,
					COMPARISON_DIFF_TIMEOUT_MS
				);
				return true;
			}

			const fileDifferences = FileDifferences.fromParsedDiff(parsedDiff);
			if (revision !== this.updateRevision || state !== this.state) return false;
			this.file1Content = file1Content;
			this.file2Content = file2Content;
			this.file1Lines = file1Lines;
			this.file2Lines = file2Lines;
			this.fileDifferences = fileDifferences;
			this.comparisonError = null;
			return true;
		} catch (error) {
			if (revision !== this.updateRevision || state !== this.state) return false;
			console.error('比稿：读取或计算全文差异失败', error);
			this.comparisonError = getStrings().readError(
				error instanceof Error ? error.message : String(error)
			);
			return true;
		}
	}

	private build(): void {
		this.contentEl.empty();
		if (this.comparisonError) {
			this.contentEl.createDiv({ cls: 'file-diff__error', text: this.comparisonError });
			return;
		}

		const container = this.contentEl.createDiv({
			cls: 'file-diff__container',
		});

		this.buildLines(container);

		this.scrollToFirstDifference();
		if (
			this.fileDifferences.differences.length === 0 &&
			this.state.showMergeOption &&
			!this.wasDeleteModalShown
		) {
			this.wasDeleteModalShown = true;
			this.showDeleteModal();
		}
	}

	private buildLines(container: HTMLDivElement): void {
		let lineCount1 = 0;
		let lineCount2 = 0;
		let differenceIndex = 0;
		while (lineCount1 < this.file1Lines.length || lineCount2 < this.file2Lines.length) {
			const differences = this.fileDifferences.differences;
			while (
				differenceIndex < differences.length &&
				(differences[differenceIndex].file1Start < lineCount1 ||
					differences[differenceIndex].file2Start < lineCount2)
			) {
				differenceIndex += 1;
			}
			const candidate = differences[differenceIndex];
			const difference =
				candidate?.file1Start === lineCount1 &&
				candidate.file2Start === lineCount2
					? candidate
					: null;

			if (difference != null) {
				differenceIndex += 1;
				const differenceContainer = container.createDiv({
					cls: 'difference',
				});
				this.buildDifferenceVisualizer(differenceContainer, difference);
				lineCount1 += difference.file1Lines.length;
				lineCount2 += difference.file2Lines.length;
			} else {
				const line =
					lineCount1 <= lineCount2
						? this.file1Lines[lineCount1]
						: this.file2Lines[lineCount2];
				container.createDiv({
					// Necessary to give the line a height when it's empty.
					text: preventEmptyString(line),
					cls: 'file-diff__line',
				});
				lineCount1 += 1;
				lineCount2 += 1;
			}
		}
	}

	private buildDifferenceVisualizer(
		container: HTMLDivElement,
		difference: Difference
	): void {
		if (this.state.showMergeOption) {
			new ActionLine({
				app: this.app,
				difference,
				file1: this.state.file1,
				file2: this.state.file2,
				file1Content: this.file1Content,
				file2Content: this.file2Content,
				triggerRebuild: async (): Promise<void> => {
					if (await this.updateState()) this.build();
				},
			}).build(container);
		}

		// Draw top diff
		for (let i = 0; i < difference.file1Lines.length; i += 1) {
			const line1 = difference.file1Lines[i];
			const line2 = difference.file2Lines[i];

			const lineDiv = container.createDiv({ cls: 'file-diff__line file-diff__top-line__bg' });
			const diffSpans = this.buildDiffLine(line1, line2, 'file-diff_top-line__character');

			// Remove border radius if applicable
			if (i < difference.file1Lines.length - 1 || difference.file2Lines.length !== 0) {
				lineDiv.classList.add('file-diff__no-bottom-border');
			}
			if (i !== 0) {
				lineDiv.classList.add('file-diff__no-top-border');
			}

			lineDiv.appendChild(diffSpans);
		}

		// Draw bottom diff
		for (let i = 0; i < difference.file2Lines.length; i += 1) {
			const line1 = difference.file1Lines[i];
			const line2 = difference.file2Lines[i];

			const lineDiv = container.createDiv({ cls: 'file-diff__line file-diff__bottom-line__bg' });
			const diffSpans = this.buildDiffLine(line2, line1, 'file-diff_bottom-line__character');

			// Remove border radius if applicable
			if ((i == 0 && difference.file1Lines.length > 0) || i > 0) {
				lineDiv.classList.add('file-diff__no-top-border');
			}
			if (i < difference.file2Lines.length - 1) {
				lineDiv.classList.add('file-diff__no-bottom-border');
			}

			lineDiv.appendChild(diffSpans);
		}
	}

	private buildDiffLine(line1: string, line2: string, charClass: string) {
		const fragment = document.createElement('div');

		if (line1 != undefined && line1.length === 0) {
			fragment.textContent = preventEmptyString(line1);
		} else if (line1 != undefined && line2 != undefined) {
			const differences = diffWordsWithTokenizer(line2, line1);

			for (const difference of differences) {
				if (difference.removed) {
					continue;
				}

				const span = document.createElement('span');
				// Necessary to give the line a height when it's empty.
				span.textContent = preventEmptyString(difference.value);
				if (difference.added) {
					span.classList.add(charClass);
				}
				fragment.appendChild(span);
			}
		} else if(line1 != undefined && line2 == undefined) {
			const span = document.createElement('span');
			// Necessary to give the line a height when it's empty.
			span.textContent = preventEmptyString(line1);
			span.classList.add(charClass);
			fragment.appendChild(span);
		} else {
			fragment.textContent = preventEmptyString(line1);
		}

		return fragment;
	}

	private scrollToFirstDifference(): void {
		if (this.fileDifferences.differences.length === 0) {
			return;
		}

		const containerRect = this.contentEl
			.getElementsByClassName('file-diff__container')[0]
			.getBoundingClientRect();
		const elementRect = this.contentEl
			.getElementsByClassName('difference')[0]
			.getBoundingClientRect();
		this.contentEl.scrollTo({
			top: elementRect.top - containerRect.top - 100,
			behavior: 'smooth',
		});
	}

	async showDeleteModal(): Promise<void> {
		// Wait a moment to avoid appearing overly aggressive with the modal
		await sleep(200);

		return new Promise((resolve, reject) => {
			new DeleteFileModal({
				app: this.app,
				file1: this.state.file1,
				file2: this.state.file2,
				onDone: (e) => {
					if (e) {
						return reject(e);
					}
					this.state.continueCallback?.(true);
					this.leaf.detach();
					return resolve();
				},
			}).open();
		});
	}
}
