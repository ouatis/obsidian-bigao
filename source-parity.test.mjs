import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const installed = await readFile(new URL('./main.js', import.meta.url), 'utf8');
const candidate = (await build({
	stdin: {
		contents: `
			export { default as Plugin } from './src/main.ts';
			export { computePanelDifferences as compute } from './src/data/panel_differences.ts';
			export { tokenizeWords as tokenize, diffWordsWithTokenizer as diffWords } from './src/utils/word_diff.ts';
			export { FileDifferences } from './src/data/file_differences.ts';
			export { structuredPatch } from 'diff';
			export { DifferencesView } from './src/components/differences_view.ts';
			export { ActionLine } from './src/components/action_line.ts';
			export { renderFull } from './src/components/bigao_panel_render.ts';
			export { applyPalette } from './src/utils/palette.ts';
		`,
		resolveDir: root,
	},
	bundle: true, write: false, format: 'cjs', platform: 'node',
	external: ['obsidian'], target: 'es2022',
})).outputFiles[0].text;
const installedExports = `
	module.exports = {
		Plugin: FileDiffPlugin, compute: computePanelDifferences,
		tokenize: tokenizeWords,
		diffWords: diffWordsWithTokenizer, FileDifferences, structuredPatch,
		DifferencesView, ActionLine,
		renderFull, applyPalette,
	};
`;

class ElementStub {
	constructor(options = {}) {
		this.text = options.text ?? '';
		this.classes = options.cls?.split(' ') ?? [];
		this.children = [];
		this.dataset = {};
		this.style = {};
		this.classList = { add: (...names) => this.classes.push(...names) };
	}
	set textContent(value) { this.text = value; }
	createDiv(options) { return this.appendChild(new ElementStub(options)); }
	createSpan(options) { return this.appendChild(new ElementStub(options)); }
	appendChild(child) { this.children.push(child); return child; }
	empty() { this.children = []; }
	addClass(value) { this.classes.push(value); }
	setAttribute() {}
	snapshot() {
		return { text: this.text, classes: this.classes, dataset: this.dataset,
			children: this.children.map((child) => child.snapshot()) };
	}
}

function loadRuntime(kind, settings = {}) {
	const commands = [];
	const views = new Map();
	const attributes = {};
	const errors = [];
	class PluginStub {
		constructor(app) {
			this.app = app;
			this.manifest = { id: 'bigao', dir: '.obsidian/plugins/bigao' };
		}
		addCommand(command) { commands.push(command); }
		registerView(type, factory) { views.set(type, factory); }
		registerEvent() {}
		register() {}
		registerEditorExtension() { assert.fail('must not register a foreign CodeMirror extension'); }
		async loadData() { return null; }
		async saveData() {}
	}
	class ItemViewStub {
		constructor(leaf) { this.leaf = leaf; this.app = leaf.app; this.contentEl = new ElementStub(); }
		registerEvent() {}
	}
	const obsidian = new Proxy({}, { get: (_target, key) => ({
		Plugin: PluginStub, ItemView: ItemViewStub,
	})[key] ?? class {} });
	const document = {
		body: { setAttribute: (name, value) => { attributes[name] = value; } },
		createElement: () => new ElementStub(),
	};
	const app = {
		workspace: { on() {}, onLayoutReady() {}, getLeavesOfType: () => [], detachLeavesOfType() {} },
		vault: { on() {}, getMarkdownFiles: () => [], adapter: { getFullPath: (path) => path } },
	};
	const module = { exports: {} };
	new Function('require', 'module', 'localStorage', 'document', 'window', 'console', 'createEl',
		kind === 'installed' ? installed + installedExports : candidate)(
		(id) => id === 'obsidian' ? obsidian : {
			registerInlineDiffRuntime() {}, scheduleInlineDiffRefresh() {}, clearInlineDiffForLeaves() {},
		},
		module,
		{ getItem: (key) => settings[key] ?? null },
		document,
		{ setTimeout: () => 1, clearTimeout() {}, setInterval: () => 2, clearInterval() {} },
		{ log() {}, error: (...args) => errors.push(args) },
		(tag) => document.createElement(tag),
	);
	return { api: module.exports, commands, views, app, attributes, errors };
}

function corpus() {
	const cases = [
		['', ''], ['一行', '另一行'], ['同一行\n', '同一行\n'],
		['我喜欢春天。', '我喜欢秋天。'], ['hello  world', 'hello world'],
		['before\nafter\n', 'before\ninserted\nafter\n'],
		['甲\r\n乙\r\n', '甲\r\n丙\r\n'], ['🙂  Café', '🙂 café'],
		['重复\n重复\n末尾', '重复\n插入\n重复\n末尾'],
	];
	const words = ['春天', '秋天', 'hello', 'world', 'café', '🙂', '。', ' ', '\t', 'α', '尾声'];
	let seed = 4217;
	const next = (limit) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
	for (let index = 0; index < 100; index += 1) {
		const lines = Array.from({ length: 1 + next(8) }, () =>
			Array.from({ length: 1 + next(8) }, () => words[next(words.length)]).join(''));
		const modified = [...lines];
		modified.splice(next(modified.length), next(3), `${words[next(words.length)]} 修订`);
		cases.push([lines.join('\n'), modified.join('\n')]);
	}
	return cases;
}

const cases = corpus();
const plain = (value) => JSON.parse(JSON.stringify(value));

