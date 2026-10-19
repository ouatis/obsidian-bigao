# 比稿 · Collate 本地维护约定

## 当前状态

- 本目录对应 JARDIN vault 中已安装的 `bigao` 插件；manifest 版本为 `0.1.0`（2026-10-19 从继承的 `1.2.2` 重置，本插件自此按自己的版本线走）。
- 根目录 `main.js` 仍是冻结的当前安装版。`src/` 以原插件 1.1.2 为基线恢复，已通过本轮核心行为对照及 Obsidian 1.14.4 独立测试库验证；详见 `src/RESTORE-PLAN.md`。这不是全部环境与边界场景等价的承诺。
- `npm run build` 只生成 `dist/main.js` 等验证产物；`npm run package:candidate` 生成完整的 `dist/candidate/` 源码候选安装包。当前没有自动安装步骤，不得未经验证和明确安装请求覆盖根目录安装版。

## 验证

```text
npm run verify
```

完整链路包括：已安装 bundle 语法和回归、严格 TypeScript 检查、源码纯逻辑测试、隔离构建、源码 bundle 冒烟、同输入的安装版/源码行为对照与可重复构建检查。它不安装构建产物，也不能替代 Obsidian 内的 reload、错误检查和界面核验。`npm run test:obsidian` 使用独立临时资料目录和人工稿件验证两套安装包；须提供 `BIGAO_OBSIDIAN_EXE`、`BIGAO_OBSIDIAN_ASAR`，不能改成复用用户的真实配置目录。

## 结构

- `src/main.ts`：注册插件视图和稳定命令 ID。
- `src/components/bigao_panel_view.ts`：面板生命周期、渲染调度和光标跟随。
- `src/components/bigao_panel_commands.ts`：左右/上下原生分屏工作流。
- `src/components/inline_diff.ts`、`src/data/inline_decoration_ranges.ts`：原生分屏两侧的差异范围计算、只读高亮覆盖层与清理。
- `src/components/bigao_compare_file_modal.ts`：对照稿选择器。
- `src/components/bigao_panel_render.ts`：全文差异 DOM 渲染和行定位。
- `src/data/panel_differences.ts`、`src/utils/word_diff.ts`：有界差异算法与中英文分词。
- `panel-render-limit.test.mjs`：当前安装 bundle 回归；`source-bundle.test.mjs`：隔离源码 bundle 冒烟。
- `source-parity.test.mjs`：同输入行为与重复构建核对；`scripts/obsidian-smoke.mjs`：独立桌面运行验证；`scripts/package-candidate.mjs`：仅向 `dist/candidate/` 打包，不安装。

## 必须保留的本地行为

- 中文界面、差异配色和中文分词选项。
- 所有稿件选择器只列出 Markdown 笔记，并按路径排除当前稿。
- 普通对比与分屏对照共用可取消的稿件选择器：名称/路径检索、显示目录、最多展示 60 项；取消必须以 `null` 结束等待。
- 保留左右与上下原生分屏入口：原稿窗格不动，所选对照稿直接作为普通 Markdown 笔记打开在新窗格；未保存的原稿缓冲区继续留在原窗格。
- 同一原稿、同一分屏方向再次选择对照稿时复用已有窗格。关闭命令只关闭插件创建且仍显示原对照稿的窗格；用户已改作他用的窗格和兼容旧版面板保留。追踪信息在插件热重载期间保留，避免原生 Markdown 对照窗格变成无法由插件关闭的孤儿窗格。
- 普通全文差异与合并命令继续使用差异视图；旧工作区中已保存的 `bigao-panel-view` 仍注册以兼容恢复，不再作为新分屏对照的目标视图。
- 普通全文差异与分屏对照都优先读取已打开编辑器里的未保存文本；全文差异对编辑变化做防抖刷新，关闭视图时清除计时器。
- 普通全文差异每篇最多 4,000 行、1,000,000 字符；差异计算限制为 2,000 次编辑或 500 毫秒，超限须显示可读提示，不得误报“无差异”或触发删除确认。
- 两篇笔记并行读取；更新修订号阻止旧读取/旧计算覆盖新稿，视图关闭时使未完成工作失效。差异渲染按排序结果线性前进，不在每一行重复扫描全部差异。
- 对比规模上限、资源有界的差异算法，以及失败时保留已有对照视图。
- 合并操作始终通过显式传入的 Obsidian `App` 修改 vault；确认类操作继续保留风险提示。
- 已发布/已配置的命令 ID 保持稳定：`bigao-panel-on`、`bigao-panel-on-horizontal`、`bigao-panel-off`、`bigao-compare`、`bigao-compare-and-merge`、`bigao-find-sync-conflicts`。工作区视图 ID 同样是持久化标识，必须与安装版一致：`bigao-differences-view`、`bigao-panel-view`。
- 渲染调度必须使用递增版本号：更换稿件、排入新渲染、清空对照或关闭视图后，未完成的旧读取不得再写入 DOM 或显示过期错误。
- 分屏行内差异不得改写笔记或 CodeMirror 文档内容。此前将另一份打包的 CodeMirror decorations 注册到 Obsidian 编辑器时，运行时报告加载了不同版本的 `@codemirror/state`；当前以只读 DOM 覆盖层按可见文本坐标绘制差异，不能重新引入独立打包的 CodeMirror 扩展。若将来能从 Obsidian 同一运行时取得兼容的扩展模块，须先用真实分屏验证，再考虑替换覆盖层。
- 对照窗格只有在 `openFile()` 后确实加载了目标 Markdown 文件时才算成功；若 API 静默失败或仍是空白视图，必须关闭新建空窗格、保留旧面板，并显示失败提示，不得登记追踪或提示成功。
- 旧版不兼容 CodeMirror 扩展的失败注册可能留下工作区残留，插件热重载无法清除。若连普通新 Markdown 窗格都打不开，先排查编辑器扩展；确认缓冲区已保存后重载工作区，不要继续往分屏流程叠加补丁。当前覆盖层底色位于正文和选择层下方，不能遮淡文字。

优先在 `src/` 修改并补测试。若为了热修复修改根 `main.js`，必须同步移植到 `src/` 并补齐两套 bundle 的回归。监听器和计时器必须在视图关闭或插件卸载时清理。不要在无用户请求时发布、推送或覆盖安装版。
