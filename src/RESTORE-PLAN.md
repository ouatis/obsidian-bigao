# Reconstructing the local source

The initial source baseline came from `friebetill/obsidian-file-diff` tag
`1.1.2`, commit `d566ded402f72e1508f33b640d6f96d7c32c9a00`. It has since been
adapted with explicit Obsidian `App` dependencies and a tested TypeScript port
of the local panel-diff algorithm. It is still not a complete source
representation of the installed local plugin.

The installed plugin is locally customized (`manifest.json` version `1.2.2`).
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

Remaining source-parity work includes a direct comparison of all locally
customized commands, settings and diff rendering against the installed bundle,
followed by Obsidian reload/error/visual verification before any install step.

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
