import { App, TFile } from 'obsidian';
import { Difference } from '../data/difference.ts';
import { applyMove, deleteLines, insertLine, replaceLine } from '../utils/string_utils.ts';
import { ActionLineButton } from './action_line_button.ts';
import { ActionLineDivider } from './action_line_divider.ts';
import { getStrings } from '../i18n.ts';

type VoidCallback = () => void;

/** A paired move: one hunk removed from file1, its counterpart added to file2. */
export interface ActionLineMovePair {
	removed: { start: number; lines: string[] };
	added: { file1Start: number; file2Start: number; lines: string[] };
	/** Word-overlap similarity between the two sides, 0..1. */
	score: number;
	onUnpair: VoidCallback;
}

export class ActionLine {
	constructor(args: {
		app: App;
		difference: Difference;
		file1: TFile;
		file2: TFile;
		file1Content: string;
		file2Content: string;
		movePair?: ActionLineMovePair;
		triggerRebuild: VoidCallback;
	}) {
		this.app = args.app;
		this.difference = args.difference;
		this.file1 = args.file1;
		this.file2 = args.file2;
		this.file1Content = args.file1Content;
		this.file2Content = args.file2Content;
		this.movePair = args.movePair;
		this.triggerRebuild = args.triggerRebuild;
	}

	private app: App;

	private difference: Difference;

	private file1: TFile;

	private file2: TFile;

	private file1Content: string;

	private file2Content: string;

	private movePair?: ActionLineMovePair;

	private triggerRebuild: VoidCallback;

	build(container: HTMLDivElement): void {
		const t = getStrings();
		const actionLine = container.createDiv({
			cls: 'flex flex-row gap-1 py-0-5',
		});

		if (this.movePair) {
			new ActionLineButton({
				text: t.acceptMove,
				onClick: (e) => { void this.acceptMoveClick(e); },
			}).build(actionLine);
			ActionLineDivider.build(actionLine);
			new ActionLineButton({
				text: t.rejectMove,
				onClick: (e) => { void this.rejectMoveClick(e); },
			}).build(actionLine);
			ActionLineDivider.build(actionLine);
			new ActionLineButton({
				text: t.unpairMove,
				onClick: (e) => {
					e.preventDefault();
					this.movePair?.onUnpair();
				},
			}).build(actionLine);
			if (this.movePair.score < 1) {
				actionLine.createSpan({
					text: t.nearMoveHint,
					cls: 'file-diff__near-move-hint',
				});
			}
			return;
		}

		const hasMinusLines = this.difference.file1Lines.length > 0;
		const hasPlusLines = this.difference.file2Lines.length > 0;

		if (hasPlusLines && hasMinusLines) {
			new ActionLineButton({
				text: t.keepTop,
				onClick: (e) => { void this.acceptTopClick(e, this.difference); },
			}).build(actionLine);
			ActionLineDivider.build(actionLine);
			new ActionLineButton({
				text: t.keepBottom,
				onClick: (e) => { void this.acceptBottomClick(e, this.difference); },
			}).build(actionLine);
			ActionLineDivider.build(actionLine);
			new ActionLineButton({
				text: t.keepAll,
				onClick: (e) => { void this.acceptAllClick(e, this.difference); },
			}).build(actionLine);
			ActionLineDivider.build(actionLine);
			new ActionLineButton({
				text: t.discardAll,
				onClick: (e) => { void this.acceptNoneClick(e, this.difference); },
			}).build(actionLine);
		} else if (hasMinusLines) {
			new ActionLineButton({
				text: t.keepVersionOf(this.file1.name),
				onClick: (e) => { void this.insertFile1Difference(e, this.difference); },
			}).build(actionLine);
			ActionLineDivider.build(actionLine);
			new ActionLineButton({
				text: t.deleteBlock,
				onClick: (e) => { void this.discardFile1Difference(e, this.difference); },
			}).build(actionLine);
		} else if (hasPlusLines) {
			new ActionLineButton({
				text: t.keepVersionOf(this.file2.name),
				onClick: (e) => { void this.insertFile2Difference(e, this.difference); },
			}).build(actionLine);
			ActionLineDivider.build(actionLine);
			new ActionLineButton({
				text: t.deleteBlock,
				onClick: (e) => { void this.discardFile2Difference(e, this.difference); },
			}).build(actionLine);
		}
	}

	private async acceptTopClick(
		event: MouseEvent,
		difference: Difference
	): Promise<void> {
		event.preventDefault();

		const changedLines = difference.file1Lines.join('\n');
		const newContent = replaceLine({
			fullText: this.file2Content,
			newLine: changedLines,
			position: difference.file2Start,
			linesToReplace: difference.file2Lines.length,
		});
		await this.app.vault.modify(this.file2, newContent);

		this.triggerRebuild();
	}

