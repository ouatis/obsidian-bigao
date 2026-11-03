import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyMove, replaceLine } from './string_utils.ts';

test('replaceLine replaces one line at the requested position', () => {
  const actual = replaceLine({
    fullText: 'line1\nline2\nline3',
    newLine: 'newLine2',
    position: 1,
    linesToReplace: 1,
  });
  assert.equal(actual, 'line1\nnewLine2\nline3');
});

test('replaceLine inserts multiple lines in place of one', () => {
  const actual = replaceLine({
    fullText: 'line1\nline2\nline3',
    newLine: 'newLine2\nnewLine3',
    position: 1,
    linesToReplace: 1,
  });
  assert.equal(actual, 'line1\nnewLine2\nnewLine3\nline3');
});

test('replaceLine removes a line when the replacement is empty', () => {
  const actual = replaceLine({
    fullText: 'line1\nline2\nline3',
    newLine: '',
    position: 1,
    linesToReplace: 1,
  });
  assert.equal(actual, 'line1\nline3');
});

test('replaceLine replaces two lines with one', () => {
  const actual = replaceLine({
    fullText: 'line1\nline2\nline3\nline4',
    newLine: 'line5',
    position: 1,
    linesToReplace: 2,
  });
  assert.equal(actual, 'line1\nline5\nline4');
});

test('applyMove moves a block down (removal before insertion)', () => {
  const actual = applyMove({
    fullText: 'a\nb\nc\nd\ne',
    removedStart: 0,
    removedCount: 1,
    insertStart: 2,
    insertedLines: ['a'],
  });
  assert.equal(actual, 'b\na\nc\nd\ne');
});

test('applyMove moves a block up (insertion before removal)', () => {
  const actual = applyMove({
    fullText: 'a\nb\nc\nd\ne',
    removedStart: 2,
    removedCount: 1,
    insertStart: 0,
    insertedLines: ['c'],
  });
  assert.equal(actual, 'c\na\nb\nd\ne');
});

test('applyMove moves a block to the end', () => {
  const actual = applyMove({
    fullText: 'a\nb\nc',
    removedStart: 0,
    removedCount: 1,
    insertStart: 3,
    insertedLines: ['a'],
  });
  assert.equal(actual, 'b\nc\na');
});

test('applyMove handles different removal and insertion sizes', () => {
  const actual = applyMove({
    fullText: 'a\nb\nc\nd',
    removedStart: 0,
    removedCount: 2,
    insertStart: 4,
    insertedLines: ['a2', 'b2'],
  });
  assert.equal(actual, 'c\nd\na2\nb2');
});

test('applyMove converges a pure move to the other file', () => {
  // file1 'a\nb\nc' vs file2 'c\na\nb': accepting the move must yield file2.
  const actual = applyMove({
    fullText: 'a\nb\nc',
    removedStart: 0,
    removedCount: 2,
    insertStart: 3,
    insertedLines: ['a', 'b'],
  });
  assert.equal(actual, 'c\na\nb');
});
