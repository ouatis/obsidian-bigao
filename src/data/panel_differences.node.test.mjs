import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  computePanelDifferences,
  MAX_PANEL_LINES,
} from './panel_differences.ts';

const tokenize = (text) => text.split(/(\s+)/);

test('aligns a changed line with its closest counterpart after an insertion', () => {
  assert.deepEqual(
    computePanelDifferences('A\nchapter blue\nZ', 'A\ninserted\nchapter red\nZ', tokenize),
    [
      { a: 1, b: 2, ranges: [{ from: 8, to: 12 }], whole: false, removed: true },
      { a: 2, b: -1, ranges: [], removedLines: 1 },
    ],
  );
});

test('returns no differences for identical notes', () => {
  assert.deepEqual(computePanelDifferences('A\nB\nC', 'A\nB\nC', tokenize), []);
});

test('marks comparison-only lines at the nearest current line', () => {
  assert.deepEqual(computePanelDifferences('A\nC', 'A\nB\nC', tokenize), [
    { a: 1, b: -1, ranges: [], removedLines: 1 },
  ]);
});

test('marks all current text when the comparison note is empty', () => {
  assert.deepEqual(computePanelDifferences('first line', '', tokenize), [
    {
      a: 0,
      b: -1,
      ranges: [{ from: 0, to: 10 }],
      whole: true,
      removed: false,
    },
  ]);
});

test('enforces the rendered line-count bound on both notes', () => {
  const longNote = Array.from({ length: MAX_PANEL_LINES + 1 }, () => 'line').join('\n');
  assert.deepEqual(computePanelDifferences(longNote, 'short', tokenize), []);
  assert.deepEqual(computePanelDifferences('short', longNote, tokenize), []);
});

test('falls back to whole-line highlighting when the document-wide token budget is spent', () => {
  const oldLine = Array.from({ length: 150 }, () => 'old').join(' ');
  const newLine = Array.from({ length: 150 }, () => 'new').join(' ');
  const differences = computePanelDifferences(
    Array.from({ length: 50 }, () => newLine).join('\n'),
    Array.from({ length: 50 }, () => oldLine).join('\n'),
    tokenize,
  );

  assert.equal(differences.length, 50);
  assert.deepEqual(differences.at(-1).ranges, [{ from: 0, to: newLine.length }]);
});
