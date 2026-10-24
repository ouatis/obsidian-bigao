import type { Difference } from './difference.ts';

export type WordTokenizer = (text: string) => string[];

export interface SideBlock {
	lines: string[];
	start: number;
}

export interface BlockPair {
	added: SideBlock & { differenceIndex: number };
	removed: SideBlock & { differenceIndex: number };
	score: number;
}

export interface MoveInfo {
	/** 1-based line in the note the content moved relative to. */
	line: number;
	kind: 'moved-out' | 'moved-in';
}

export interface BlockPairingOptions {
	threshold?: number;
	maxBlockChars?: number;
}

/** Blocks below this word-overlap are treated as unrelated, not as moves. */
const BLOCK_MATCH_THRESHOLD = 0.5;
/** Blocks larger than this are skipped for pairing (cost guard). */
const MAX_BLOCK_CHARS = 20_000;

function tokenize(text: string, wordTokenizer?: WordTokenizer): string[] {
	if (wordTokenizer) {
		try {
			return wordTokenizer(text || '');
		} catch {
			// Fall back to whitespace-preserving tokens if segmentation fails.
		}
	}
	return text ? text.split(/(\s+)/) : [];
}

/** Bag-of-words overlap over trimmed tokens: 1 for identical content, 0 for disjoint. */
export function lineSimilarity(
	oldLine: string,
	currentLine: string,
	wordTokenizer?: WordTokenizer
): number {
	const oldTokens = tokenize(oldLine, wordTokenizer).filter(
		(token) => token && token.trim()
	);
	const currentTokens = tokenize(currentLine, wordTokenizer).filter(
		(token) => token && token.trim()
	);
	if (!oldTokens.length || !currentTokens.length) return 0;

	const counts = new Map<string, number>();
	let common = 0;
	for (const token of oldTokens) {
		counts.set(token, (counts.get(token) || 0) + 1);
	}
	for (const token of currentTokens) {
		const count = counts.get(token) || 0;
		if (count > 0) {
			common += 1;
			counts.set(token, count - 1);
		}
	}
	return common / Math.max(oldTokens.length, currentTokens.length);
}

/**
 * Splits the diff changes into pure-removal blocks (content missing from
 * file2) and pure-addition blocks (content new to file2). Mixed hunks are
 * left for the per-change matcher.
 */
export function classifySideBlocks(differences: readonly Difference[]): {
	added: Map<number, SideBlock>;
	removed: Map<number, SideBlock>;
} {
	const added = new Map<number, SideBlock>();
	const removed = new Map<number, SideBlock>();
	for (let index = 0; index < differences.length; index += 1) {
		const difference = differences[index];
		const oldLines = difference.file1Lines || [];
		const newLines = difference.file2Lines || [];
		if (!oldLines.length && newLines.length) {
			added.set(index, { lines: newLines, start: difference.file2Start });
		}
		if (oldLines.length && !newLines.length) {
			removed.set(index, { lines: oldLines, start: difference.file1Start });
		}
	}
	return { added, removed };
}

/**
 * Greedy pairing of pure-removal and pure-addition blocks by word overlap,
 * best score first. Pairs describe which two diff blocks hold (nearly) the
 * same content, so callers can present them as moves rather than separate
 * deletion and addition.
 */
export function pairMovedBlocks(
	differences: readonly Difference[],
	wordTokenizer?: WordTokenizer,
	options: BlockPairingOptions = {}
): BlockPair[] {
	const threshold = options.threshold ?? BLOCK_MATCH_THRESHOLD;
	const maxBlockChars = options.maxBlockChars ?? MAX_BLOCK_CHARS;
	const { added, removed } = classifySideBlocks(differences);
	if (!added.size || !removed.size) return [];

	const candidates: BlockPair[] = [];
	for (const [addedIndex, addedBlock] of added) {
		const addedText = addedBlock.lines.join('\n');
		if (addedText.length > maxBlockChars) continue;
		for (const [removedIndex, removedBlock] of removed) {
			const removedText = removedBlock.lines.join('\n');
			if (removedText.length > maxBlockChars) continue;
			const score = lineSimilarity(removedText, addedText, wordTokenizer);
			if (score >= threshold) {
				candidates.push({
					added: { ...addedBlock, differenceIndex: addedIndex },
					removed: { ...removedBlock, differenceIndex: removedIndex },
					score,
				});
			}
		}
	}
	candidates.sort((a, b) => b.score - a.score);

	const pairs: BlockPair[] = [];
	const takenAdded = new Set<number>();
	const takenRemoved = new Set<number>();
	for (const candidate of candidates) {
		if (takenAdded.has(candidate.added.differenceIndex) || takenRemoved.has(candidate.removed.differenceIndex)) continue;
		takenAdded.add(candidate.added.differenceIndex);
		takenRemoved.add(candidate.removed.differenceIndex);
		pairs.push(candidate);
	}
	return pairs;
}

/**
 * Move annotations for the full-diff view: which diff blocks form a move and
 * where their counterpart lines live in the other note (1-based for display).
 */
export function buildMovePairings(
	differences: readonly Difference[],
	wordTokenizer?: WordTokenizer,
	options: BlockPairingOptions = {}
): Map<number, MoveInfo> {
	const pairings = new Map<number, MoveInfo>();
	for (const pair of pairMovedBlocks(differences, wordTokenizer, options)) {
		pairings.set(pair.added.differenceIndex, {
			line: pair.removed.start + 1,
			kind: 'moved-in',
		});
		pairings.set(pair.removed.differenceIndex, {
			line: pair.added.start + 1,
			kind: 'moved-out',
		});
	}
	return pairings;
}
