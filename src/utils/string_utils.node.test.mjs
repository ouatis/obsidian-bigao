import assert from 'node:assert/strict';
import { test } from 'node:test';
import { replaceLine } from './string_utils.ts';

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
