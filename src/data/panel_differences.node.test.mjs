import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  computePanelDifferences,
  MAX_PANEL_LINES,
} from './panel_differences.ts';
import { tokenizeWords } from '../utils/word_diff.ts';

// 中文场景用产品真实的分词器：整行单 token 会让词袋相似度失真。
const tokenize = (text) => tokenizeWords(text);

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

test('treats a verbatim moved paragraph as unchanged instead of new-plus-removed', () => {
  const current = ['标题', '段落A：第一段的文字。', '段落B：被移动的段落。', '段落C：第三段的文字。'].join('\n');
  const other = ['标题', '段落A：第一段的文字。', '段落C：第三段的文字。', '段落B：被移动的段落。'].join('\n');
  assert.deepEqual(computePanelDifferences(current, other, tokenize), []);
});

test('aligns a moved-and-edited paragraph with its original position', () => {
  const current = ['标题', '段落A：第一段的文字。', '段落B：被移动的段落。', '段落C：第三段的文字。'].join('\n');
  const other = ['标题', '段落A：第一段的文字。', '段落C：第三段的文字。', '段落B：被移动过的段落。'].join('\n');
  const differences = computePanelDifferences(current, other, tokenize);
  assert.equal(differences.length, 1);
  assert.equal(differences[0].a, 2, 'the moved paragraph is reported at its current position');
  assert.equal(differences[0].b, 3, 'it lines up with its counterpart in the comparison note');
  assert.equal(differences[0].whole, false);
  assert.deepEqual(differences[0].ranges, [{ from: 7, to: 8 }], 'only the edited word is marked');
});

test('does not pair unrelated pure-addition and pure-removal blocks', () => {
  const current = ['标题', '全新内容：完全不同的主题与文字。', '段落C：第三段的文字。'].join('\n');
  const other = ['标题', '段落A：第一段的文字。', '段落B：旧的一段。', '段落C：第三段的文字。'].join('\n');
  const differences = computePanelDifferences(current, other, tokenize);
  // The added line is matched inside its own hunk (pre-existing matcher
  // behavior); cross-block pairing correctly stays out of it.
  const added = differences.find((difference) => difference.a === 1);
  assert.ok(added && added.b === 1, 'the unrelated new line lines up within its own hunk');
  const removedCount = differences.reduce((sum, difference) => sum + (difference.removedLines || 0), 0);
  assert.equal(removedCount, 1, 'the leftover comparison line still counts as removed');
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
