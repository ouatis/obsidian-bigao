import type { App, Editor, Plugin, WorkspaceLeaf } from 'obsidian';
import { computePanelDifferences } from '../data/panel_differences.ts';
import type { PanelDifference } from '../data/panel_differences.ts';
import { buildInlineDecorationRanges } from '../data/inline_decoration_ranges.ts';
import { tokenizeWords } from '../utils/word_diff.ts';

interface SplitComparison {
	comparePath: string;
	sourcePath?: string;
	direction: 'horizontal' | 'vertical';
	sourceLeaf: WorkspaceLeaf;
}

type SplitRegistryWindow = Window & {
	__bigaoSplitComparisonsV1?: Map<WorkspaceLeaf, SplitComparison>;
};

interface InlineEditorView {
	dom: HTMLElement;
	scrollDOM: HTMLElement;
	viewport: { from: number; to: number };
	state: { doc: { toString(): string } };
	domAtPos(pos: number, side?: -1 | 1): { node: Node; offset: number };
}

interface InlineRenderSubscription {
	view: InlineEditorView;
	scrollHandler: () => void;
	resizeObserver?: ResizeObserver;
}

const pendingRefreshes = new WeakMap<App, number>();
const pendingOverlayRenders = new WeakMap<Editor, number>();
const inlineDiffData = new WeakMap<Editor, { text: string; differences: PanelDifference[] }>();
const inlineOverlays = new WeakMap<Editor, HTMLElement>();
const observedEditors = new Map<Editor, InlineRenderSubscription>();

function getEditorView(editor: Editor): InlineEditorView | null {
	try {
		const view = (editor as Editor & { cm?: unknown }).cm;
		return view && typeof view === 'object' &&
			'scrollDOM' in view && 'domAtPos' in view
			? view as InlineEditorView
			: null;
	} catch {
		return null;
	}
}

interface MarkdownEditorView {
	file: { path: string } | null;
	editor: Editor;
}

function asMarkdownEditorView(view: unknown): MarkdownEditorView | null {
	if (!view || typeof view !== 'object') return null;
	const candidate = view as Partial<MarkdownEditorView>;
	return candidate.file && candidate.editor && typeof candidate.editor.getValue === 'function'
		? candidate as MarkdownEditorView
		: null;
}

function removeOverlay(editor: Editor): void {
	const timer = pendingOverlayRenders.get(editor);
	if (timer !== undefined) window.clearTimeout(timer);
	pendingOverlayRenders.delete(editor);
	inlineOverlays.get(editor)?.remove();
	inlineOverlays.delete(editor);
}

function getOverlay(editor: Editor, view: InlineEditorView): HTMLElement {
	let overlay = inlineOverlays.get(editor);
	if (!overlay || overlay.parentElement !== view.scrollDOM) {
		overlay?.remove();
		overlay = document.createElement('div');
		overlay.className = 'bigao-inline-overlay';
		overlay.setAttribute('aria-hidden', 'true');
		view.scrollDOM.appendChild(overlay);
		inlineOverlays.set(editor, overlay);
	}
	return overlay;
}

