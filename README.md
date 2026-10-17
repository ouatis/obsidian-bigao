# 比稿 · Collate

在 Obsidian 原生左右或上下分屏中对照两篇 Markdown 笔记，并在两篇原文内高亮差异。

这是由 ouatis 维护的早期实验版本，基于 Till Friebe 的 [obsidian-file-diff](https://github.com/friebetill/obsidian-file-diff) 修改。目前用于保存已验证的本地安装版本及恢复中的源码，尚未提交 Obsidian 社区插件列表。

## 当前功能

- 使用 Obsidian 原生左右、上下分屏，保留正常笔记编辑体验。
- 两篇原文中按词标记各自独有的内容，支持中文分词。
- 差异底色、底线和段落边标不改写笔记正文；相同内容不着色。
- 优先读取已打开笔记的编辑缓冲区，编辑后短暂防抖刷新差异。
- 对照稿选择器支持按名称或路径搜索，可随时取消。
- 保留全文差异视图、对比并合并及同步冲突查找入口。

分屏两侧目前使用相同的差异词配色，表示“这一侧独有的内容”，不代表统一的新增或删除方向。

## 手动安装当前快照

1. 在自己的 Obsidian 库中创建 `.obsidian/plugins/bigao/` 文件夹。
2. 将本仓库根目录的以下四个文件复制到该文件夹：
   - `manifest.json`
   - `main.js`
   - `styles.css`
   - `inline-diff-runtime-v9.js`
3. 重新加载 Obsidian，在第三方插件设置中启用「比稿 · Collate」。
4. 打开一篇原稿，在命令面板运行「比稿：开启左右分屏对照」或「比稿：开启上下分屏对照」，再选择另一篇稿件。

运行「比稿：关闭分屏对照」会关闭插件创建且仍显示原对照稿的窗格；已被改作他用的窗格会保留。合并操作会修改笔记，请在确认前检查差异并保留备份。

目前只在 Windows 桌面版 Obsidian 中完成实际验证；移动端兼容性尚未验证。编辑器内高亮需要笔记处于编辑模式，不保证阅读模式显示同样效果。

## 开发与验证

使用 Node.js 22.6 或更新版本：

```sh
npm ci
npm run verify
```

验证包括当前安装包检查、TypeScript 类型检查、逻辑回归、隔离构建及替身环境中的运行测试。真实 Obsidian 分屏、重载和界面检查仍需单独进行。

**根目录 `main.js` 是当前使用的冻结安装包。** `src/` 已通过本轮核心行为对照与 Windows Obsidian 1.14.4 的独立测试库验证，但不代表所有环境和边界情况都已覆盖。`npm run build` 只生成 `dist/` 验证产物，不会覆盖安装包。

## 构建源码候选安装包

```sh
npm run package:candidate
```

完整候选包生成到 `dist/candidate/`，包含 `main.js`、`manifest.json`、`styles.css` 和文件校验记录 `build-info.json`。源码版已经把行内高亮模块打包进 `main.js`，因此安装到独立测试库时只需前三个文件，不再需要旧安装包的单独运行文件。此命令不会安装或覆盖现用插件。

如需重复真实桌面检查，先构建候选包，再在 Windows PowerShell 中提供本机的 Obsidian 路径：

```powershell
$env:BIGAO_OBSIDIAN_EXE = 'C:\path\to\Obsidian.exe'
$env:BIGAO_OBSIDIAN_ASAR = Join-Path $env:APPDATA 'obsidian\obsidian-1.14.4.asar'
npm run test:obsidian
```

请按实际安装版本调整 `.asar` 文件名。脚本仅在临时目录中创建独立资料目录、两个人工测试库和插件副本，结束时关闭测试进程；不读写真实笔记库。原安装包与源码候选包分别验证分屏、双侧高亮、编辑刷新、插件重载、全文差异及取消合并警告；本地报告与截图保存在忽略提交的 `dist/` 中，临时测试库保留供排查。

## 已知限制

- 分屏行内高亮的计算上限为每篇 4,000 行；超过上限时可能没有高亮，不应据此判断两篇没有差异。
- 大幅改写、段落移动或长段落的对齐效果仍可能不理想。
- 高亮以只读编辑器覆盖层绘制，某些主题或复杂 Markdown 排版仍需进一步核验。
- 工作区完全重载后的对照关系恢复尚未保证；需要时重新运行开启分屏命令。

本仓库只跟踪明确列出的插件文件、源码及测试；不收录笔记正文、个人设置、调试截图、旧运行文件或依赖目录。

## 来源与许可

原插件：[Till Friebe / obsidian-file-diff](https://github.com/friebetill/obsidian-file-diff)，MIT License。恢复源码所用基线为 `1.1.2`，提交 `d566ded402f72e1508f33b640d6f96d7c32c9a00`；原作者版权及许可文本保留在 [LICENSE](LICENSE)。

本地维护背景及一致性核对状态见 [README.local.md](README.local.md) 和 [src/RESTORE-PLAN.md](src/RESTORE-PLAN.md)。
