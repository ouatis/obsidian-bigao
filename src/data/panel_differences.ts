import { structuredPatch } from 'diff';
import { FileDifferences } from './file_differences.ts';

export interface CharacterRange {
	from: number;
	to: number;
}

export interface PanelDifference {
	/** Zero-based line in the current note. */
	a: number;
	/** Matching zero-based line in the comparison note, or -1 when new. */
	b: number;
	ranges: CharacterRange[];
	whole?: boolean;
	removed?: boolean;
	removedLines?: number;
}

export type WordTokenizer = (text: string) => string[];

export const MAX_PANEL_LINES = 4000;

const MAX_LCS_CELLS = 1_000_000;
const MAX_LINE_MATCH_PAIRS = 65_536;
const MAX_TOKEN_COUNT = 800;
/** Blocks below this word-overlap are treated as unrelated, not as moves. */
const BLOCK_MATCH_THRESHOLD = 0.5;
/** Blocks larger than this are skipped for cross-hunk pairing (cost guard). */
const MAX_BLOCK_CHARS = 20_000;

interface TokenOffset {
	t: string;
	s: number;
	e: number;
}

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

function tokenOffsets(tokens: string[]): TokenOffset[] {
	const offsets: TokenOffset[] = [];
	let position = 0;
	for (const token of tokens) {
		if (!token) continue;
		offsets.push({ t: token, s: position, e: position + token.length });
		position += token.length;
	}
	return offsets;
}

function addedRanges(
	oldLine: string,
	currentLine: string,
	wordTokenizer: WordTokenizer | undefined,
	budget: { remaining: number }
): CharacterRange[] {
	if (!currentLine) return [];
	const oldTokens = tokenOffsets(tokenize(oldLine, wordTokenizer));
	const currentTokens = tokenOffsets(tokenize(currentLine, wordTokenizer));
	if (!currentTokens.length) return [];
	if (!oldTokens.length) return [{ from: 0, to: currentLine.length }];

	const cells = oldTokens.length * currentTokens.length;
	if (
		oldTokens.length > MAX_TOKEN_COUNT ||
		currentTokens.length > MAX_TOKEN_COUNT ||
		cells > budget.remaining
	) {
		return [{ from: 0, to: currentLine.length }];
	}
	budget.remaining -= cells;

	const dp: number[][] = Array.from(
		{ length: oldTokens.length + 1 },
		() => new Array<number>(currentTokens.length + 1).fill(0)
	);
	for (let oldIndex = oldTokens.length - 1; oldIndex >= 0; oldIndex -= 1) {
		for (
			let currentIndex = currentTokens.length - 1;
			currentIndex >= 0;
			currentIndex -= 1
		) {
			dp[oldIndex][currentIndex] =
				oldTokens[oldIndex].t === currentTokens[currentIndex].t
					? dp[oldIndex + 1][currentIndex + 1] + 1
					: Math.max(
							dp[oldIndex + 1][currentIndex],
							dp[oldIndex][currentIndex + 1]
						);
		}
	}

	const ranges: CharacterRange[] = [];
	let oldIndex = 0;
	let currentIndex = 0;
	while (oldIndex < oldTokens.length && currentIndex < currentTokens.length) {
		if (oldTokens[oldIndex].t === currentTokens[currentIndex].t) {
			oldIndex += 1;
			currentIndex += 1;
		} else if (dp[oldIndex + 1][currentIndex] >= dp[oldIndex][currentIndex + 1]) {
			oldIndex += 1;
		} else {
			ranges.push({
				from: currentTokens[currentIndex].s,
				to: currentTokens[currentIndex].e,
			});
			currentIndex += 1;
		}
	}
	while (currentIndex < currentTokens.length) {
		ranges.push({
			from: currentTokens[currentIndex].s,
			to: currentTokens[currentIndex].e,
		});
		currentIndex += 1;
	}
	return ranges;
}