function renderInlineOverlay(editor: Editor): void {
	const view = getEditorView(editor);
	const data = inlineDiffData.get(editor);
	if (!view) {
		removeOverlay(editor);
		return;
	}
	if (!data) {
		removeOverlay(editor);
		return;
	}
	const currentText = view.state.doc.toString();
	if (currentText !== data.text) {
		removeOverlay(editor);
		return;
	}

	const overlay = getOverlay(editor, view);
	const fragment = document.createDocumentFragment();
	const ranges = buildInlineDecorationRanges(data.text, data.differences);
	for (const range of ranges) {
		if (range.to < view.viewport.from || range.from > view.viewport.to) continue;
		if (range.kind === 'line') {
			let lineElement: Element | null = null;
			try {
				const node = view.domAtPos(range.from, 1).node;
				lineElement = (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)
					?.closest('.cm-line') ?? null;
			} catch {
				continue;
			}
			const line = lineElement?.getBoundingClientRect();
			if (!line || line.height <= 0) continue;
			const marker = document.createElement('span');
			marker.className = `bigao-inline-line-marker ${range.className}`;
			const scrollerRect = view.scrollDOM.getBoundingClientRect();
			marker.style.left = `${Math.max(0, line.left - scrollerRect.left + view.scrollDOM.scrollLeft - 6)}px`;
			marker.style.top = `${line.top - scrollerRect.top + view.scrollDOM.scrollTop}px`;
			marker.style.height = `${line.height}px`;
			fragment.appendChild(marker);
			continue;
		}

		try {
			const from = view.domAtPos(range.from, 1);
			const to = view.domAtPos(range.to, -1);
			const domRange = document.createRange();
			domRange.setStart(from.node, from.offset);
			domRange.setEnd(to.node, to.offset);
			for (const rect of Array.from(domRange.getClientRects())) {
				const marker = document.createElement('span');
				marker.className = range.className;
				const scrollerRect = view.scrollDOM.getBoundingClientRect();
				marker.style.left = `${rect.left - scrollerRect.left + view.scrollDOM.scrollLeft}px`;
				marker.style.top = `${rect.top - scrollerRect.top + view.scrollDOM.scrollTop}px`;
				marker.style.width = `${rect.width}px`;
				marker.style.height = `${rect.height}px`;
				fragment.appendChild(marker);
			}
			domRange.detach();
		} catch {
			// Decorations can briefly race CodeMirror's DOM refresh; the next frame retries.
		}
	}
	overlay.replaceChildren(fragment);
}

function scheduleOverlayRender(editor: Editor): void {
	if (pendingOverlayRenders.has(editor)) return;
	const timer = window.setTimeout(() => {
		pendingOverlayRenders.delete(editor);
		renderInlineOverlay(editor);
	}, 16);
	pendingOverlayRenders.set(editor, timer);
}

function observeEditor(editor: Editor): void {
	const view = getEditorView(editor);
	if (!view || observedEditors.get(editor)?.view === view) return;
	const oldSubscription = observedEditors.get(editor);
	if (oldSubscription) {
		oldSubscription.view.scrollDOM.removeEventListener('scroll', oldSubscription.scrollHandler);
		oldSubscription.resizeObserver?.disconnect();
	}
	const scrollHandler = () => scheduleOverlayRender(editor);
	view.scrollDOM.addEventListener('scroll', scrollHandler, { passive: true });
	let resizeObserver: ResizeObserver | undefined;
	if (typeof ResizeObserver !== 'undefined') {
		resizeObserver = new ResizeObserver(scrollHandler);
		resizeObserver.observe(view.scrollDOM);
		resizeObserver.observe(view.dom);
	}
	observedEditors.set(editor, { view, scrollHandler, resizeObserver });
	scheduleOverlayRender(editor);
}

function pruneObservedEditors(app: App): void {
	const liveEditors = new Set(
		app.workspace.getLeavesOfType('markdown')
			.map((leaf) => asMarkdownEditorView(leaf.view)?.editor)
			.filter((editor): editor is Editor => Boolean(editor))
	);
	for (const [editor, subscription] of observedEditors) {
		if (liveEditors.has(editor)) continue;
		subscription.view.scrollDOM.removeEventListener('scroll', subscription.scrollHandler);
		subscription.resizeObserver?.disconnect();
		observedEditors.delete(editor);
		inlineDiffData.delete(editor);
		removeOverlay(editor);
	}
}

function setEditorDifferences(editor: Editor | undefined, differences: PanelDifference[], text: string): void {
	if (!editor) return;
	if (differences.length) {
		inlineDiffData.set(editor, { text, differences });
		observeEditor(editor);
		scheduleOverlayRender(editor);
	} else {
		inlineDiffData.delete(editor);
		removeOverlay(editor);
	}
}

function clearLeaf(leaf: WorkspaceLeaf | null | undefined): void {
	const view = asMarkdownEditorView(leaf?.view);
	if (view) setEditorDifferences(view.editor, [], '');
}

function getRegistry(): Map<WorkspaceLeaf, SplitComparison> {
	const target = window as SplitRegistryWindow;
	if (!(target.__bigaoSplitComparisonsV1 instanceof Map)) {
		target.__bigaoSplitComparisonsV1 = new Map();
	}
	return target.__bigaoSplitComparisonsV1;
}

function getCurrentText(view: MarkdownEditorView): string | null {
	try {
		return view.editor.getValue();
	} catch {
		return null;
	}
}

