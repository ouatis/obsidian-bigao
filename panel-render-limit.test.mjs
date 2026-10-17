import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const pluginDir = dirname(fileURLToPath(import.meta.url));
const bundle = await readFile(join(pluginDir, "main.js"), "utf8");
const styles = await readFile(join(pluginDir, "styles.css"), "utf8");
const manifest = JSON.parse(await readFile(join(pluginDir, "manifest.json"), "utf8"));
const packageInfo = JSON.parse(await readFile(join(pluginDir, "package.json"), "utf8"));
const maxLines = Number(bundle.match(/var MAX_LINES = (\d+);/)?.[1]);
assert.ok(Number.isInteger(maxLines) && maxLines > 0, "Could not read MAX_LINES from the plugin bundle");

const diffStart = bundle.indexOf("function Diff() {");
const diffEnd = bundle.indexOf("// src/utils/string_utils.ts", diffStart);
assert.notEqual(diffStart, -1, "Could not find bundled diff engine");
assert.notEqual(diffEnd, -1, "Could not find the end of the bundled diff engine");
const diffRuntime = new Function(
  "require",
  `${bundle.slice(diffStart, diffEnd)}\nreturn { structuredPatch, FileDifferences };`,
)(() => ({}));

const panelStart = bundle.indexOf("var MAX_LINES = 4000;");
const panelEnd = bundle.indexOf("// ---- 渲染：只操作面板自己的 DOM ----", panelStart);
assert.notEqual(panelStart, -1, "Could not find the side-panel comparison engine");
assert.notEqual(panelEnd, -1, "Could not find the end of the side-panel comparison engine");
function createPanelEngine(wordDiff) {
  return new Function(
    "structuredPatch",
    "FileDifferences",
    "wordDiff",
    `${bundle.slice(panelStart, panelEnd)}\nreturn { compute };`,
  )(diffRuntime.structuredPatch, diffRuntime.FileDifferences, wordDiff);
}

const panelEngine = createPanelEngine({
  tokenize: (value) => value.split(/(\s+)/),
});

test("local package version matches the installed plugin manifest", () => {
  assert.equal(manifest.id, "bigao");
  assert.equal(packageInfo.version, manifest.version);
});

test("bundle registers and runs both native split comparison commands", async () => {
  const pluginModule = { exports: {} };
  const commands = [];
  const views = [];
  const splitCalls = [];
  const pairedFiles = [];
  const inlineDiffCalls = [];
  const targetFile = { path: "target.md", name: "当前稿", stat: { mtime: 2 } };
  const compareFile = { path: "compare.md", name: "对照稿", stat: { mtime: 1 } };
  const duplicateNameFile = { path: "archive/对照稿.md", name: "对照稿.md", parent: { path: "archive" }, stat: { mtime: 0 } };
  const attachmentFile = { path: "scan.pdf", name: "scan.pdf", stat: { mtime: 100 } };
  let getFilesCalls = 0;
  let cancelNextModal = false;
  let holdNextModalOpen = false;
  const openedModals = [];
  const detachedLeaves = [];
  const sourceLeaf = { id: "source" };
  const sourceView = Object.assign(new SplitMarkdownViewStub(), { file: targetFile, leaf: sourceLeaf });
  sourceLeaf.view = sourceView;
  const markdownLeaves = [sourceLeaf];
  const compareLeaf = {
    view: null,
    async openFile(file, state) {
      splitCalls.push(["open-file", file, state]);
      this.view = new SplitMarkdownViewStub();
      this.view.file = file;
      if (!markdownLeaves.includes(this)) markdownLeaves.push(this);
    },
    detach() { detachedLeaves.push(this); },
  };
  const appStub = {
    vault: {
      adapter: { getFullPath(path) { return `C:/mock/${path}`; } },
      getMarkdownFiles: () => [targetFile, compareFile, duplicateNameFile],
      getFiles() { getFilesCalls += 1; return [targetFile, compareFile, duplicateNameFile, attachmentFile]; },
    },
    workspace: {
      getActiveViewOfType() { return sourceView; },
      getActiveFile() { return targetFile; },
      detachLeavesOfType(type) { splitCalls.push(["detach", type]); },
      getLeavesOfType(type) {
        return type === "markdown" ? markdownLeaves : [];
      },
      createLeafBySplit(source, direction) {
        splitCalls.push(["split", source, direction]);
        return compareLeaf;
      },
      revealLeaf(leaf) { splitCalls.push(["reveal", leaf]); },
    },
  };
  const persistentWindow = {};
  class ObsidianPluginStub {
    constructor(app) { this.app = app; this.manifest = { id: "bigao", dir: ".obsidian/plugins/bigao" }; }
    addCommand(command) { commands.push(command); }
    registerView(type, factory) { views.push({ type, factory }); }
  }
  class SuggestModalStub {
    constructor(app) { this.app = app; openedModals.push(this); }
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
      const suggestion = this.getSuggestions("")[0];
      if (suggestion) this.onChooseSuggestion(suggestion, {});
      else this.close();
    }
    close() { if (typeof this.onClose === "function") this.onClose(); }
  }
  const obsidianStub = new Proxy({}, {
    get: (_target, property) => property === "Plugin" ? ObsidianPluginStub :
      property === "SuggestModal" ? SuggestModalStub :
      property === "MarkdownView" ? SplitMarkdownViewStub : class ObsidianStub {},
  });
  const inlineDiffStub = {
    registerInlineDiffRuntime() { inlineDiffCalls.push(["register"]); },
    scheduleInlineDiffRefresh(app) { inlineDiffCalls.push(["refresh", app]); },
    clearInlineDiffForLeaves(source, compare) { inlineDiffCalls.push(["clear", source, compare]); },
  };
  const requireStub = (id) => id === "obsidian" ? obsidianStub :
    String(id).endsWith("inline-diff-runtime-v9.js") ? inlineDiffStub : {};
  const storageStub = { getItem: () => null, setItem() {} };
  const documentStub = {
    body: { setAttribute() {} },
    createElement() {
      return {
        classList: { add() {} },
        appendChild() {},
        textContent: "",
      };
    },
  };

  new Function(
    "require",
    "module",
    "localStorage",
    "document",
    "app",
    "console",
    "window",
    bundle,
  )(
    requireStub,
    pluginModule,
    storageStub,
    documentStub,
    appStub,
    { log() {}, error() {} },
    persistentWindow,
  );

  assert.equal(typeof pluginModule.exports.default, "function");
  const plugin = new pluginModule.exports.default(appStub);
  plugin.onload();
  assert.deepEqual(inlineDiffCalls[0], ["register"]);
  assert.equal(await plugin.getFileToCompare(targetFile), compareFile);
  assert.equal(getFilesCalls, 0, "the shared comparison picker must exclude non-Markdown attachments");
  const standardPicker = openedModals.at(-1);
  assert.deepEqual(standardPicker.getSuggestions("archive/对照稿.md"), [duplicateNameFile]);
  const renderedSuggestion = [];
  standardPicker.renderSuggestion(duplicateNameFile, {
    createDiv(options) { renderedSuggestion.push(options); },
  });
  assert.deepEqual(renderedSuggestion, [
    { text: "对照稿.md" },
    { cls: "bigao-pick__dir", text: "archive" },
  ]);
  holdNextModalOpen = true;
  const choiceAfterClose = plugin.getFileToCompare(targetFile);
  const delayedModal = openedModals.at(-1);
  delayedModal.onClose();
  delayedModal.onChooseSuggestion(compareFile, {});
  assert.equal(await choiceAfterClose, compareFile,
    "a same-turn choice must win even when Obsidian invokes onClose before onChooseSuggestion");
  standardPicker.files = Array.from({ length: 70 }, (_, index) => ({
    path: `folder/note-${index}.md`,
    name: `note-${index}.md`,
    stat: { mtime: 70 - index },
  }));
  assert.equal(standardPicker.getSuggestions("").length, 60);
  assert.deepEqual(standardPicker.getSuggestions("folder/note-69.md").map((file) => file.path), ["folder/note-69.md"]);
  cancelNextModal = true;
  assert.equal(await plugin.getFileToCompare(targetFile), null, "cancelling the picker must settle the command");
  const byId = new Map(commands.map((command) => [command.id, command]));
  assert.equal(byId.get("bigao-panel-on")?.name, "比稿：开启左右分屏对照");
  assert.equal(typeof byId.get("bigao-panel-on")?.callback, "function");
  assert.equal(byId.get("bigao-panel-on")?.editorCallback, undefined);
  assert.equal(byId.get("bigao-panel-on-horizontal")?.name, "比稿：开启上下分屏对照");
  assert.equal(typeof byId.get("bigao-panel-on-horizontal")?.callback, "function");
  assert.equal(byId.get("bigao-panel-on-horizontal")?.editorCallback, undefined);
  assert.equal(byId.get("bigao-panel-off")?.name, "比稿：关闭分屏对照");
  assert.ok(views.some((view) => view.type === "bigao-panel-view"));
  await byId.get("bigao-panel-on").callback();
  await byId.get("bigao-panel-on-horizontal").callback();
  assert.equal(persistentWindow.__bigaoSplitComparisonsV1.size, 1);
  assert.equal([...persistentWindow.__bigaoSplitComparisonsV1.values()][0].sourcePath, targetFile.path);
  assert.ok(inlineDiffCalls.some(([kind]) => kind === "refresh"));
  assert.deepEqual(
    splitCalls.filter(([kind]) => kind === "split").map(([, source, direction]) => [source, direction]),
    [[sourceLeaf, "vertical"], [sourceLeaf, "horizontal"]],
  );
  assert.deepEqual(
    splitCalls.filter(([kind]) => kind === "open-file").map(([, file, state]) => [file, state]),
    [[compareFile, { active: true }], [compareFile, { active: true }]],
  );
  assert.ok(compareLeaf.view instanceof SplitMarkdownViewStub);
  await plugin.onunload();
  const reloadedModule = { exports: {} };
  const commandsBeforeReload = commands.length;
  new Function(
    "require",
    "module",
    "localStorage",
    "document",
    "app",
    "console",
    "window",
    bundle,
  )(
    requireStub,
    reloadedModule,
    storageStub,
    documentStub,
    appStub,
    { log() {}, error() {} },
    persistentWindow,
  );
  const reloadedPlugin = new reloadedModule.exports.default(appStub);
  reloadedPlugin.onload();
  const reloadedOffCommand = commands.slice(commandsBeforeReload)
    .find((command) => command.id === "bigao-panel-off");
  await reloadedOffCommand.callback();
  assert.ok(inlineDiffCalls.some(([kind, source, compare]) =>
    kind === "clear" && source === sourceLeaf && compare === compareLeaf));
  assert.deepEqual(detachedLeaves, [compareLeaf]);
  await reloadedPlugin.onunload();
  assert.deepEqual(
    splitCalls.filter(([kind]) => kind === "detach").map(([, type]) => type),
    ["bigao-differences-view", "bigao-panel-view", "bigao-differences-view", "bigao-panel-view"],
  );
});

