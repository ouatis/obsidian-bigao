import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffWordsWithTokenizer, tokenizeWords } from './word_diff.ts';

test('Chinese segmentation highlights the changed word rather than the whole line', () => {
  const changes = diffWordsWithTokenizer('我喜欢蓝色', '我喜欢红色', (text) => tokenizeWords(text, true));
  assert.deepEqual(changes.filter((change) => change.added), [
    { value: '红色', added: true, removed: undefined },
  ]);
});

test('whitespace-only changes are treated as equivalent', () => {
  const changes = diffWordsWithTokenizer('one word', 'one   word', (text) => tokenizeWords(text, false));
  assert.ok(changes.every((change) => !change.added && !change.removed));
});

test('fallback tokenization preserves source text when joined', () => {
  const source = `a\tb (c)\n中文`;
  assert.equal(tokenizeWords(source, false).join(''), source);
});