for (const enabled of ['1', '0']) {
	test(`source matches installed tokenization, diff ranges and word spans (Chinese=${enabled})`, () => {
		const settings = { 'bigao-zh-diff': enabled };
		const original = loadRuntime('installed', settings).api;
		const source = loadRuntime('source', settings).api;
		for (const [left, right] of cases) {
			assert.deepEqual(source.tokenize(left), original.tokenize(left), `tokens: ${JSON.stringify(left)}`);
			assert.deepEqual(source.compute(left, right, source.tokenize), original.compute(left, right, original.tokenize),
				`ranges: ${JSON.stringify([left, right])}`);
			const normalize = (changes) => changes.map(({ value, added, removed }) =>
				({ value, added: Boolean(added), removed: Boolean(removed) }));
			assert.deepEqual(normalize(source.diffWords(left, right)), normalize(original.diffWords(left, right)),
				`word spans: ${JSON.stringify([left, right])}`);
		}
	});
}

test('source matches installed full-diff line mapping and visible rendering', () => {
	const original = loadRuntime('installed').api;
	const source = loadRuntime('source').api;
	for (const [left, right] of cases) {
		const fullDiff = (api) => api.FileDifferences.fromParsedDiff(api.structuredPatch(
			'left.md', 'right.md', left, right, undefined, undefined, { context: 0 }));
		assert.deepEqual(plain(fullDiff(source)), plain(fullDiff(original)));
		const lineDOM = (api) => api.DifferencesView.prototype.buildDiffLine
			.call({}, left, right, 'changed').snapshot();
		assert.deepEqual(lineDOM(source), lineDOM(original), `line DOM: ${JSON.stringify([left, right])}`);
		const render = (api) => {
			const container = new ElementStub();
			api.renderFull(container, left.split('\n'), api.compute(left, right, api.tokenize));
			return container.snapshot();
		};
		assert.deepEqual(render(source), render(original));
	}
});

test('source preserves all installed command IDs, names, view types and risk-warning key', () => {
	const snapshots = ['installed', 'source'].map((kind) => {
		const runtime = loadRuntime(kind);
		const plugin = new runtime.api.Plugin(runtime.app);
		plugin.onload();
		assert.deepEqual(runtime.errors, []);
		return {
			commands: runtime.commands.map(({ id, name, callback, editorCallback }) =>
				({ id, name, callback: typeof callback, editorCallback: typeof editorCallback })),
			views: [...runtime.views.keys()], warningKey: plugin.fileDiffMergeWarningKey,
		};
	});
	assert.deepEqual(snapshots[1], snapshots[0]);
});

test('source preserves all five palettes and invalid-setting fallback', () => {
	for (const value of [null, 'scriptorium', 'classic', 'mono', 'ocean', 'forest', 'invalid']) {
		const snapshots = ['installed', 'source'].map((kind) => {
			const runtime = loadRuntime(kind, { 'bigao-palette': value });
			runtime.api.applyPalette();
			return runtime.attributes;
		});
		assert.deepEqual(snapshots[1], snapshots[0]);
	}
});

test('all eight merge actions preserve installed results and use the injected vault', async () => {
	for (const method of ['acceptTopClick', 'acceptBottomClick', 'acceptAllClick', 'acceptNoneClick',
		'insertFile1Difference', 'insertFile2Difference', 'discardFile1Difference', 'discardFile2Difference']) {
		const snapshots = [];
		for (const kind of ['installed', 'source']) {
			const { api } = loadRuntime(kind);
			const writes = [];
			let rebuilt = 0;
			let prevented = 0;
			const difference = { file1Start: 1, file2Start: 1, file1Lines: ['原稿'], file2Lines: ['改稿'] };
			const action = new api.ActionLine({
				app: { vault: { modify: async (file, text) => writes.push({ path: file.path, text }) } },
				file1: { path: 'left.md' }, file2: { path: 'right.md' },
				file1Content: '开头\n原稿\n结尾', file2Content: '开头\n改稿\n结尾', difference,
				triggerRebuild: () => { rebuilt += 1; },
			});
			await action[method]({ preventDefault() { prevented += 1; } }, difference);
			snapshots.push({ writes, rebuilt, prevented });
		}
		assert.deepEqual(snapshots[1], snapshots[0], method);
		assert.equal(snapshots[1].rebuilt, 1);
	}
});

test('source finds exactly the same sync conflicts without matching notes in other folders', () => {
	const files = [
		{ name: '稿件.md', path: 'drafts/稿件.md', parent: { path: 'drafts' } },
		{ name: '稿件.md', path: 'archive/稿件.md', parent: { path: 'archive' } },
		{ name: '稿件.sync-conflict-20261017-120000-ABC123.md', parent: { path: 'drafts' } },
		{ name: 'missing.sync-conflict-20261017-120000-ABC123.md', parent: { path: 'drafts' } },
	];
	const snapshots = ['installed', 'source'].map((kind) => {
		const runtime = loadRuntime(kind);
		runtime.app.vault.getMarkdownFiles = () => files;
		return new runtime.api.Plugin(runtime.app).findSyncConflicts();
	});
	assert.deepEqual(snapshots[1], snapshots[0]);
	assert.equal(snapshots[1].length, 1);
});

test('production source build is deterministic, matches the candidate, and bundles no CodeMirror runtime', async () => {
	const options = {
		absWorkingDir: root, entryPoints: ['src/main.ts'], bundle: true, write: false,
		external: ['obsidian', 'electron', ...builtinModules], format: 'cjs', target: 'es2022',
		sourcemap: false, treeShaking: true, minify: true, metafile: true, outfile: 'dist/main.js',
	};
	const first = await build(options);
	const second = await build(options);
	assert.equal(first.outputFiles[0].text, second.outputFiles[0].text);
	assert.equal(first.outputFiles[0].text, await readFile(new URL('./dist/main.js', import.meta.url), 'utf8'));
	assert.ok(!Object.keys(first.metafile.inputs).some((name) => name.includes('@codemirror/')));
	assert.equal(await readFile(new URL('./main.js', import.meta.url), 'utf8'), installed,
		'rebuilding the source must leave the installed runtime untouched');
});