function extractMethodBody(source, marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Could not find ${marker}`);
  const openingBrace = source.indexOf("{", start);
  assert.notEqual(openingBrace, -1, "Could not find method body");

  let depth = 1;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = openingBrace + 1; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      i += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      i += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}" && --depth === 0) return source.slice(openingBrace + 1, i);
  }

  assert.fail(`Could not find the end of ${marker}`);
}

const renderNowBody = extractMethodBody(bundle, "async renderNow(renderRevision = this._renderRevision) {");
const scheduleRenderBody = extractMethodBody(bundle, "scheduleRender() {");
const readEditorBody = extractMethodBody(bundle, "function _bigaoReadOpenEditorText(plugin, file) {");
const MarkdownViewStub = class MarkdownViewStub {};
const readOpenEditorText = new Function(
  "MarkdownView",
  `return function (plugin, file) { ${readEditorBody} }`,
)(MarkdownViewStub);
const renderFullBody = extractMethodBody(bundle, "function _bprRenderFull(container, docLines, diffs) {");
const renderFull = new Function(`return function (container, docLines, diffs) { ${renderFullBody} }`)();
const onOpenBody = extractMethodBody(bundle, "async onOpen() {");
const panelOnOpen = new Function(
  "console",
  `return async function () { ${onOpenBody} }`,
)({ error() {} });
const startFollowBody = extractMethodBody(bundle, "_startFollowPolling() {");
const stopFollowBody = extractMethodBody(bundle, "_stopFollowPolling() {");
const followCursorBody = extractMethodBody(bundle, "followCursor(force) {");
const acceptTopBody = extractMethodBody(bundle, "async acceptTopClick(event, difference) {");
const openSplitComparisonBody = extractMethodBody(bundle, "async function _bigaoOpenSplitComparison(");
const closeSplitComparisonBody = extractMethodBody(bundle, "function _bigaoCloseSplitComparison(");
const startSplitComparisonBody = extractMethodBody(bundle, "async function _bigaoStartSplitComparison(");
const differencesUpdateBody = extractMethodBody(bundle, "async updateState() {");
const differencesBuildBody = extractMethodBody(bundle, "build() {\n    this.contentEl.empty();");
const differencesBuildLinesBody = extractMethodBody(bundle, "buildLines(container) {");
const fullDiffReadEditorBody = extractMethodBody(bundle, "async function _bigaoReadOpenEditorText(app, file) {");
const readFullDiffEditorText = new Function(
  "MarkdownView",
  `return async function (app, file) { ${fullDiffReadEditorBody.replaceAll("import_obsidian2.MarkdownView", "MarkdownView")} }`,
)(MarkdownViewStub);
const maxComparisonLines = Number(bundle.match(/var MAX_COMPARISON_LINES = (\d+);/)?.[1]);
const maxComparisonCharacters = Number(bundle.match(/var MAX_COMPARISON_CHARACTERS = (\d+);/)?.[1]);
const maxComparisonDiffEdits = Number(bundle.match(/var MAX_COMPARISON_DIFF_EDITS = (\d+);/)?.[1]);
const comparisonDiffTimeoutMs = Number(bundle.match(/var COMPARISON_DIFF_TIMEOUT_MS = (\d+);/)?.[1]);
assert.ok(Number.isInteger(maxComparisonLines) && maxComparisonLines > 0);
assert.ok(Number.isInteger(maxComparisonCharacters) && maxComparisonCharacters > 0);
assert.ok(Number.isInteger(maxComparisonDiffEdits) && maxComparisonDiffEdits > 0);
assert.ok(Number.isInteger(comparisonDiffTimeoutMs) && comparisonDiffTimeoutMs > 0);
function createDifferencesUpdater(structuredPatchImpl = diffRuntime.structuredPatch) {
  return new Function(
    "structuredPatch", "FileDifferences", "MAX_COMPARISON_LINES",
    "MAX_COMPARISON_CHARACTERS", "MAX_COMPARISON_DIFF_EDITS",
    "COMPARISON_DIFF_TIMEOUT_MS", "_bigaoReadOpenEditorText", "console",
    `return async function () { ${differencesUpdateBody} }`,
  )(
    structuredPatchImpl, diffRuntime.FileDifferences,
    maxComparisonLines, maxComparisonCharacters, maxComparisonDiffEdits,
    comparisonDiffTimeoutMs, readFullDiffEditorText, { error() {} },
  );
}
const splitNotices = [];
const splitComparisonMap = new Map();
const splitInlineCalls = [];
const splitInlineRuntime = {
  scheduleInlineDiffRefresh(app) { splitInlineCalls.push(["refresh", app]); },
  clearInlineDiffForLeaves(source, compare) { splitInlineCalls.push(["clear", source, compare]); },
};
const SplitMarkdownViewStub = class SplitMarkdownViewStub {};
class TestNotice {
  constructor(message) { splitNotices.push(message); }
}
const openSplitComparison = new Function(
  "BIGAO_PANEL_VIEW",
  "_bigaoSplitComparisons",
  "MarkdownView",
  "Notice",
  "BigaoInlineDiffRuntime",
  "console",
  `return async function (plugin, targetFile, compareFile, sourceLeaf, direction) { ${openSplitComparisonBody} }`,
)("bigao-panel-view", splitComparisonMap, SplitMarkdownViewStub, TestNotice, splitInlineRuntime, { error() {} });
const closeSplitComparison = new Function(
  "BIGAO_PANEL_VIEW",
  "_bigaoSplitComparisons",
  "MarkdownView",
  "BigaoInlineDiffRuntime",
  `return function (app) { ${closeSplitComparisonBody} }`,
)("bigao-panel-view", splitComparisonMap, SplitMarkdownViewStub, splitInlineRuntime);
const startSplitComparison = new Function(
  "MarkdownView",
  "Notice",
  "_bigaoPickCompareFile",
  "_bigaoOpenSplitComparison",
  "console",
  `return async function (plugin, direction, sourceView) { ${startSplitComparisonBody} }`,
)(class MarkdownViewStub {}, TestNotice, async () => null, openSplitComparison, { error() {} });

function fakeElement(options = {}) {
  const element = {
    children: [],
    classes: new Set(),
    dataset: {},
    textContent: options.text || "",
    empty() {
      this.children = [];
    },
    addClass(className) {
      this.classes.add(className);
    },
    createDiv(childOptions = {}) {
      const child = fakeElement(childOptions);
      this.children.push(child);
      return child;
    },
    createSpan(childOptions = {}) {
      const child = fakeElement(childOptions);
      this.children.push(child);
      return child;
    },
  };
  if (options.cls) element.classes.add(options.cls);
  return element;
}

async function renderAtLineCounts(targetCount, otherCount = 1, openEditorTexts = {}) {
  let computeCalls = 0;
  let renderCalls = 0;
  let computeArgs = null;
  let renderedLines = null;
  const emptyMessages = [];
  const targetFile = { path: "target.md" };
  const compareFile = { path: "compare.md" };
  const openLeaves = [];
  if (Object.hasOwn(openEditorTexts, "target")) {
    openLeaves.push({ view: { file: targetFile, editor: { getValue: () => openEditorTexts.target } } });
  }
  if (Object.hasOwn(openEditorTexts, "compare")) {
    openLeaves.push({ view: { file: compareFile, editor: { getValue: () => openEditorTexts.compare } } });
  }
  const renderNow = new Function(
    "MAX_LINES",
    "BigaoPanel",
    "BigaoPanelRender",
    "MarkdownView",
    "_bigaoReadOpenEditorText",
    "console",
    `return async function (renderRevision = this._renderRevision) { ${renderNowBody} }`,
  )(
    maxLines,
    {
      compute(...args) {
        computeCalls += 1;
        computeArgs = args;
        return [];
      },
    },
    {
      renderFull(_container, lines) {
        renderCalls += 1;
        renderedLines = lines;
        return {};
      },
    },
    MarkdownViewStub,
    readOpenEditorText,
    { error() {} },
  );

  const context = {
    _renderRevision: 0,
    targetFile,
    compareFile,
    _plugin: {
      app: {
        workspace: {
          getActiveViewOfType() { return null; },
          getLeavesOfType() { return openLeaves; },
        },
      },
    },
    _vault() {
      return {
        async cachedRead(file) {
          const count = file === targetFile ? targetCount : otherCount;
          return count === 1 && file !== targetFile
            ? "comparison"
            : Array.from({ length: count }, (_, index) => `line ${index}`).join("\n");
        },
      };
    },
    contentEl: {
      empty() {},
      createDiv(options) {
        emptyMessages.push(options.text);
      },
    },
    _buildChrome() {},
    followCursor() {},
  };

  await renderNow.call(context);
  return { computeCalls, renderCalls, computeArgs, renderedLines, emptyMessages };
}

test("ordinary full-diff reads unsaved text from active and split Markdown editors", async () => {
  const targetFile = { path: "target.md" };
  const compareFile = { path: "compare.md" };
  let cachedReads = 0;
  const activeView = Object.assign(new MarkdownViewStub(), {
    file: targetFile,
    editor: { getValue: () => "未保存的原稿" },
  });
  const splitView = Object.assign(new MarkdownViewStub(), {
    file: compareFile,
    editor: { getValue: () => "未保存的对照稿" },
  });
  const app = {
    workspace: {
      getActiveViewOfType() { return activeView; },
      getLeavesOfType() { return [{ view: activeView }, { view: splitView }]; },
    },
    vault: { async cachedRead() { cachedReads += 1; return "磁盘文本"; } },
  };

  assert.equal(await readFullDiffEditorText(app, targetFile), "未保存的原稿");
  assert.equal(await readFullDiffEditorText(app, compareFile), "未保存的对照稿");
  assert.equal(cachedReads, 0, "open editor buffers should take precedence over saved text");
  app.workspace.getActiveViewOfType = () => null;
  app.workspace.getLeavesOfType = () => [];
  assert.equal(await readFullDiffEditorText(app, targetFile), "磁盘文本");
  assert.equal(cachedReads, 1, "closed notes should fall back to the saved vault text");
});

test("shows an explicit limit message instead of claiming long notes are identical", async () => {
  const result = await renderAtLineCounts(maxLines + 1);
  assert.equal(result.computeCalls, 0);
  assert.equal(result.renderCalls, 0);
  assert.deepEqual(result.emptyMessages, [`任一篇笔记超过 ${maxLines} 行，分屏对照暂不计算。`]);
});

test("still compares a note at the supported line limit", async () => {
  const result = await renderAtLineCounts(maxLines);
  assert.equal(result.computeCalls, 1);
  assert.equal(result.renderCalls, 1);
  assert.deepEqual(result.emptyMessages, []);
});

test("also checks the comparison note against the line limit", async () => {
  const result = await renderAtLineCounts(1, maxLines + 1);
  assert.equal(result.computeCalls, 0);
  assert.equal(result.renderCalls, 0);
  assert.deepEqual(result.emptyMessages, [`任一篇笔记超过 ${maxLines} 行，分屏对照暂不计算。`]);
});

test("ignores stale async note reads after a newer render is scheduled", async () => {
  const targetFile = { path: "target.md" };
  const compareFile = { path: "compare.md" };
  const targetReads = [];
  let cachedReads = 0;
  let computeCalls = 0;
  let renderCalls = 0;
  let emptyCalls = 0;
  const errors = [];
  let timerId = 0;

  const renderNow = new Function(
    "MAX_LINES",
    "BigaoPanel",
    "BigaoPanelRender",
    "MarkdownView",
    "_bigaoReadOpenEditorText",
    "console",
    `return async function (renderRevision = this._renderRevision) { ${renderNowBody} }`,
  )(
    maxLines,
    { compute() { computeCalls += 1; return []; } },
    { renderFull() { renderCalls += 1; return {}; } },
    MarkdownViewStub,
    readOpenEditorText,
    { error(...args) { errors.push(args); } },
  );
  const scheduleRender = new Function(
    "setTimeout",
    "clearTimeout",
    "BigaoPanel",
    `return function () { ${scheduleRenderBody} }`,
  )(
    () => { timerId += 1; return timerId; },
    () => {},
    { DEBOUNCE_MS: 300 },
  );
  const context = {
    _renderRevision: 0,
    _timer: null,
    targetFile,
    compareFile,
    _plugin: {
      app: { workspace: { getLeavesOfType() { return []; } } },
    },
    _vault() {
      return {
        cachedRead(file) {
          cachedReads += 1;
          if (file === targetFile) {
            return new Promise((resolve, reject) => { targetReads.push({ resolve, reject }); });
          }
          return Promise.resolve("comparison");
        },
      };
    },
    contentEl: {
      empty() { emptyCalls += 1; },
      createDiv() { emptyCalls += 1; },
    },
    _buildChrome() {},
    followCursor() {},
  };

  scheduleRender.call(context);
  const staleRender = renderNow.call(context, context._renderRevision);
  assert.equal(targetReads.length, 1);
  scheduleRender.call(context);
  targetReads[0].resolve("stale target contents");
  await staleRender;

  scheduleRender.call(context);
  const staleFailure = renderNow.call(context, context._renderRevision);
  assert.equal(targetReads.length, 2);
  scheduleRender.call(context);
  targetReads[1].reject(new Error("stale read failure"));
  await staleFailure;

  assert.equal(cachedReads, 2, "stale renders should stop before reading the other note");
  assert.equal(computeCalls, 0);
  assert.equal(renderCalls, 0);
  assert.equal(emptyCalls, 0);
  assert.equal(errors.length, 0, "stale read failures should not be reported for the current view");
});

test("renders unsaved text from open target and comparison editors", async () => {
  const targetText = "unsaved target\nsecond line";
  const compareText = "unsaved comparison";
  const result = await renderAtLineCounts(1, 1, { target: targetText, compare: compareText });

  assert.deepEqual(result.renderedLines, targetText.split("\n"));
  assert.deepEqual(result.computeArgs.slice(0, 2), [targetText, compareText]);
});

test("refreshes on target or comparison edits and saved-file modifications only", async () => {
  const targetFile = { path: "target.md" };
  const compareFile = { path: "compare.md" };
  const otherFile = { path: "other.md" };
  let editorChange;
  let vaultModify;
  let scheduled = 0;
  let followed = 0;
  const context = {
    targetFile,
    compareFile,
    contentEl: fakeElement(),
    _plugin: {
      app: {
        workspace: {
          on(event, callback) {
            assert.equal(event, "editor-change");
            editorChange = callback;
            return {};
          },
        },
      },
    },
    _vault() {
      return {
        on(event, callback) {
          assert.equal(event, "modify");
          vaultModify = callback;
          return {};
        },
      };
    },
    registerEvent() {},
    scheduleRender() { scheduled += 1; },
    onCursorMoved() { followed += 1; },
  };

  await panelOnOpen.call(context);
  editorChange({}, { file: targetFile });
  editorChange({}, { file: compareFile });
  editorChange({}, { file: otherFile });
  assert.equal(scheduled, 2);
  assert.equal(followed, 1);

  vaultModify(targetFile);
  vaultModify(compareFile);
  vaultModify(otherFile);
  assert.equal(scheduled, 4);
});

test("polls cursor position only while follow mode is paired and enabled", () => {
  let tick;
  let delay;
  let cleared;
  let intervalCount = 0;
  const startFollowPolling = new Function(
    "setInterval",
    `return function () { ${startFollowBody} }`,
  )((callback, duration) => {
    intervalCount += 1;
    tick = callback;
    delay = duration;
    return 23;
  });
  const stopFollowPolling = new Function(
    "clearInterval",
    `return function () { ${stopFollowBody} }`,
  )((handle) => { cleared = handle; });
  let followCalls = 0;
  const context = {
    _follow: true,
    targetFile: { path: "target.md" },
    _followPoll: null,
    followCursor(force) {
      assert.equal(force, false);
      followCalls += 1;
    },
  };

  startFollowPolling.call(context);
  startFollowPolling.call(context);
  assert.equal(intervalCount, 1);
  assert.equal(delay, 250);
  tick();
  assert.equal(followCalls, 1);

  stopFollowPolling.call(context);
  assert.equal(cleared, 23);
  assert.equal(context._followPoll, null);

  context._follow = false;
  startFollowPolling.call(context);
  assert.equal(intervalCount, 1);
});

test("follows the captured source editor even while the comparison pane is active", () => {
  const targetFile = { path: "target.md" };
  const cursorCalls = [];
  const sourceLeaf = {
    view: {
      file: targetFile,
      editor: { getCursor() { return { line: 4 }; } },
    },
  };
  const run = new Function(
    "MarkdownView",
    "BigaoPanelRender",
    `return function (force) { ${followCursorBody} }`,
  )(
    class MarkdownViewStub {},
    { scrollToLine(body, line, smooth) { cursorCalls.push([body, line, smooth]); } },
  );
  const body = {};
  run.call({
    _follow: true,
    _body: body,
    targetFile,
    sourceLeaf,
    _lastLine: -1,
    _plugin: { app: { workspace: { getActiveViewOfType() { throw new Error("must not need active view"); } } } },
  }, false);

  assert.deepEqual(cursorCalls, [[body, 4, true]]);
});

test("merge actions modify the injected Obsidian app rather than a global", async () => {
  const modified = [];
  let rebuilds = 0;
  const replaceCalls = [];
  const acceptTop = new Function(
    "replaceLine",
    `return async function (event, difference) { ${acceptTopBody} }`,
  )((args) => {
    replaceCalls.push(args);
    return "updated text";
  });
  const file = { path: "target.md" };
  const context = {
    app: { vault: { async modify(target, text) { modified.push([target, text]); } } },
    file2: file,
    file2Content: "old text",
    triggerRebuild() { rebuilds += 1; },
  };

  await acceptTop.call(
    context,
    { preventDefault() {} },
    { file1Lines: ["new text"], file2Start: 3, file2Lines: ["old text"] },
  );

  assert.deepEqual(replaceCalls, [{
    fullText: "old text",
    newLine: "new text",
    position: 3,
    linesToReplace: 1,
  }]);
  assert.deepEqual(modified, [[file, "updated text"]]);
  assert.equal(rebuilds, 1);
  assert.doesNotMatch(acceptTopBody, /await\s+app\.vault\.modify/);
});

test("all merge actions and confirmation modals receive the owning app explicitly", () => {
  const actionLineStart = bundle.indexOf("var ActionLine = class {");
  const actionLineEnd = bundle.indexOf("// src/components/modals/delete_file_modal.ts", actionLineStart);
  const actionLine = bundle.slice(actionLineStart, actionLineEnd);
  assert.equal((actionLine.match(/this\.app\.vault\.modify\(/g) || []).length, 10);
  assert.doesNotMatch(actionLine, /await\s+app\.vault\.modify\(/);
  assert.equal((bundle.match(/super\(args\.app\)/g) || []).length, 2);
  assert.match(bundle, /new ActionLine\(\{\s*app: this\.app,/);
  assert.match(bundle, /new DeleteFileModal\(\{\s*app: this\.app,/);
  assert.match(bundle, /new RiskyActionModal\(\{\s*app: this\.app,/);
  assert.match(bundle, /return _bigaoPickCompareFile\(this, activeFile\);/);
  assert.doesNotMatch(bundle, /SelectFileModal/);
});

test("the installed comparison and merge UI remains Chinese-localized", () => {
  for (const label of [
    "采用上方",
    "采用下方",
    "全部采用",
    "全部放弃",
    "确定要承担此风险吗？",
    "接受风险",
    "此操作不可撤销",
  ]) {
    assert.ok(bundle.includes(label), `Expected installed bundle to include ${label}`);
  }
  assert.doesNotMatch(bundle, /Accept Top|Accept Bottom|Accept All|Accept None|Accept Risk/);
});

test("bounds ordinary full-diff inputs by line and character count", async () => {
  let diffCalls = 0;
  const updateState = createDifferencesUpdater((...args) => {
    diffCalls += 1;
    return diffRuntime.structuredPatch(...args);
  });
  const file1 = { path: "one.md", name: "第一稿" };
  const file2 = { path: "two.md", name: "第二稿" };
  const context = {
    state: { file1, file2 },
    updateRevision: 0,
    app: { vault: { async cachedRead(file) {
      return file === file1 ? "正文" : "正文";
    } } },
  };

  assert.equal(await updateState.call(context), true);
  assert.equal(diffCalls, 1);
  assert.equal(context.comparisonError, null);
  assert.equal(context.file1Content, "正文");

  context.app.vault.cachedRead = async (file) =>
    file === file1 ? Array(maxComparisonLines + 1).fill("行").join("\n") : "短稿";
  assert.equal(await updateState.call(context), true);
  assert.match(context.comparisonError, new RegExp(`${maxComparisonLines.toLocaleString()} 行`));
  assert.equal(diffCalls, 1, "oversized line count must skip diff computation");

  context.app.vault.cachedRead = async (file) =>
    file === file1 ? "字".repeat(maxComparisonCharacters + 1) : "短稿";
  assert.equal(await updateState.call(context), true);
  assert.match(context.comparisonError, new RegExp(`${maxComparisonCharacters.toLocaleString()} 个字符`));
  assert.equal(diffCalls, 1, "oversized character count must skip diff computation");
});

test("bounds diff computation and renders a clear limit message", async () => {
  let receivedOptions;
  const updateState = createDifferencesUpdater((...args) => {
    receivedOptions = args[6];
    return undefined;
  });
  const file1 = { path: "one.md", name: "第一稿" };
  const file2 = { path: "two.md", name: "第二稿" };
  const context = {
    state: { file1, file2 },
    updateRevision: 0,
    app: { vault: { async cachedRead() { return "短稿"; } } },
  };

  assert.equal(await updateState.call(context), true);
  assert.deepEqual(receivedOptions, {
    maxEditLength: maxComparisonDiffEdits,
    timeout: comparisonDiffTimeoutMs,
  });
  assert.match(context.comparisonError, /差异规模超过安全计算上限/);

  const rendered = [];
  const renderBuild = new Function(`return function () { ${differencesBuildBody} }`)();
  renderBuild.call({
    comparisonError: context.comparisonError,
    contentEl: {
      empty() {},
      createDiv(options) { rendered.push(options); return {}; },
    },
  });
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].cls, "file-diff__error");
  assert.match(rendered[0].text, /可使用原生分屏继续阅读/);
});

test("ignores obsolete reads when a newer full-diff request finishes first", async () => {
  const pending = [];
  const updateState = createDifferencesUpdater();
  const oldFile1 = { path: "old-one.md", name: "旧稿一" };
  const oldFile2 = { path: "old-two.md", name: "旧稿二" };
  const newFile1 = { path: "new-one.md", name: "新稿一" };
  const newFile2 = { path: "new-two.md", name: "新稿二" };
  const context = {
    state: { file1: oldFile1, file2: oldFile2 },
    updateRevision: 0,
    comparisonError: "stale error",
    app: { vault: { cachedRead(file) {
      return new Promise((resolve) => pending.push({ file, resolve }));
    } } },
  };

  const oldRequest = updateState.call(context);
  await Promise.resolve();
  assert.equal(pending.length, 2);
  context.state = { file1: newFile1, file2: newFile2 };
  const newRequest = updateState.call(context);
  await Promise.resolve();
  assert.equal(pending.length, 4);
  pending[2].resolve("latest one");
  pending[3].resolve("latest two");
  assert.equal(await newRequest, true);
  assert.equal(context.file1Content, "latest one");
  assert.equal(context.file2Content, "latest two");
  assert.equal(context.comparisonError, null);
  pending[0].resolve("obsolete one");
  pending[1].resolve("obsolete two");
  assert.equal(await oldRequest, false);
  assert.equal(context.file1Content, "latest one");
  assert.equal(context.file2Content, "latest two");
});

test("renders distant full-diff hunks in order with a linear difference cursor", () => {
  const originalLines = Array.from({ length: 30 }, (_, index) => `line ${index}`);
  const changedLines = [...originalLines];
  changedLines[2] = "first changed";
  changedLines[12] = "second changed";
  changedLines[22] = "third changed";
  const parsed = diffRuntime.structuredPatch(
    "one.md", "two.md", originalLines.join("\n"), changedLines.join("\n"),
  );
  const differences = diffRuntime.FileDifferences.fromParsedDiff(parsed).differences;
  const seen = [];
  const container = {
    children: [],
    createDiv(options) { this.children.push(options); return {}; },
  };
  const buildLines = new Function(
    "preventEmptyString",
    `return function (container) { ${differencesBuildLinesBody} }`,
  )((line) => line == null || line.length === 0 ? " " : line);
  buildLines.call({
    file1Lines: originalLines,
    file2Lines: changedLines,
    fileDifferences: { differences },
    buildDifferenceVisualizer(_container, difference) {
      seen.push([difference.file1Start, difference.file2Start]);
    },
  }, container);

  assert.deepEqual(seen, [[2, 2], [12, 12], [22, 22]]);
  assert.equal(container.children.filter((child) => child.cls === "difference").length, 3);
  assert.equal(container.children.length, originalLines.length);
});

test("opens the selected Markdown note in the requested native split direction", async () => {
  for (const [direction, label] of [["vertical", "左右"], ["horizontal", "上下"]]) {
    splitComparisonMap.clear();
    splitNotices.length = 0;
    const calls = [];
    const sourceLeaf = { id: "source" };
    const targetFile = { path: "target.md", name: "当前稿" };
    const compareFile = { path: "compare.md", name: "对照稿" };
    const markdownLeaves = [];
    const leaf = {
      view: null,
      async openFile(file, state) {
        calls.push(["open-file", file, state]);
        this.view = new SplitMarkdownViewStub();
        this.view.file = file;
        markdownLeaves.push(this);
      },
      detach() { calls.push(["detach"]); },
    };
    const workspace = {
      getLeavesOfType(type) {
        calls.push(["get-existing", type]);
        return type === "markdown" ? markdownLeaves : [];
      },
      createLeafBySplit(source, requestedDirection) {
        calls.push(["split", source, requestedDirection]);
        return leaf;
      },
      revealLeaf(revealed) { calls.push(["reveal", revealed]); },
    };

    const opened = await openSplitComparison(
      { app: { workspace } }, targetFile, compareFile, sourceLeaf, direction,
    );

    assert.equal(opened, true);
    assert.deepEqual(calls[0], ["get-existing", "bigao-panel-view"]);
    assert.ok(calls.some((call) => call[0] === "split" && call[1] === sourceLeaf && call[2] === direction));
    assert.ok(calls.some((call) => call[0] === "open-file" && call[1] === compareFile && call[2].active === true));
    assert.ok(calls.some((call) => call[0] === "reveal" && call[1] === leaf));
    assert.ok(leaf.view instanceof SplitMarkdownViewStub);
    assert.equal(splitComparisonMap.get(leaf).sourcePath, targetFile.path);
    assert.ok(splitInlineCalls.some(([kind]) => kind === "refresh"));
    assert.match(splitNotices[0], new RegExp(label + "分屏"));
  }
});

test("preserves existing panes if the native comparison note fails to open", async () => {
  splitComparisonMap.clear();
  splitNotices.length = 0;
  let detached = false;
  let previousDetached = false;
  const previousLeaf = { detach() { previousDetached = true; } };
  const leaf = {
    async openFile() { throw new Error("test failure"); },
    detach() { detached = true; },
  };
  const opened = await openSplitComparison(
    {
      app: {
        workspace: {
          getLeavesOfType(type) { return type === "bigao-panel-view" ? [previousLeaf] : []; },
          createLeafBySplit() { return leaf; },
        },
      },
    },
    { path: "target.md" }, { path: "compare.md", name: "对照稿" }, { id: "source" }, "vertical",
  );
  assert.equal(opened, false);
  assert.equal(detached, true);
  assert.equal(previousDetached, false);
  assert.match(splitNotices[0], /打开分屏对照失败/);
});

test("does not report success or keep an empty pane when openFile resolves without loading the note", async () => {
  splitComparisonMap.clear();
  splitNotices.length = 0;
  let detached = false;
  const leaf = {
    view: null,
    async openFile() {},
    detach() { detached = true; },
  };
  const opened = await openSplitComparison(
    {
      app: {
        workspace: {
          getLeavesOfType(type) { return type === "bigao-panel-view" ? [] : []; },
          createLeafBySplit() { return leaf; },
        },
      },
    },
    { path: "target.md" }, { path: "compare.md", name: "对照稿" }, { id: "source" }, "vertical",
  );
  assert.equal(opened, false);
  assert.equal(detached, true, "the empty split must be removed");
  assert.equal(splitComparisonMap.size, 0, "an unopened note must not be tracked as a comparison");
  assert.match(splitNotices[0], /没有载入分屏窗格/);
});

test("keeps the existing comparison when a reused pane cannot load the replacement note", async () => {
  splitComparisonMap.clear();
  splitNotices.length = 0;
  const sourceLeaf = { id: "source", view: Object.assign(new SplitMarkdownViewStub(), { file: { path: "target.md" } }) };
  const previousFile = { path: "previous.md", name: "旧对照稿" };
  const leaf = {
    view: Object.assign(new SplitMarkdownViewStub(), { file: previousFile }),
    async openFile() {},
    detach() { assert.fail("a failed replacement must not close the existing comparison pane"); },
  };
  const comparison = {
    sourceLeaf,
    sourcePath: "target.md",
    comparePath: previousFile.path,
    direction: "vertical",
  };
  splitComparisonMap.set(leaf, comparison);
  const opened = await openSplitComparison(
    {
      app: {
        workspace: {
          getLeavesOfType(type) { return type === "markdown" ? [sourceLeaf, leaf] : []; },
          createLeafBySplit() { assert.fail("an existing comparison pane must be reused"); },
          revealLeaf() { assert.fail("a failed replacement must not be revealed as success"); },
        },
      },
    },
    { path: "target.md" }, { path: "replacement.md", name: "新对照稿" }, sourceLeaf, "vertical",
  );
  assert.equal(opened, false);
  assert.equal(splitComparisonMap.get(leaf), comparison);
  assert.equal(comparison.comparePath, previousFile.path);
  assert.equal(leaf.view.file, previousFile);
  assert.match(splitNotices[0], /打开分屏对照失败/);
});

test("replaces legacy comparison panels only after the native note opens", async () => {
  splitComparisonMap.clear();
  splitNotices.length = 0;
  const calls = [];
  const previousLeaf = { detach() { calls.push("detach-old"); } };
  const sourceLeaf = { id: "source" };
  const leaf = {
    view: null,
    async openFile(file, state) {
      calls.push(["open-file", file, state]);
      this.view = new SplitMarkdownViewStub();
      this.view.file = file;
    },
    detach() { calls.push("detach-new"); },
  };
  const opened = await openSplitComparison(
    {
      app: {
        workspace: {
          getLeavesOfType(type) { return type === "bigao-panel-view" ? [previousLeaf] : []; },
          createLeafBySplit() { calls.push("create-split"); return leaf; },
          revealLeaf() { calls.push("reveal"); },
        },
      },
    },
    { path: "target.md" },
    { path: "compare.md", name: "对照稿" },
    sourceLeaf,
    "vertical",
  );

  assert.equal(opened, true);
  assert.equal(calls[0], "create-split");
  assert.deepEqual(calls[1], ["open-file", { path: "compare.md", name: "对照稿" }, { active: true }]);
  assert.equal(calls[2], "reveal");
  assert.equal(calls[3], "detach-old");
});

test("reuses the native comparison pane for the same source and direction", async () => {
  splitComparisonMap.clear();
  splitNotices.length = 0;
  const sourceFile = { path: "source.md" };
  const sourceLeaf = {
    id: "source",
    view: Object.assign(new SplitMarkdownViewStub(), { file: sourceFile }),
  };
  const firstFile = { path: "first.md", name: "第一稿" };
  const secondFile = { path: "second.md", name: "第二稿" };
  const markdownLeaves = [];
  let splitCount = 0;
  const openFiles = [];
  const leaf = {
    view: null,
    async openFile(file) {
      openFiles.push(file);
      this.view = new SplitMarkdownViewStub();
      this.view.file = file;
      if (!markdownLeaves.includes(this)) markdownLeaves.push(this);
    },
    detach() {},
  };
  const workspace = {
    getLeavesOfType(type) { return type === "markdown" ? markdownLeaves : []; },
    createLeafBySplit() { splitCount += 1; return leaf; },
    revealLeaf() {},
  };

  assert.equal(await openSplitComparison({ app: { workspace } }, sourceFile, firstFile, sourceLeaf, "vertical"), true);
  assert.equal(await openSplitComparison({ app: { workspace } }, sourceFile, secondFile, sourceLeaf, "vertical"), true);
  assert.equal(splitCount, 1);
  assert.deepEqual(openFiles, [firstFile, secondFile]);
  assert.equal(splitComparisonMap.get(leaf).comparePath, secondFile.path);
});

test("does not take over a comparison pane the user has repurposed", async () => {
  splitComparisonMap.clear();
  splitNotices.length = 0;
  const sourceLeaf = { id: "source" };
  const firstFile = { path: "first.md", name: "第一稿" };
  const nextFile = { path: "next.md", name: "下一稿" };
  const markdownLeaves = [];
  const createdLeaves = [];
  const workspace = {
    getLeavesOfType(type) { return type === "markdown" ? markdownLeaves : []; },
    createLeafBySplit() {
      const leaf = {
        view: null,
        async openFile(file) {
          this.view = new SplitMarkdownViewStub();
          this.view.file = file;
          markdownLeaves.push(this);
        },
        detach() {},
      };
      createdLeaves.push(leaf);
      return leaf;
    },
    revealLeaf() {},
  };

  await openSplitComparison({ app: { workspace } }, {}, firstFile, sourceLeaf, "vertical");
  createdLeaves[0].view.file = { path: "user-selected.md" };
  await openSplitComparison({ app: { workspace } }, {}, nextFile, sourceLeaf, "vertical");

  assert.equal(createdLeaves.length, 2);
  assert.equal(createdLeaves[0].view.file.path, "user-selected.md");
  assert.equal(createdLeaves[1].view.file, nextFile);
});

test("close only detaches a tracked pane while it still shows its comparison note", () => {
  splitComparisonMap.clear();
  const compareFile = { path: "compare.md" };
  let detached = 0;
  const leaf = {
    view: Object.assign(new SplitMarkdownViewStub(), { file: compareFile }),
    detach() { detached += 1; },
  };
  const repurposedLeaf = {
    view: Object.assign(new SplitMarkdownViewStub(), { file: { path: "another.md" } }),
    detach() { assert.fail("a pane repurposed by the user must remain open"); },
  };
  splitComparisonMap.set(leaf, { comparePath: compareFile.path, direction: "vertical", sourceLeaf: {} });
  splitComparisonMap.set(repurposedLeaf, { comparePath: compareFile.path, direction: "vertical", sourceLeaf: {} });
  const detachedTypes = [];
  const legacyPanelLeaf = {
    detach() { assert.fail("closing a native split must preserve legacy comparison views"); },
  };

  const closedCount = closeSplitComparison({
    workspace: {
      getLeavesOfType(type) {
        if (type === "markdown") return [leaf, repurposedLeaf];
        if (type === "bigao-panel-view") return [legacyPanelLeaf];
        return [];
      },
      detachLeavesOfType(type) { detachedTypes.push(type); },
    },
  });

  assert.equal(closedCount, 1);
  assert.equal(detached, 1);
  assert.ok(splitInlineCalls.some(([kind, _source, compare]) => kind === "clear" && compare === leaf));
  assert.equal(splitComparisonMap.size, 0);
  assert.deepEqual(detachedTypes, [], "closing a native split must not detach the legacy view type");
});

test("captures the source editor and file before the compare-file picker resolves", async () => {
  splitNotices.length = 0;
  const sourceLeaf = { id: "source" };
  const targetFile = { path: "target.md" };
  const compareFile = { path: "compare.md" };
  const sourceView = { file: targetFile, leaf: sourceLeaf };
  const workspace = { activeFile: targetFile, getActiveFile() { return this.activeFile; } };
  const plugin = { app: { workspace } };
  let received;
  const run = new Function(
    "MarkdownView",
    "Notice",
    "_bigaoPickCompareFile",
    "_bigaoOpenSplitComparison",
    "console",
    `return async function (plugin, direction, sourceView) { ${startSplitComparisonBody} }`,
  )(
    class MarkdownViewStub {},
    TestNotice,
    async (_plugin, file) => {
      assert.equal(file, targetFile);
      workspace.activeFile = compareFile;
      return compareFile;
    },
    async (...args) => { received = args; return true; },
    { error() {} },
  );

  assert.equal(await run(plugin, "horizontal", sourceView), true);
  assert.deepEqual(received, [plugin, targetFile, compareFile, sourceLeaf, "horizontal"]);
});

test("aligns a modified line with its closest counterpart after an inserted line", () => {
  const differences = panelEngine.compute(
    "A\nchapter blue\nZ",
    "A\ninserted\nchapter red\nZ",
  );
  assert.deepEqual(differences, [
    { a: 1, b: 2, ranges: [{ from: 8, to: 12 }], whole: false, removed: true },
    { a: 2, b: -1, ranges: [], removedLines: 1 },
  ]);
});

test("highlights the changed word when line positions are otherwise stable", () => {
  const differences = panelEngine.compute("chapter blue", "chapter red");
  assert.deepEqual(differences, [
    { a: 0, b: 0, ranges: [{ from: 8, to: 12 }], whole: false, removed: true },
  ]);
});

test("normalizes CRLF lines before calculating word offsets", () => {
  const differences = panelEngine.compute(
    "A\r\nchapter blue\r\nZ\r\n",
    "A\r\nchapter red\r\nZ\r\n",
  );
  assert.deepEqual(differences, [
    { a: 1, b: 1, ranges: [{ from: 8, to: 12 }], whole: false, removed: true },
  ]);
});

test("leaves identical notes without differences", () => {
  assert.deepEqual(panelEngine.compute("A\nB\nC", "A\nB\nC"), []);
});

test("highlights a line that exists only in the current note", () => {
  assert.deepEqual(panelEngine.compute("A\nnew line\nZ", "A\nZ"), [
    { a: 1, b: -1, ranges: [{ from: 0, to: 8 }], whole: true, removed: false },
  ]);
});

test("treats an empty comparison note as all-new content", () => {
  const differences = panelEngine.compute("first line", "");
  assert.deepEqual(differences, [
    { a: 0, b: -1, ranges: [{ from: 0, to: 10 }], whole: true, removed: false },
  ]);
});

test("marks comparison-only lines at the nearest current line", () => {
  const differences = panelEngine.compute("A\nC", "A\nB\nC");
  assert.deepEqual(differences, [
    { a: 1, b: -1, ranges: [], removedLines: 1 },
  ]);
});

test("renders a quiet removal marker in place of invisible deleted text", () => {
  const differences = panelEngine.compute("A\nC", "A\nB\nC");
  const container = fakeElement();
  const body = renderFull(container, ["A", "C"], differences);
  const row = body.children[1];
  const marker = row.children[1].children.find((child) => child.classes.has("bigao-panel__removed"));

  assert.equal(marker?.textContent, "− 对照稿多 1 行");
  assert.ok(row.classes.has("bigao-panel__row--diff"));
  assert.ok(row.classes.has("bigao-panel__row--removed"));
});

test("uses the selected diff palette throughout the side panel", () => {
  const additionRule = styles.match(/\.bigao-panel__add\s*\{([^}]*)\}/s)?.[1] || "";
  const rowRule = styles.match(/\.bigao-panel__row--diff\s*\{([^}]*)\}/s)?.[1] || "";
  const removedRowRule = styles.match(/\.bigao-panel__row--removed\s*\{([^}]*)\}/s)?.[1] || "";
  const removalRule = styles.match(/\.bigao-panel__removed\s*\{([^}]*)\}/s)?.[1] || "";

  assert.match(additionRule, /var\(--bigao-add-bg\)/);
  assert.match(additionRule, /var\(--bigao-add-fg\)/);
  assert.match(rowRule, /var\(--bigao-add-bg\)/);
  assert.match(removedRowRule, /var\(--bigao-del-bg\)/);
  assert.match(removalRule, /var\(--bigao-del-bg\)/);
  assert.equal((styles.match(/\{/g) || []).length, (styles.match(/\}/g) || []).length);
});

test("falls back to whole-line highlighting when the document-wide word-diff budget is spent", () => {
  const oldLine = Array.from({ length: 150 }, () => "old").join(" ");
  const newLine = Array.from({ length: 150 }, () => "new").join(" ");
  const differences = panelEngine.compute(
    Array.from({ length: 50 }, () => newLine).join("\n"),
    Array.from({ length: 50 }, () => oldLine).join("\n"),
  );

  assert.equal(differences.length, 50);
  assert.deepEqual(differences.at(-1).ranges, [{ from: 0, to: newLine.length }]);
});

test("bounds fuzzy matching work for large changed line blocks", () => {
  let tokenizerCalls = 0;
  const boundedEngine = createPanelEngine({
    tokenize(value) {
      tokenizerCalls += 1;
      return value.split(/(\s+)/);
    },
  });
  const current = Array.from({ length: 257 }, (_, index) => `target ${index}`).join("\n");
  const comparison = Array.from({ length: 256 }, (_, index) => `source ${index}`).join("\n");
  const differences = boundedEngine.compute(current, comparison);

  assert.equal(differences.length, 257);
  assert.equal(differences.at(-1).whole, true);
  assert.ok(tokenizerCalls < 2000, `Expected bounded tokenization, got ${tokenizerCalls} calls`);
});
