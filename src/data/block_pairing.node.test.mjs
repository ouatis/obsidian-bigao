import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Difference } from './difference.ts';
import {
	filterUnpairedMoves,
	movePairKey,
	movePairingsFromPairs,
	pairMovedBlocks,
} from './block_pairing.ts';

function difference(file1Start, file1Lines, file2Start, file2Lines) {
	return new Difference({ file1Start, file1Lines, file2Start, file2Lines });
}

test('pairMovedBlocks pairs a pure removal with its matching addition', () => {
	const differences = [
		difference(0, ['shared block'], 0, []),
		difference(1, [], 1, ['shared block']),
	];
	const pairs = pairMovedBlocks(differences);
	assert.equal(pairs.length, 1);
	assert.equal(pairs[0].removed.differenceIndex, 0);
	assert.equal(pairs[0].added.differenceIndex, 1);
	assert.equal(pairs[0].score, 1);
});

test('pairMovedBlocks leaves dissimilar blocks unpaired', () => {
	const differences = [
		difference(0, ['alpha beta gamma'], 0, []),
		difference(1, [], 1, ['delta epsilon zeta']),
	];
	assert.deepEqual(pairMovedBlocks(differences), []);
});

test('pairMovedBlocks pairs each side at most once', () => {
	const differences = [
		difference(0, ['duplicate'], 0, []),
		difference(1, ['duplicate'], 1, []),
		difference(2, [], 2, ['duplicate']),
	];
	const pairs = pairMovedBlocks(differences);
	assert.equal(pairs.length, 1);
	const usedRemoved = pairs.map((pair) => pair.removed.differenceIndex);
	const usedAdded = pairs.map((pair) => pair.added.differenceIndex);
	assert.equal(new Set(usedRemoved).size, usedRemoved.length);
	assert.equal(new Set(usedAdded).size, usedAdded.length);
});

test('movePairingsFromPairs annotates both sides with 1-based lines', () => {
	const differences = [
		difference(2, ['moved'], 2, []),
		difference(5, [], 7, ['moved']),
	];
	const [pair] = pairMovedBlocks(differences);
	const pairings = movePairingsFromPairs([pair]);
	assert.deepEqual(pairings.get(0), { line: 8, kind: 'moved-out' });
	assert.deepEqual(pairings.get(1), { line: 3, kind: 'moved-in' });
});

test('filterUnpairedMoves drops pairs by removed-block content key', () => {
	const differences = [
		difference(0, ['moved'], 0, []),
		difference(1, [], 1, ['moved']),
	];
	const [pair] = pairMovedBlocks(differences);
	assert.deepEqual(filterUnpairedMoves([pair], new Set([movePairKey(['moved'])])), []);
	assert.equal(filterUnpairedMoves([pair], new Set()).length, 1);
});

test('filterUnpairedMoves keeps other pairs when one is unpaired', () => {
	const differences = [
		difference(0, ['first move'], 0, []),
		difference(1, [], 1, ['first move']),
		difference(2, ['second move'], 2, []),
		difference(3, [], 3, ['second move']),
	];
	const pairs = pairMovedBlocks(differences);
	const kept = filterUnpairedMoves(pairs, new Set([movePairKey(['first move'])]));
	assert.equal(kept.length, 1);
	assert.equal(kept[0].removed.lines.join('\n'), 'second move');
});
