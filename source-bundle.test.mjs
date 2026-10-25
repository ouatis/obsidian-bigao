import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const builtBundle = await readFile(join(root, 'dist', 'main.js'), 'utf8');
const comparisonLimitSource = await readFile(join(root, 'src', 'data', 'comparison_limits.ts'), 'utf8');
const readableBundle = builtBundle.replace(/\\u([\da-f]{4})/gi, (_match, codePoint) =>
	String.fromCharCode(Number.parseInt(codePoint, 16))
);

function readComparisonLimit(name) {
	const match = comparisonLimitSource.match(new RegExp(`export const ${name} = ([\\d_]+);`));
	return match ? Number(match[1].replaceAll('_', '')) : Number.NaN;
}

test('recovered source bundle keeps the local Chinese comparison UI', () => {
	for (const label of ['采用上方', '采用下方', '全部采用', '全部放弃', '确定要承担此风险吗？', '接受风险']) {
		assert.ok(readableBundle.includes(label), `Expected recovered bundle to include ${label}`);
	}
	assert.doesNotMatch(readableBundle, /Accept Top|Accept Bottom|Accept All|Accept None|Accept Risk/);
});

test('recovered source bundle registers and opens the native split commands', async () => {
	const module = { exports: {} };
	const commands = [];
	const views = new Map();
	const editorExtensions = [];
	const directions = [];
	const detachedTypes = [];
	class PluginStub {
		constructor(runtimeApp) { this.app = runtimeApp; }
		addCommand(command) { commands.push(command); }
		registerView(type, factory) { views.set(type, factory); }
		registerEditorExtension(extension) { editorExtensions.push(extension); }
		registerEvent() {}
		register() {}
		async loadData() { return null; }
		async saveData() {}
	}
	class ItemViewStub {
		constructor(leaf) {
			this.leaf = leaf;
			this.app = leaf.app;
			this.contentEl = leaf.contentEl;
		}
		registerEvent() {}
	}
	const openedModals = [];
	let cancelNextModal = false;
	let holdNextModalOpen = false;
	class MarkdownViewStub {}
	class SuggestModalStub {
		constructor(runtimeApp) { this.app = runtimeApp; openedModals.push(this); }
		setPlaceholder(value) { this.placeholder = value; }
		open() {
			if (cancelNextModal) {
				cancelNextModal = false;
				this.close();
				return;
			}
			if (holdNextModalOpen) {
				holdNextModalOpen = false;
				return;
			}
			const suggestion = this.getSuggestions('')[0];
			if (suggestion) this.onChooseSuggestion(suggestion, {});
			else this.close();
		}
		close() { if (typeof this.onClose === 'function') this.onClose(); }
	}
	class NoticeStub {}
	const targetFile = { path: 'current.md', name: '当前稿', stat: { mtime: 2 } };
	const compareFile = { path: 'drafts/对照稿.md', name: '对照稿.md', parent: { path: 'drafts' }, stat: { mtime: 1 } };
	const duplicateNameFile = { path: 'archive/对照稿.md', name: '对照稿.md', parent: { path: 'archive' }, stat: { mtime: 0 } };
	const attachmentFile = { path: 'scan.pdf', name: 'scan.pdf', stat: { mtime: 100 } };
	let getFilesCalls = 0;
	const sourceLeaf = {};
	const sourceView = new MarkdownViewStub();
	sourceView.file = targetFile;
	sourceView.leaf = sourceLeaf;
	sourceLeaf.view = sourceView;
	const detachedLeaves = [];
	const workspaceListeners = new Map();
	const pendingTimers = new Map();
	let nextTimerId = 0;
	let silentOpenFailure = false;
	const compareLeaf = {
		view: null,
		async openFile(file, state) {
			directions.push(['open-file', file, state]);
			if (silentOpenFailure) return;
			this.view = new MarkdownViewStub();
			this.view.file = file;
		},
		detach() { detachedLeaves.push(this); },
	};
	const windowApi = {
		setTimeout(callback) {
			const id = ++nextTimerId;
			pendingTimers.set(id, callback);
			return id;
		},
		clearTimeout(id) { pendingTimers.delete(id); },
		setInterval() { return 2; },
		clearInterval() {},
	};
	const runtimeErrors = [];
	const workspace = {
		getActiveViewOfType() { return sourceView; },
		on(event, callback) {
			if (!workspaceListeners.has(event)) workspaceListeners.set(event, []);
			workspaceListeners.get(event).push(callback);
			return {};
		},
		getLeavesOfType(type) {
			return type === 'markdown' ? [sourceLeaf, ...(compareLeaf.view ? [compareLeaf] : [])] : [];
		},
		createLeafBySplit(_source, direction) {
			directions.push(['split', direction]);
			return compareLeaf;
		},
		revealLeaf() {},
		onLayoutReady() {},
		detachLeavesOfType(type) { detachedTypes.push(type); },
	};
	const app = {
		workspace,
		vault: {
			on() { return {}; },
			async cachedRead(file) { return file === targetFile ? '原稿内容' : '对照稿内容'; },
			getMarkdownFiles: () => [targetFile, compareFile, duplicateNameFile],
			getFiles: () => { getFilesCalls += 1; return [targetFile, compareFile, duplicateNameFile, attachmentFile]; },
		},
	};
	const obsidian = new Proxy({}, {
		get: (_target, key) => ({
			Plugin: PluginStub,
			SuggestModal: SuggestModalStub,
			ItemView: ItemViewStub,
			MarkdownView: MarkdownViewStub,
			Notice: NoticeStub,
			Modal: class {},
		})[key] ?? class {},
	});

	new Function(
		'require', 'module', 'localStorage', 'document', 'app', 'console', 'window', builtBundle,
	)(
		(id) => id === 'obsidian' ? obsidian : {},
		module,
		{ getItem: () => null, setItem() {} },
		{ body: { setAttribute() {} }, documentElement: { style: {} }, createElement: () => ({ style: {} }) },
		app,
		{ log() {}, error(...args) { runtimeErrors.push(args); } },
		windowApi,
	);

	const plugin = new module.exports.default(app);
	plugin.onload();
	const [initialInlineRefreshId, runInitialInlineRefresh] = pendingTimers.entries().next().value;
	pendingTimers.delete(initialInlineRefreshId);
	runInitialInlineRefresh();
	assert.equal(editorExtensions.length, 0, 'inline overlays do not register CodeMirror extensions');
	const comparisonLimits = {
		lines: readComparisonLimit('MAX_COMPARISON_LINES'),
		characters: readComparisonLimit('MAX_COMPARISON_CHARACTERS'),
	};
	assert.ok(Number.isInteger(comparisonLimits.lines) && comparisonLimits.lines > 0);
	assert.ok(Number.isInteger(comparisonLimits.characters) && comparisonLimits.characters > 0);
	const diffContent = [];
	const diffContainer = {
		createDiv(options) { diffContent.push(options); return {}; },
	};
	const diffView = views.get('bigao-differences-view')({
		app,
		contentEl: {
			empty() { diffContent.length = 0; },
			createDiv(options) { diffContent.push(options); return diffContainer; },
		},
	});
	diffView.state = { file1: targetFile, file2: compareFile, showMergeOption: false };
	assert.equal(await diffView.updateState(), true);
	assert.equal(diffView.file1Content, '原稿内容');
	assert.equal(diffView.file2Content, '对照稿内容');
	app.vault.cachedRead = async (file) => file === targetFile
		? Array(comparisonLimits.lines + 1).fill('行').join('\n')
		: '短稿';
	assert.equal(await diffView.updateState(), true);
	assert.match(diffView.comparisonError, new RegExp(`${comparisonLimits.lines.toLocaleString()} 行`));
	diffView.build();
	assert.equal(diffContent[0].cls, 'file-diff__error');
	app.vault.cachedRead = async (file) => file === targetFile
		? '字'.repeat(comparisonLimits.characters + 1)
		: '短稿';
	assert.equal(await diffView.updateState(), true);
	assert.match(diffView.comparisonError, new RegExp(`${comparisonLimits.characters.toLocaleString()} 个字符`));
	const pendingDiffReads = [];
	app.vault.cachedRead = (file) => new Promise((resolve) => pendingDiffReads.push({ file, resolve }));
	const staleDiffUpdate = diffView.updateState();
	assert.equal(pendingDiffReads.length, 2);
	diffView.state = {
		file1: { path: 'new-current.md', name: '新稿' },
		file2: { path: 'new-compare.md', name: '新对照稿' },
		showMergeOption: false,
	};
	const currentDiffUpdate = diffView.updateState();
	assert.equal(pendingDiffReads.length, 4);
	pendingDiffReads[2].resolve('最新原稿');
	pendingDiffReads[3].resolve('最新对照稿');
	assert.equal(await currentDiffUpdate, true);
	assert.equal(diffView.file1Content, '最新原稿');
	pendingDiffReads[0].resolve('过期原稿');
	pendingDiffReads[1].resolve('过期对照稿');
	assert.equal(await staleDiffUpdate, false);
	assert.equal(diffView.file1Content, '最新原稿');
	let unsavedTargetText = '未保存的原稿';
	let unsavedCompareText = '未保存的对照稿';
	sourceView.editor = { getValue: () => unsavedTargetText };
	compareLeaf.view = new MarkdownViewStub();
	compareLeaf.view.file = compareFile;
	compareLeaf.view.editor = { getValue: () => unsavedCompareText };
	diffView.state = { file1: targetFile, file2: compareFile, showMergeOption: false };
	assert.equal(await diffView.updateState(), true);
	assert.equal(diffView.file1Content, unsavedTargetText);
	assert.equal(diffView.file2Content, unsavedCompareText);
	unsavedTargetText = '刚刚修改的原稿';
	unsavedCompareText = unsavedTargetText;
	for (const listener of workspaceListeners.get('editor-change') ?? []) {
		listener({}, { file: targetFile });
	}
	assert.equal(pendingTimers.size, 1, 'editor changes should be debounced');
	const [timerId, runEditorRefresh] = pendingTimers.entries().next().value;
	pendingTimers.delete(timerId);
	runEditorRefresh();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(diffView.file1Content, unsavedTargetText, 'full diff should refresh from unsaved editor text');
	await diffView.onClose();
	assert.equal(plugin.fileDiffMergeWarningKey, 'bigao-merge-warning');
	assert.equal(await plugin.getFileToCompare(targetFile), compareFile);
	assert.equal(getFilesCalls, 0, 'comparison picker must not offer arbitrary attachments');
	holdNextModalOpen = true;
	const choiceAfterClose = plugin.getFileToCompare(targetFile);
	const delayedModal = openedModals.at(-1);
	delayedModal.onClose();
	delayedModal.onChooseSuggestion(compareFile, {});
	assert.equal(await choiceAfterClose, compareFile,
		'Obsidian may invoke onClose before onChooseSuggestion for a selected item');
	const standardPicker = openedModals.at(-1);
	assert.deepEqual(standardPicker.getSuggestions('archive/对照稿.md'), [duplicateNameFile]);
	const renderedSuggestion = [];
	standardPicker.renderSuggestion(duplicateNameFile, {
		createDiv(options) { renderedSuggestion.push(options); },
	});
	assert.deepEqual(renderedSuggestion, [
		{ text: '对照稿.md' },
		{ cls: 'bigao-pick__dir', text: 'archive' },
	]);
	standardPicker.files = Array.from({ length: 70 }, (_, index) => ({
		path: `folder/note-${index}.md`,
		name: `note-${index}.md`,
		stat: { mtime: 70 - index },
	}));
	assert.equal(standardPicker.getSuggestions('').length, 60);
	assert.deepEqual(standardPicker.getSuggestions('folder/note-69.md').map((file) => file.path), ['folder/note-69.md']);
	cancelNextModal = true;
	assert.equal(await plugin.getFileToCompare(targetFile), null, 'cancelling comparison must resolve cleanly');
	for (const [id, name] of [
		['bigao-compare', '比稿：对比两篇'],
		['bigao-compare-and-merge', '比稿：对比并合并'],
		['bigao-find-sync-conflicts', '比稿：查找同步冲突并合并'],
	]) {
		assert.equal(commands.find((candidate) => candidate.id === id)?.name, name);
	}
	for (const [id, name, direction] of [
		['bigao-panel-on', '比稿：开启左右分屏对照', 'vertical'],
		['bigao-panel-on-horizontal', '比稿：开启上下分屏对照', 'horizontal'],
	]) {
		const command = commands.find((candidate) => candidate.id === id);
		assert.equal(command?.name, name);
		assert.equal(typeof command?.callback, 'function');
		assert.equal(command?.editorCallback, undefined);
		await command.callback();
		assert.ok(directions.some((call) => call[0] === 'split' && call[1] === direction));
	}
	assert.equal(windowApi.__bigaoSplitComparisonsV1?.size, 1,
		'the native split pair should be tracked for two-sided inline differences');
	assert.equal([...windowApi.__bigaoSplitComparisonsV1.values()][0].sourcePath, targetFile.path);
	assert.deepEqual(
		directions.filter((call) => call[0] === 'open-file').map((call) => call.slice(1)),
		[[compareFile, { active: true }], [compareFile, { active: true }]],
		'the split pane must open the selected note in Obsidian’s native Markdown view',
	);
	assert.ok(compareLeaf.view instanceof MarkdownViewStub);
	windowApi.__bigaoSplitComparisonsV1.clear();
	compareLeaf.view = null;
	detachedLeaves.length = 0;
	silentOpenFailure = true;
	assert.equal(
		await commands.find((candidate) => candidate.id === 'bigao-panel-on').callback(),
		false,
		'a resolved openFile call must not be treated as success while the pane remains empty',
	);
	assert.deepEqual(detachedLeaves, [compareLeaf]);
	assert.equal(windowApi.__bigaoSplitComparisonsV1.size, 0);
	runtimeErrors.length = 0;
	assert.ok(views.has('bigao-differences-view'));
	assert.ok(views.has('bigao-panel-view'));
	const panelView = views.get('bigao-panel-view')(compareLeaf, app);
	panelView.setPair(targetFile, compareFile, sourceLeaf);
	assert.equal(panelView.targetFile, targetFile);
	assert.equal(panelView.sourceLeaf, sourceLeaf);
	const pendingReads = [];
	let staleDomWrites = 0;
	panelView.contentEl = {
		empty() { staleDomWrites += 1; },
		createDiv() { staleDomWrites += 1; return {}; },
	};
	panelView.readOpenEditorText = () => new Promise((resolve) => pendingReads.push(resolve));
	const staleRender = panelView.renderNow(panelView.renderRevision);
	assert.equal(pendingReads.length, 2);
	panelView.setPair(
		{ path: 'new-current.md', name: '新稿', stat: { mtime: 3 } },
		{ path: 'new-compare.md', name: '新对照稿', stat: { mtime: 2 } },
		sourceLeaf,
	);
	for (const resolve of pendingReads) resolve('line\n'.repeat(100000));
	await staleRender;
	assert.equal(staleDomWrites, 0, 'stale reads must not overwrite a newer pair');
	const pendingFailures = [];
	panelView.readOpenEditorText = () => new Promise((_resolve, reject) => pendingFailures.push(reject));
	const staleFailure = panelView.renderNow(panelView.renderRevision);
	assert.equal(pendingFailures.length, 2);
	panelView.setPair(
		{ path: 'latest-current.md', name: '最新稿', stat: { mtime: 4 } },
		{ path: 'latest-compare.md', name: '最新对照稿', stat: { mtime: 3 } },
		sourceLeaf,
	);
	for (const reject of pendingFailures) reject(new Error('stale read failure'));
	await staleFailure;
	assert.equal(staleDomWrites, 0, 'stale failures must not update the replacement view');
	assert.equal(runtimeErrors.length, 0, 'stale failures must not appear as current runtime errors');
	await panelView.onClose();
	await plugin.onunload();
	const commandsBeforeReload = commands.length;
	const reloadedModule = { exports: {} };
	new Function(
		'require', 'module', 'localStorage', 'document', 'app', 'console', 'window', builtBundle,
	)(
		(id) => id === 'obsidian' ? obsidian : {},
		reloadedModule,
		{ getItem: () => null, setItem() {} },
		{ body: { setAttribute() {} }, documentElement: { style: {} }, createElement: () => ({ style: {} }) },
		app,
		{ log() {}, error(...args) { runtimeErrors.push(args); } },
		windowApi,
	);
	const reloadedPlugin = new reloadedModule.exports.default(app);
	reloadedPlugin.onload();
	await commands.slice(commandsBeforeReload)
		.find((candidate) => candidate.id === 'bigao-panel-off').callback();
	assert.deepEqual(detachedLeaves, [compareLeaf], 'close should detach the comparison pane created by the plugin');
	await reloadedPlugin.onunload();
	assert.deepEqual(detachedTypes, [], 'onunload must not detach view leaves');
});