	private async acceptBottomClick(
		event: MouseEvent,
		difference: Difference
	): Promise<void> {
		event.preventDefault();

		const changedLines = difference.file2Lines.join('\n');
		const newContent = replaceLine({
			fullText: this.file1Content,
			newLine: changedLines,
			position: difference.file1Start,
			linesToReplace: difference.file1Lines.length,
		});
		await this.app.vault.modify(this.file1, newContent);

		this.triggerRebuild();
	}

	private async acceptAllClick(
		event: MouseEvent,
		difference: Difference
	): Promise<void> {
		event.preventDefault();

		const changedLines = [
			...difference.file1Lines,
			...difference.file2Lines,
		].join('\n');

		const newFile1Content = replaceLine({
			fullText: this.file1Content,
			newLine: changedLines,
			position: difference.file1Start,
			linesToReplace: difference.file1Lines.length,
		});
		await this.app.vault.modify(this.file1, newFile1Content);

		const newFile2Content = replaceLine({
			fullText: this.file2Content,
			newLine: changedLines,
			position: difference.file2Start,
			linesToReplace: difference.file2Lines.length,
		});
		await this.app.vault.modify(this.file2, newFile2Content);

		this.triggerRebuild();
	}

	private async acceptNoneClick(
		event: MouseEvent,
		difference: Difference
	): Promise<void> {
		event.preventDefault();

		const newFile1Content = deleteLines({
			fullText: this.file1Content,
			position: difference.file1Start,
			count: difference.file1Lines.length,
		});
		await this.app.vault.modify(this.file1, newFile1Content);

		const newFile2Content = deleteLines({
			fullText: this.file2Content,
			position: difference.file2Start,
			count: difference.file2Lines.length,
		});
		await this.app.vault.modify(this.file2, newFile2Content);

		this.triggerRebuild();
	}

	private async insertFile1Difference(
		event: MouseEvent,
		difference: Difference
	): Promise<void> {
		event.preventDefault();

		const changedLines = difference.file1Lines.join('\n');
		const newContent = insertLine({
			fullText: this.file2Content,
			newLine: changedLines,
			position: difference.file2Start,
		});
		await this.app.vault.modify(this.file2, newContent);

		this.triggerRebuild();
	}

	private async insertFile2Difference(
		event: MouseEvent,
		difference: Difference
	): Promise<void> {
		event.preventDefault();

		const changedLines = difference.file2Lines.join('\n');
		const newContent = insertLine({
			fullText: this.file1Content,
			newLine: changedLines,
			position: difference.file1Start,
		});
		await this.app.vault.modify(this.file1, newContent);

		this.triggerRebuild();
	}

	async discardFile1Difference(
		event: MouseEvent,
		difference: Difference
	): Promise<void> {
		event.preventDefault();

		const newContent = deleteLines({
			fullText: this.file1Content,
			position: difference.file1Start,
			count: difference.file1Lines.length,
		});
		await this.app.vault.modify(this.file1, newContent);

		this.triggerRebuild();
	}

	async discardFile2Difference(
		event: MouseEvent,
		difference: Difference
	): Promise<void> {
		event.preventDefault();

		const newContent = deleteLines({
			fullText: this.file2Content,
			position: difference.file2Start,
			count: difference.file2Lines.length,
		});
		await this.app.vault.modify(this.file2, newContent);

		this.triggerRebuild();
	}

	/** Converges both notes to the moved position: one write on file1 only. */
	private async acceptMoveClick(event: MouseEvent): Promise<void> {
		event.preventDefault();
		const pair = this.movePair;
		if (!pair) return;

		const newContent = applyMove({
			fullText: this.file1Content,
			removedStart: pair.removed.start,
			removedCount: pair.removed.lines.length,
			insertStart: pair.added.file1Start,
			insertedLines: pair.added.lines,
		});
		await this.app.vault.modify(this.file1, newContent);

		this.triggerRebuild();
	}

	/** Converges both notes to the original position: one write on file2 only. */
	private async rejectMoveClick(event: MouseEvent): Promise<void> {
		event.preventDefault();
		const pair = this.movePair;
		if (!pair) return;

		const newContent = deleteLines({
			fullText: this.file2Content,
			position: pair.added.file2Start,
			count: pair.added.lines.length,
		});
		await this.app.vault.modify(this.file2, newContent);

		this.triggerRebuild();
	}
}
