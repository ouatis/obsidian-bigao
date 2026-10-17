import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const helperBundle = await readFile(join(root, 'dist', 'inline-diff-runtime-v9.js'), 'utf8');

test('inline-diff helper refreshes on edits, layout changes, and saved-file modifications without registering CM extensions', () => {
	const pendingTimers = new Map();
	const listeners = [];
	const registeredEvents = [];
	let cleanup;
	let nextTimerId = 0;
	const windowApi = {
		setTimeout(callback) {
			const id = ++nextTimerId;
			pendingTimers.set(id, callback);
			return id;
		},
		clearTimeout(id) { pendingTimers.delete(id); },
	};
	const module = { exports: {} };
	new Function('require', 'module', 'window', 'document', 'console', helperBundle)(
		(id) => id === 'obsidian' ? {} : {},
		module,
		windowApi,
		{},
		{ error(...args) { throw new Error(String(args[0])); } },
	);

	const app = {
		workspace: {
			getLeavesOfType() { return []; },
			on(event, callback) { listeners.push([event, callback]); return { event }; },
		},
		vault: { on(event, callback) { listeners.push([event, callback]); return { event }; } },
	};
	const plugin = {
		app,
		registerEditorExtension() { assert.fail('inline overlay must not register a CodeMirror extension'); },
		registerEvent(eventRef) { registeredEvents.push(eventRef); },
		register(callback) { cleanup = callback; },
	};
	module.exports.registerInlineDiffRuntime(plugin);

	assert.deepEqual(listeners.map(([event]) => event), ['editor-change', 'layout-change', 'modify']);
	assert.equal(registeredEvents.length, 3);
	assert.equal(pendingTimers.size, 1, 'initial refresh should be deferred');
	const [timerId, runRefresh] = pendingTimers.entries().next().value;
	pendingTimers.delete(timerId);
	runRefresh();
	assert.equal(pendingTimers.size, 0);
	cleanup();
	assert.equal(pendingTimers.size, 0);
});

test('renders word highlights in both visible Markdown panes without changing either document', () => {
	const pendingTimers = new Map();
	let nextTimerId = 0;
	class FakeElement {
		constructor(rect = {}) {
			this.children = [];
			this.style = {};
			this.rect = { left: 0, top: 0, width: 0, height: 0, ...rect };
			this.scrollLeft = 0;
			this.scrollTop = 0;
			this.className = '';
			this.parentElement = null;
		}
		setAttribute() {}
		appendChild(child) {
			child.parentElement = this;
			this.children.push(child);
			return child;
		}
		addEventListener() {}
		removeEventListener() {}
		remove() {
			if (this.parentElement) {
				this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
				this.parentElement = null;
			}
		}
		replaceChildren(...children) {
			this.children = children.flatMap((child) => child.isFragment ? child.children : [child]);
			for (const child of this.children) child.parentElement = this;
		}
		getBoundingClientRect() { return this.rect; }
	}
	class FakeFragment {
		constructor() { this.children = []; this.isFragment = true; }
		appendChild(child) { this.children.push(child); return child; }
	}
	const makeLeaf = (path, text, left) => {
		const scrollDOM = new FakeElement({ left, top: 50, width: 420, height: 700 });
		const lineElement = new FakeElement({ left, top: 80, width: 420, height: 24 });
		lineElement.nodeType = 1;
		lineElement.closest = (selector) => selector === '.cm-line' ? lineElement : null;
		const cm = {
			scrollDOM,
			dom: scrollDOM,
			viewport: { from: 0, to: text.length },
			state: { doc: { toString: () => text } },
			domAtPos: () => ({ node: lineElement, offset: 0 }),
		};
		const editor = { cm, getValue: () => text };
		return { view: { file: { path }, editor }, scrollDOM, text };
	};
	const sourceLeaf = makeLeaf('source.md', 'the bright moon', 0);
	const compareLeaf = makeLeaf('compare.md', 'the quiet moon', 500);
	const pendingMap = new Map([
		[compareLeaf, {
			comparePath: 'compare.md',
			sourcePath: 'source.md',
			direction: 'vertical',
			sourceLeaf,
		}],
	]);
	const windowApi = {
		__bigaoSplitComparisonsV1: pendingMap,
		setTimeout(callback) {
			const id = ++nextTimerId;
			pendingTimers.set(id, callback);
			return id;
		},
		clearTimeout(id) { pendingTimers.delete(id); },
	};
	const documentApi = {
		createElement: () => new FakeElement(),
		createDocumentFragment: () => new FakeFragment(),
		createRange() {
			return {
				setStart() {},
				setEnd() {},
				getClientRects: () => [{ left: 20, top: 90, width: 48, height: 20 }],
				detach() {},
			};
		},
	};
	const module = { exports: {} };
	new Function('require', 'module', 'window', 'document', 'console', 'Node', helperBundle)(
		(id) => id === 'obsidian' ? {} : {},
		module,
		windowApi,
		documentApi,
		{ error(...args) { throw new Error(String(args[0])); } },
		{ ELEMENT_NODE: 1 },
	);
	const listeners = [];
	const app = {
		workspace: {
			getLeavesOfType: () => [sourceLeaf, compareLeaf],
			on(event, callback) { listeners.push([event, callback]); return { event }; },
		},
		vault: { on(event, callback) { listeners.push([event, callback]); return { event }; } },
	};
	const plugin = { app, registerEvent() {}, register() {} };
	module.exports.registerInlineDiffRuntime(plugin);
	while (pendingTimers.size) {
		const [id, callback] = pendingTimers.entries().next().value;
		pendingTimers.delete(id);
		callback();
	}

	for (const leaf of [sourceLeaf, compareLeaf]) {
		const overlay = leaf.scrollDOM.children.find((child) => child.className === 'bigao-inline-overlay');
		assert.ok(overlay, `${leaf.view.file.path} should have an overlay`);
		assert.ok(
			overlay.children.some((child) => child.className === 'bigao-inline-add'),
			`${leaf.view.file.path} should render its changed word highlight`,
		);
	}
	assert.equal(sourceLeaf.view.editor.getValue(), 'the bright moon');
	assert.equal(compareLeaf.view.editor.getValue(), 'the quiet moon');
});
