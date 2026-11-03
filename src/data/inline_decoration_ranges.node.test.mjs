import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildInlineDecorationRanges } from './inline_decoration_ranges.ts';

test('maps changed word ranges and removed-line hints into document offsets', () => {
	assert.deepEqual(
		buildInlineDecorationRanges('A\nchapter blue\nZ', [
			{ a: 1, b: 2, ranges: [{ from: 8, to: 12 }], removed: true },
			{ a: 2, b: -1, ranges: [], removedLines: 1 },
		]),
		[
			{ from: 2, to: 2, className: 'bigao-inline-replaced-line', kind: 'line' },
			{ from: 10, to: 14, className: 'bigao-inline-add', kind: 'mark' },
			{ from: 15, to: 15, className: 'bigao-inline-removed-line', kind: 'line' },
		],
	);
});

test('marks new lines and clamps malformed ranges to line boundaries', () => {
	assert.deepEqual(
		buildInlineDecorationRanges('first\nnew', [
			{ a: 1, b: -1, ranges: [{ from: -4, to: 99 }], whole: true },
		]),
		[
			{ from: 6, to: 6, className: 'bigao-inline-new-line', kind: 'line' },
			{ from: 6, to: 9, className: 'bigao-inline-add', kind: 'mark' },
		],
	);
});
