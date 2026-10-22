import {
	App,
	ItemView,
	MarkdownView,
	Notice,
	TFile,
	WorkspaceLeaf,
} from 'obsidian';
import {
	computePanelDifferences,
	MAX_PANEL_LINES,
} from '../data/panel_differences.ts';
import { namespacedId } from '../ids.ts';
import { tokenizeWords } from '../utils/word_diff.ts';
import { readOpenEditorText } from '../utils/open_editor_text.ts';
import { renderFull, scrollToLine } from './bigao_panel_render.ts';

export function panelViewType(): string {
	return namespacedId('panel-view');
}

export class BigaoPanelView extends ItemView {
	private readonly hostApp: App;
	private compareFile: TFile | null = null;
	private targetFile: TFile | null = null;
	private sourceLeaf: WorkspaceLeaf | null = null;
	private body: HTMLElement | null = null;
	private renderTimer: number | null = null;
	private followTimer: number | null = null;
	private followPoll: number | null = null;
	private lastLine = -1;
	private follow = true;
	private renderRevision = 0;

	constructor(leaf: WorkspaceLeaf, app: App) {
		super(leaf);
		this.hostApp = app;
	}

	override getViewType(): string {
		return panelViewType();
	}

	override getDisplayText(): string {
		return '比稿：对照差异';
	}

	override getIcon(): string {
		return 'diff';
	}

	setPair(targetFile: TFile, compareFile: TFile, sourceLeaf?: WorkspaceLeaf): void {
		this.targetFile = targetFile;
		this.compareFile = compareFile;
		this.sourceLeaf = sourceLeaf ?? null;
		this.follow = true;
		this.lastLine = -1;
		this.startFollowPolling();
		this.scheduleRender();
	}

	clearPair(): void {
		this.renderRevision += 1;
		this.targetFile = null;
		this.compareFile = null;
		this.sourceLeaf = null;
		if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
		if (this.followTimer !== null) window.clearTimeout(this.followTimer);
		this.renderTimer = null;
		this.followTimer = null;
		this.stopFollowPolling();
		this.contentEl.empty();
	}

	private scheduleRender(): void {
		const revision = ++this.renderRevision;
		if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
		this.renderTimer = window.setTimeout(() => {
			this.renderTimer = null;
			void this.renderNow(revision);
		}, 300);
	}