test('split comparisons persist across reloads and restore onto reopened panes', async () => {
	const module = { exports: {} };
	const commands = [];
	let layoutReady = null;
	let savedData = {
		comparisons: [
			{ comparePath: 'drafts/对照稿.md', sourcePath: 'current.md', direction: 'vertical' },
			{ comparePath: 'closed.md', sourcePath: 'current.md', direction: 'vertical' },
		],
	};
	class PersistPluginStub {
		constructor(runtimeApp) { this.app = runtimeApp; }
		addCommand(command) { commands.push(command); }
		registerView() {}
		registerEditorExtension() {}
		registerEvent() {}
		register() {}
		async loadData() { return savedData; }
		async saveData(data) { savedData = data; }
	}
	class PersistMarkdownView {}
	const targetFile = { path: 'current.md', name: '当前稿', stat: { mtime: 2 } };
	const compareFile = { path: 'drafts/对照稿.md', name: '对照稿.md', stat: { mtime: 1 } };
	const sourceLeaf = { view: Object.assign(new PersistMarkdownView(), { file: targetFile }) };
	const compareLeaf = { view: Object.assign(new PersistMarkdownView(), { file: compareFile }) };
	const pendingTimers = new Map();
	let nextTimerId = 0;
	const windowApi = {
		__bigaoSplitComparisonsV1: new Map(),
		setTimeout(callback) { const id = ++nextTimerId; pendingTimers.set(id, callback); return id; },
		clearTimeout(id) { pendingTimers.delete(id); },
		setInterval() { return 2; },
		clearInterval() {},
	};
	const workspace = {
		getActiveViewOfType() { return null; },
		on() { return {}; },
		onLayoutReady(callback) { layoutReady = callback; },
		getLeavesOfType(type) { return type === 'markdown' ? [sourceLeaf, compareLeaf] : []; },
		detachLeavesOfType() {},
	};
	const app = {
		workspace,
		vault: {
			on() { return {}; },
			async cachedRead() { return ''; },
			getMarkdownFiles: () => [targetFile, compareFile],
		},
	};
	const obsidian = new Proxy({}, {
		get: (_target, key) => ({
			Plugin: PersistPluginStub,
			MarkdownView: PersistMarkdownView,
		})[key] ?? class {},
	});
	new Function(
		'require', 'module', 'localStorage', 'document', 'app', 'console', 'window', builtBundle,
	)(
		(id) => id === 'obsidian' ? obsidian : {},
		module,
		{ getItem: () => null, setItem() {} },
		{ body: { setAttribute() {} }, documentElement: { style: {} }, createElement: () => ({ style: {} }) },
		app,
		{ log() {}, error() {} },
		windowApi,
	);
	const plugin = new module.exports.default(app);
	plugin.onload();
	assert.equal(typeof layoutReady, 'function', 'restore waits for the workspace layout');
	await layoutReady();
	const registry = windowApi.__bigaoSplitComparisonsV1;
	assert.equal(registry.size, 1, 'only the pair whose panes are both open is restored');
	const [leaf, comparison] = registry.entries().next().value;
	assert.equal(leaf, compareLeaf);
	assert.equal(comparison.comparePath, compareFile.path);
	assert.equal(comparison.sourcePath, targetFile.path);
	assert.equal(comparison.sourceLeaf, sourceLeaf);
	assert.equal(comparison.direction, 'vertical');
	assert.equal(pendingTimers.size, 1, 'restoring schedules an inline-diff refresh');
	assert.deepEqual(
		savedData,
		{ comparisons: [{ comparePath: compareFile.path, sourcePath: targetFile.path, direction: 'vertical' }] },
		'persisting after restore prunes entries whose panes no longer exist',
	);
	workspace.getLeavesOfType = () => [];
	await plugin.onunload();
	assert.deepEqual(savedData, { comparisons: [] }, 'unloading with no open panes clears the persisted state');
});

