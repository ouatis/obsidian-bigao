import { diffArrays } from 'diff';

import { namespacedId } from '../ids.ts';
import { storageGet } from './app_storage.ts';

export interface WordChange {
	value: string;
	added?: boolean;
	removed?: boolean;
}

export function chineseDiffEnabled(): boolean {
	try {
		const setting = storageGet(namespacedId('zh-diff')) ?? null;
		return setting === null || setting === '1' || setting === 'true';
	} catch {
		return true;
	}
}

function fallbackTokens(value: string): string[] {
	const tokens = value.split(/([^\S\r\n]+|[()[\]{}'"\r\n]|\b)/);
	const extendedWordChars = /^[A-Za-z\xC0-\u02C6\u02C8-\u02D7\u02DE-\u02FF\u1E00-\u1EFF]+$/;
	for (let index = 0; index < tokens.length - 1; index += 1) {
		if (
			!tokens[index + 1] &&
			tokens[index + 2] &&
			extendedWordChars.test(tokens[index]) &&
			extendedWordChars.test(tokens[index + 2])
		) {
			tokens[index] += tokens[index + 2];
			tokens.splice(index + 1, 2);
			index -= 1;
		}
	}
	return tokens.filter(Boolean);
}

export function tokenizeWords(
	value: string,
	useChineseSegmentation = chineseDiffEnabled()
): string[] {
	if (!value) return [];
	if (useChineseSegmentation && typeof Intl.Segmenter === 'function') {
		try {
			const segments = Array.from(
				new Intl.Segmenter('zh-Hans', { granularity: 'word' }).segment(value),
				(segment) => segment.segment
			);
			if (segments.length) return segments.filter(Boolean);
		} catch {
			// Use the compatible fallback when Segmenter is unavailable or fails.
		}
	}
	return fallbackTokens(value);
}

export function diffWordsWithTokenizer(
	oldText: string,
	newText: string,
	tokenizer: (value: string) => string[] = tokenizeWords
): WordChange[] {
	const changes = diffArrays(tokenizer(oldText), tokenizer(newText), {
		comparator: (left, right) =>
			left === right || (!/\S/.test(left) && !/\S/.test(right)),
	});
	return changes.map((change) => ({
		value: change.value.join(''),
		added: change.added,
		removed: change.removed,
	}));
}
