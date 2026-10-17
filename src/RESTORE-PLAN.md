# Reconstructing the local source

The initial source baseline came from `friebetill/obsidian-file-diff` tag
`1.1.2`, commit `d566ded402f72e1508f33b640d6f96d7c32c9a00`. It has since been
adapted with explicit Obsidian `App` dependencies and a tested TypeScript port
of the local panel-diff algorithm. The original customized TypeScript project
was not found. The reconstructed source has now passed the core behavioral
comparison and isolated desktop checks described below; equivalence in every
platform, theme and edge case is not claimed.

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

Mobile, arbitrary themes and complex rendered Markdown remain unverified.
Destructive merge/delete UI checks must always use disposable notes only.
