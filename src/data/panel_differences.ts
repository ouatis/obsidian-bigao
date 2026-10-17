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
	for (const change of changes) {
		const oldLines = change.file1Lines || [];
		const newLines = change.file2Lines || [];
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
			if (!usedOld.has(index)) removedLineCount += 1;
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
