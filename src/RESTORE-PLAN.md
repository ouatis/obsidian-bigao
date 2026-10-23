# Reconstructing the local source

The initial source baseline came from `friebetill/obsidian-file-diff` tag
`1.1.2`, commit `d566ded402f72e1508f33b640d6f96d7c32c9a00`. It has since been
adapted with explicit Obsidian `App` dependencies and a tested TypeScript port
of the local panel-diff algorithm. The original customized TypeScript project
was not found. The reconstructed source has now passed the core behavioral
comparison and isolated desktop checks described below; equivalence in every
platform, theme and edge case is not claimed.

The installed plugin is locally customized (`manifest.json` version `0.1.0`;
the `1.2.2` it inherited from upstream file-diff was reset on 2026-10-19).
Keep the current root `main.js` intact until these sources are reconciled with
the local bundle and the full verification pipeline can build and test the
result. Preserve the Chinese comparison UI, tokenization and palette settings,
bounded panel and full-diff engines, native Markdown split comparison entry
points, live panel editor-buffer reads, and cursor-follow behavior.

`npm run verify` checks the installed bundle separately from the recovered
TypeScript source, then builds the latter to `dist/main.js` and runs a mocked
Obsidian bundle smoke test. The build is deliberately isolated: it does not
replace the installed root `main.js`. Passing the mocked smoke test does not
prove complete feature or visual parity with the installed bundle.

Core commands, settings and diff rendering have been compared against the
installed bundle and exercised in independent Obsidian vaults. Installation
over the real working plugin remains a separate, explicit step.

Recent parity checks now preserve the installed workspace view IDs
(`bigao-differences-view`, `bigao-panel-view`) and route both comparison flows
through one cancel-safe picker for other Markdown files. Regression tests cover
the view registration, unload cleanup, attachment exclusion, picker cancel/path/
limit behavior, native Markdown split opening, full-diff resource limits and
stale async reads, and stale panel renders in both the installed bundle and
recovered source build. Both full-diff and split comparison now prefer unsaved
text from open Markdown editors; full-diff refreshes on relevant editor changes
with a short debounce, and its regression is covered in the source bundle.
Native split tracking now lives on the app window so a plugin hot reload does
not orphan the ordinary Markdown leaf; closing a native split no longer
detaches any legacy `bigao-panel-view` leaf.

Native splits render word-level differences in both Markdown editors using a
read-only overlay positioned from visible editor text ranges; subtle edge
markers indicate removed or replaced lines. The overlay reads unsaved buffers,
debounces refreshes, and never writes into note or CodeMirror contents. The
earlier separately bundled CodeMirror-extension approach triggered the
multiple-`@codemirror/state` runtime error and must not be reintroduced unless a
same-runtime module path is proven. The installed bundle keeps its existing
local implementation; `dist/inline-diff-runtime-v9.js` is a separate companion
runtime required beside the installed `main.js`. Split opening is considered
successful only after the requested file is confirmed in a Markdown view;
otherwise the new empty pane is removed and any existing comparison remains.
Source tests cover safe range mapping and companion lifecycle.

Do not publish or overwrite the installed bundle from the upstream source
alone.

## Verification recorded on 2026-10-17

`source-parity.test.mjs` runs both implementations against the same inputs:

- 109 fixed and seeded cases, with Chinese segmentation enabled and disabled:
  tokenization, word spans, per-line positions and split-diff ranges.
- Full-diff line mapping and rendered text/span structure, including CRLF,
  whitespace, repeated lines, accents, emoji, insertions and deletions.
- All six command IDs/names, both persistent view IDs, all five palettes,
  invalid-setting fallback, all eight merge actions and sync-conflict matching.
- Two identical production builds, matching `dist/main.js`, without bundled
  `@codemirror/*` inputs or changes to the installed baseline.

A clean temporary copy containing only the 49 Git-eligible project files was
also tested with a fresh `npm ci --offline --ignore-scripts`. All 66 automated
tests, strict type checks and production build passed without reusing the
working directory's `node_modules`; the resulting main bundle matches the
candidate byte for byte.

`scripts/obsidian-smoke.mjs` separately loads the frozen baseline and complete
source candidate in synthetic vaults under a temporary user-data directory.
Both passed real picker selection, left/right and top/bottom split geometry,
bilateral word highlights, live edits, restoration and plugin reload in
Windows Obsidian 1.14.4. Full-diff text, three hunks and five word spans match;
cancelling the merge warning neither accepts risk nor opens a merge view.
The harness checks invalid editor extensions and captured window errors,
confirms fixture texts and installed runtime hashes are unchanged, and closes
only its own isolated browser. Reports and visually checked fixture screenshots
stay in ignored `dist/`; temporary synthetic vaults remain for diagnosis.