function refreshInlineDiffs(app: App): void {
	pruneObservedEditors(app);
	const leaves = new Set(app.workspace.getLeavesOfType('markdown'));
	const registry = getRegistry();
	for (const [compareLeaf, comparison] of registry) {
		const sourceLeaf = comparison.sourceLeaf;
		if (!leaves.has(sourceLeaf) || !leaves.has(compareLeaf)) {
			clearLeaf(sourceLeaf);
			clearLeaf(compareLeaf);
			registry.delete(compareLeaf);
			continue;
		}

		const sourceMarkdownView = asMarkdownEditorView(sourceLeaf.view);
		const compareMarkdownView = asMarkdownEditorView(compareLeaf.view);
		if (!sourceMarkdownView || !compareMarkdownView) {
			clearLeaf(sourceLeaf);
			clearLeaf(compareLeaf);
			continue;
		}

		comparison.sourcePath ??= sourceMarkdownView.file?.path;
		if (
			!comparison.sourcePath || sourceMarkdownView.file?.path !== comparison.sourcePath ||
			compareMarkdownView.file?.path !== comparison.comparePath
		) {
			setEditorDifferences(sourceMarkdownView.editor, [], '');
			setEditorDifferences(compareMarkdownView.editor, [], '');
			continue;
		}

		const sourceText = getCurrentText(sourceMarkdownView);
		const compareText = getCurrentText(compareMarkdownView);
		if (sourceText === null || compareText === null) {
			setEditorDifferences(sourceMarkdownView.editor, [], '');
			setEditorDifferences(compareMarkdownView.editor, [], '');
			continue;
		}
		const sourceDifferences = computePanelDifferences(sourceText, compareText, tokenizeWords);
		const compareDifferences = computePanelDifferences(compareText, sourceText, tokenizeWords);
		setEditorDifferences(sourceMarkdownView.editor, sourceDifferences, sourceText);
		setEditorDifferences(compareMarkdownView.editor, compareDifferences, compareText);
	}
}

export function scheduleInlineDiffRefresh(app: App, delay = 180): void {
	const existing = pendingRefreshes.get(app);
	if (existing !== undefined) window.clearTimeout(existing);
	const timer = window.setTimeout(() => {
		pendingRefreshes.delete(app);
		try {
			refreshInlineDiffs(app);
		} catch (error) {
			console.error('比稿：行内差异刷新失败', error);
		}
	}, delay);
	pendingRefreshes.set(app, timer);
}

export function cancelInlineDiffRefresh(app: App): void {
	const timer = pendingRefreshes.get(app);
	if (timer !== undefined) window.clearTimeout(timer);
	pendingRefreshes.delete(app);
}

export function clearInlineDiffForLeaves(
	sourceLeaf: WorkspaceLeaf | null | undefined,
	compareLeaf: WorkspaceLeaf | null | undefined
): void {
	clearLeaf(sourceLeaf);
	clearLeaf(compareLeaf);
}

export function registerInlineDiffRuntime(plugin: Plugin): void {
	const app = plugin.app;
	plugin.registerEvent(app.workspace.on('editor-change', (changedEditor, info) => {
		if (changedEditor && inlineDiffData.has(changedEditor)) scheduleOverlayRender(changedEditor);
		if (!info?.file) return;
		if ([...getRegistry().values()].some((comparison) =>
			comparison.comparePath === info.file?.path ||
			comparison.sourcePath === info.file?.path ||
			asMarkdownEditorView(comparison.sourceLeaf.view)?.file?.path === info.file?.path
		)) scheduleInlineDiffRefresh(app);
	}));
	plugin.registerEvent(app.workspace.on('layout-change', () => {
		pruneObservedEditors(app);
		scheduleInlineDiffRefresh(app, 0);
	}));
	plugin.registerEvent(app.vault.on('modify', (file) => {
		if ([...getRegistry().values()].some((comparison) =>
			comparison.comparePath === file.path || comparison.sourcePath === file.path
		)) scheduleInlineDiffRefresh(app);
	}));
	plugin.register(() => {
		cancelInlineDiffRefresh(app);
		for (const [editor, subscription] of observedEditors) {
			subscription.view.scrollDOM.removeEventListener('scroll', subscription.scrollHandler);
			subscription.resizeObserver?.disconnect();
			removeOverlay(editor);
		}
		observedEditors.clear();
	});
	scheduleInlineDiffRefresh(app);
}