	private buildChrome(differenceCount: number): void {
		const header = this.contentEl.createDiv({ cls: 'bigao-panel__head' });
		header.createDiv({ cls: 'bigao-panel__count', text: `${differenceCount} 处差异` });
		const followButton = header.createDiv({ cls: 'bigao-panel__follow' });
		followButton.setAttribute('role', 'button');
		followButton.setAttribute('tabindex', '0');
		followButton.setAttribute('aria-pressed', String(this.follow));
		followButton.setAttribute('data-active', this.follow ? '1' : '0');
		followButton.setAttribute('title', '切换是否跟随原稿光标');
		const updateLabel = () => {
			followButton.empty();
			followButton.createSpan({ text: this.follow ? '跟随中' : '不跟随' });
			followButton.setAttribute('aria-pressed', String(this.follow));
			followButton.setAttribute('data-active', this.follow ? '1' : '0');
		};
		const toggleFollow = () => {
			this.follow = !this.follow;
			updateLabel();
			if (this.follow) {
				this.startFollowPolling();
				this.followCursor(true);
			} else {
				this.stopFollowPolling();
			}
			new Notice(this.follow ? '比稿：面板将跟随光标' : '比稿：面板已停止跟随');
		};
		followButton.addEventListener('click', toggleFollow);
		followButton.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			toggleFollow();
		});
		updateLabel();
	}

	private async readOpenEditorText(file: TFile): Promise<string> {
		return readOpenEditorText(this.hostApp, file);
	}

	private async renderNow(revision: number): Promise<void> {
		if (revision !== this.renderRevision) return;
		const targetFile = this.targetFile;
		const compareFile = this.compareFile;
		try {
			if (!targetFile || !compareFile) {
				this.contentEl.empty();
				this.contentEl.createDiv({
					cls: 'bigao-panel__empty',
					text: '用「比稿：开启左右分屏对照」选择一篇对照稿。',
				});
				return;
			}

			const [currentText, otherText] = await Promise.all([
				this.readOpenEditorText(targetFile),
				this.readOpenEditorText(compareFile),
			]);
			if (revision !== this.renderRevision) return;
			const lines = currentText.split('\n');
			if (
				lines.length > MAX_PANEL_LINES ||
				otherText.split('\n').length > MAX_PANEL_LINES
			) {
				this.contentEl.empty();
				this.contentEl.createDiv({
					cls: 'bigao-panel__empty',
					text: `任一篇笔记超过 ${MAX_PANEL_LINES} 行，分屏对照暂不计算。`,
				});
				return;
			}

			const differences = computePanelDifferences(
				currentText,
				otherText,
				tokenizeWords
			);
			this.contentEl.empty();
			this.buildChrome(differences.length);
			this.body = renderFull(this.contentEl, lines, differences);
			this.followCursor(false);
		} catch (error) {
			if (revision !== this.renderRevision) return;
			console.error('比稿：面板更新失败', error);
			this.contentEl.empty();
			this.contentEl.createDiv({
				cls: 'bigao-panel__empty',
				text: `更新失败：${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}

	private getTargetMarkdownView(): MarkdownView | null {
		if (!this.targetFile) return null;
		const sourceView = this.sourceLeaf?.view;
		if (
			sourceView instanceof MarkdownView &&
			sourceView.file?.path === this.targetFile.path
		) {
			return sourceView;
		}
		for (const leaf of this.hostApp.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file?.path === this.targetFile.path) {
				return view;
			}
		}
		return null;
	}

	private followCursor(force: boolean): void {
		if (!this.follow || !this.body) return;
		try {
			const view = this.getTargetMarkdownView();
			if (!view?.editor) return;
			const line = view.editor.getCursor('from').line;
			if (!force && line === this.lastLine) return;
			this.lastLine = line;
			scrollToLine(this.body, line, true);
		} catch {
			// Cursor tracking must never interfere with editing or comparison.
		}
	}

	private onCursorMoved(): void {
		if (this.followTimer !== null) window.clearTimeout(this.followTimer);
		this.followTimer = window.setTimeout(() => {
			this.followTimer = null;
			this.followCursor(false);
		}, 120);
	}

	private startFollowPolling(): void {
		if (!this.follow || !this.targetFile || this.followPoll !== null) return;
		this.followPoll = window.setInterval(() => this.followCursor(false), 250);
	}

	private stopFollowPolling(): void {
		if (this.followPoll === null) return;
		window.clearInterval(this.followPoll);
		this.followPoll = null;
	}

	override async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.createDiv({
			cls: 'bigao-panel__empty',
			text: '用「比稿：开启左右分屏对照」选择一篇对照稿。',
		});
		this.registerEvent(
			this.hostApp.workspace.on('editor-change', (_editor, info) => {
				const file = info?.file;
				if (!file) return;
				if (file.path === this.targetFile?.path) {
					this.scheduleRender();
					this.onCursorMoved();
				} else if (file.path === this.compareFile?.path) {
					this.scheduleRender();
				}
			})
		);
		this.registerEvent(
			this.hostApp.vault.on('modify', (file) => {
				if (
					file.path === this.targetFile?.path ||
					file.path === this.compareFile?.path
				) {
					this.scheduleRender();
				}
			})
		);
	}

	override async onClose(): Promise<void> {
		this.renderRevision += 1;
		if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
		if (this.followTimer !== null) window.clearTimeout(this.followTimer);
		this.renderTimer = null;
		this.followTimer = null;
		this.stopFollowPolling();
	}
}