function lineSimilarity(
	oldLine: string,
	currentLine: string,
	wordTokenizer: WordTokenizer | undefined
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
 * Computes changed current-note lines against the comparison note.
 * `wordTokenizer` should preserve the source text when concatenated so ranges
 * remain valid UTF-16 offsets for rendering.
 */
export function computePanelDifferences(
	docText: string,
	otherText: string,
	wordTokenizer?: WordTokenizer
): PanelDifference[] {
	const differences: PanelDifference[] = [];
	const currentLines = (docText || '').split('\n');
	const otherLines = (otherText || '').split('\n');
	if (
		currentLines.length > MAX_PANEL_LINES ||
		otherLines.length > MAX_PANEL_LINES
	) {
		return differences;
	}

	let patchCurrent = docText || '';
	let patchOther = otherText || '';
	if (patchCurrent && !/\r?\n$/.test(patchCurrent)) patchCurrent += '\n';
	if (patchOther && !/\r?\n$/.test(patchOther)) patchOther += '\n';
	const parsed = structuredPatch('', '', patchOther, patchCurrent, '', '', {
		context: 0,
	});
	if (!parsed.hunks.length) return differences;

	const changes = FileDifferences.fromParsedDiff(parsed).differences;
	const budget = { remaining: MAX_LCS_CELLS };

	// Pure removal / pure addition changes become blocks; paired blocks let a
	// moved or rewritten paragraph line up across hunks instead of showing up
	// as a brand-new block plus a bare removal count.
	const addedBlocks = new Map<number, { lines: string[]; globalStart: number }>();
	const removedBlocks = new Map<number, { lines: string[]; globalStart: number }>();
	for (let index = 0; index < changes.length; index += 1) {
		const change = changes[index];
		const oldLines = change.file1Lines || [];
		const newLines = change.file2Lines || [];
		if (!oldLines.length && newLines.length) {
			addedBlocks.set(index, { lines: newLines, globalStart: change.file2Start });
		}
		if (oldLines.length && !newLines.length) {
			removedBlocks.set(index, { lines: oldLines, globalStart: change.file1Start });
		}
	}

	const globallyUsedOld = new Set<number>();
	const prematched = new Map<number, Map<number, PanelDifference>>();
	if (addedBlocks.size && removedBlocks.size) {
		const candidates: { added: number; removed: number; score: number }[] = [];
		for (const [addedIndex, added] of addedBlocks) {
			const addedText = added.lines.join('\n');
			if (addedText.length > MAX_BLOCK_CHARS) continue;
			for (const [removedIndex, removed] of removedBlocks) {
				const removedText = removed.lines.join('\n');
				if (removedText.length > MAX_BLOCK_CHARS) continue;
				const score = lineSimilarity(removedText, addedText, wordTokenizer);
				if (score >= BLOCK_MATCH_THRESHOLD) {
					candidates.push({ added: addedIndex, removed: removedIndex, score });
				}
			}
		}
		candidates.sort((a, b) => b.score - a.score);
		const takenAdded = new Set<number>();
		const takenRemoved = new Set<number>();
		for (const candidate of candidates) {
			if (takenAdded.has(candidate.added) || takenRemoved.has(candidate.removed)) continue;
			takenAdded.add(candidate.added);
			takenRemoved.add(candidate.removed);
			const added = addedBlocks.get(candidate.added)!;
			const removedBlock = removedBlocks.get(candidate.removed)!;
			const matched = new Map<number, PanelDifference>();
			const used = new Set<number>();
			for (let index = 0; index < added.lines.length; index += 1) {
				const currentLine = String(added.lines[index] || '').replace(/\r$/, '');
				if (!currentLine.trim()) continue;

				let match = -1;
				if (
					added.lines.length === removedBlock.lines.length ||
					added.lines.length * removedBlock.lines.length > MAX_LINE_MATCH_PAIRS
				) {
					match = index < removedBlock.lines.length ? index : -1;
				} else {
					let bestScore = 0;
					for (let candidateIndex = 0; candidateIndex < removedBlock.lines.length; candidateIndex += 1) {
						if (used.has(candidateIndex)) continue;
						const candidateLine = String(removedBlock.lines[candidateIndex] || '').replace(/\r$/, '');
						const score = lineSimilarity(candidateLine, currentLine, wordTokenizer);
						if (score > bestScore) {
							bestScore = score;
							match = candidateIndex;
						}
					}
				}

				let ranges: CharacterRange[];
				if (match < 0) {
					ranges = [{ from: 0, to: currentLine.length }];
				} else {
					used.add(match);
					globallyUsedOld.add(removedBlock.globalStart + match);
					const oldLine = String(removedBlock.lines[match] || '').replace(/\r$/, '');
					ranges = addedRanges(oldLine, currentLine, wordTokenizer, budget);
				}

				const nonEmptyRanges = ranges.filter((range) => range.to > range.from);
				const removed =
					match >= 0 &&
					String(removedBlock.lines[match] || '').replace(/\r$/, '') !== currentLine;
				if (nonEmptyRanges.length || removed) {
					matched.set(index, {
						a: added.globalStart + index,
						b: match < 0 ? -1 : removedBlock.globalStart + match,
						ranges: nonEmptyRanges,
						whole: match < 0,
						removed,
					});
				}
			}
			prematched.set(candidate.added, matched);
		}
	}

	for (let changeIndex = 0; changeIndex < changes.length; changeIndex += 1) {
		const change = changes[changeIndex];
		const oldLines = change.file1Lines || [];
		const newLines = change.file2Lines || [];

		const prematchedLines = prematched.get(changeIndex);
		if (prematchedLines) {
			for (const difference of prematchedLines.values()) differences.push(difference);
			continue;
		}
		const usedOld = new Set<number>();
		for (let index = 0; index < newLines.length; index += 1) {
			const currentLine = String(newLines[index] || '').replace(/\r$/, '');
			if (!currentLine.trim()) continue;

			let match = -1;
			if (
				oldLines.length === newLines.length ||
				oldLines.length * newLines.length > MAX_LINE_MATCH_PAIRS
			) {
				match = index < oldLines.length ? index : -1;
			} else {
				let bestScore = 0;
				for (let candidateIndex = 0; candidateIndex < oldLines.length; candidateIndex += 1) {
					if (usedOld.has(candidateIndex)) continue;
					const candidate = String(oldLines[candidateIndex] || '').replace(/\r$/, '');
					const score = lineSimilarity(candidate, currentLine, wordTokenizer);
					if (score > bestScore) {
						bestScore = score;
						match = candidateIndex;
					}
				}
			}

			let ranges: CharacterRange[];
			if (match < 0) {
				ranges = [{ from: 0, to: currentLine.length }];
			} else {
				usedOld.add(match);
				const oldLine = String(oldLines[match] || '').replace(/\r$/, '');
				ranges = addedRanges(oldLine, currentLine, wordTokenizer, budget);
			}

			const nonEmptyRanges = ranges.filter((range) => range.to > range.from);
			const removed =
				match >= 0 &&
				String(oldLines[match] || '').replace(/\r$/, '') !== currentLine;
			if (nonEmptyRanges.length || removed) {
				differences.push({
					a: change.file2Start + index,
					b: match < 0 ? -1 : change.file1Start + match,
					ranges: nonEmptyRanges,
					whole: match < 0,
					removed,
				});
			}
		}

		let removedLineCount = 0;
		for (let index = 0; index < oldLines.length; index += 1) {
			if (usedOld.has(index)) continue;
			if (globallyUsedOld.has(change.file1Start + index)) continue;
			removedLineCount += 1;
		}
		if (removedLineCount > 0) {
			const anchorLine = Math.min(
				change.file2Start + newLines.length,
				currentLines.length - 1
			);
			const existing = differences.find((difference) => difference.a === anchorLine);
			if (existing) {
				existing.removedLines = (existing.removedLines || 0) + removedLineCount;
			} else {
				differences.push({
					a: anchorLine,
					b: -1,
					ranges: [],
					removedLines: removedLineCount,
				});
			}
		}
	}
	return differences;
}