`npm run package:candidate` creates `dist/candidate/` with `main.js`,
`manifest.json`, `styles.css` and SHA-256 file records. Unlike the frozen
baseline, this source candidate bundles its inline runtime and needs no
sidecar. No build, package or test command installs over the working plugin.

## 打包架构差异（2026-10-22 核实）

**字节不同 ≠ 代码不同。先看本节再决定是否重打包。**

核实方式：`npm run verify` 全链（66 项，含 `source-parity.test.mjs` 8 项）通过；
另以 esbuild 从 `src/` 按不同选项重建并与根 `main.js` 逐字节比对；再按两种产物
各自真实的加载方式分别装载两个 bundle 并执行 `onload()` 实测运行行为。

### 两个产物不是同一次构建的输出

- 根 `main.js`：76,949 B，未压缩，第 1 行是 esbuild 的 `THIS IS A GENERATED/BUNDLED FILE` banner。
- `npm run build` 生成的 `dist/main.js`：42,456 B，`minify: true`，31 行。
- 从 `src/` 以「不压缩、不加 banner」重建：84,024 B，**仍不等于** 76,949 B。

体积差不是压缩造成的，而是下面这处架构差异造成的。

### 真正差异：行内差异模块的挂载方式

- **安装版**把 `inline-diff-runtime-v9.js` 作为**外置 sidecar**。运行时由
  `_bigaoLoadInlineDiffRuntime(plugin)` 通过
  `require(adapter.getFullPath(manifestDir + "/inline-diff-runtime-v9.js"))` 动态加载；
  失败时 `console.error("比稿：行内差异模块加载失败", error)` 并把
  `BigaoInlineDiffRuntime` 置回 `null`。
- **`src/` 构建版**把同一个 helper **内联**进 bundle，不产生也不依赖 sidecar。
- 字符串证据：安装版含 `无法确定比稿插件目录` 与 `inline-diff-runtime-v9.js`，
  这两个字符串在 `src/` 构建版中不存在；`src/` 构建版含 `domAtPos`、
  `ResizeObserver`、`cancelInlineDiffRefresh`，这三者在安装版中不存在。
- `inline-diff-runtime-v9.js` 的根目录版与 `dist/inline-diff-runtime-v9.js`
  **SHA-256 完全一致**（同为 16,463 B，`9B52316A…27921B`）——即两边跑的是同一份 helper 代码，
  只是打包位置不同。

### 方向判断：同一次落盘，不存在谁旧谁新

- `main.js` 与 40 个已跟踪文件 mtime 同为 `2026-10-17 17:13:15`（其中 `src/` 下 27 个，
  另有 `manifest.json`、`styles.css`、`inline-diff-runtime-v9.js` 及构建/测试脚本等 13 个）。
- HEAD 提交 `d8b15b2` 时间为 `2026-10-17 17:15:54`，**晚于**所有文件 mtime。
- git 工作区干净，`main.js` 与 HEAD 逐字节相同（`git diff HEAD -- main.js` 为空）。
- 因此「src 改完之后又重新打过包」这一读法不成立：两者是同一次写盘的产物，`main.js`
  早于提交 2 分 39 秒，因为它与 `src/` 一起写完才提交。

### 两个方向的误判后果

- 若误以为「字节不同就是代码不同」而重新打包覆盖根 `main.js`：会把 sidecar 架构
  换成内联架构，插件目录里多出一个不再被需要的 `inline-diff-runtime-v9.js`，
  而该文件不会被任何清理逻辑删除。
- 若把 `src/` 当作旧版回退到安装版布局：会丢掉内联改造，重新引入 sidecar 依赖。

### sidecar 缺失是软降级，不是硬依赖

实测两种加载方式，`onload()` 后：

- sidecar 存在：注册 6 个命令、2 个视图，行内差异可用。
- sidecar 缺失：**同样注册 6 个命令、2 个视图**，只多一行
  `比稿：行内差异模块加载失败` 错误日志，插件其余功能照常工作。

命令 ID 与视图 ID 在两种产物中完全一致：`bigao-panel-on`、
`bigao-panel-on-horizontal`、`bigao-panel-off`、`bigao-compare`、
`bigao-compare-and-merge`、`bigao-find-sync-conflicts`；
`bigao-differences-view`、`bigao-panel-view`。

### verify 的边界

`source-parity.test.mjs` 的 8 项测的是**行为等价**，不测字节：分词、词跨度、
逐行位置、分屏差异范围、命令与视图 ID、五套配色与非法设置回退、八个合并动作、
同步冲突匹配，以及可重复构建。它**不会**告诉你两个 bundle 是否同一产物——
上文的字节差异在 parity 全绿的情况下依然存在。

行为等价的边界仍以本文档前述内容为准：移动端、任意主题、复杂渲染 Markdown 未验证。

Mobile, arbitrary themes and complex rendered Markdown remain unverified.
Destructive merge/delete UI checks must always use disposable notes only.
