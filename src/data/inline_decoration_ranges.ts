import type { PanelDifference } from './panel_differences.ts';

export interface InlineDecorationRange {
	from: number;
	to: number;
	className: string;
	kind: 'mark' | 'line';
}

/** Converts line-relative comparison results into safe CodeMirror document offsets. */
export function buildInlineDecorationRanges(
	docText: string,
	differences: PanelDifference[]
): InlineDecorationRange[] {
	const lines = (docText || '').split('\n');
	const lineStarts: number[] = [];
	let offset = 0;
	for (const line of lines) {
		lineStarts.push(offset);
		offset += line.length + 1;
	}

	const decorations: InlineDecorationRange[] = [];
	for (const difference of differences) {
		if (difference.a < 0 || difference.a >= lines.length) continue;
		const line = lines[difference.a];
		const lineStart = lineStarts[difference.a];
		const lineClasses: string[] = [];
		if (difference.whole) lineClasses.push('bigao-inline-new-line');
		if (difference.removed) lineClasses.push('bigao-inline-replaced-line');
		if ((difference.removedLines || 0) > 0) lineClasses.push('bigao-inline-removed-line');
		if (lineClasses.length) {
			decorations.push({
				from: lineStart,
				to: lineStart,
				className: lineClasses.join(' '),
				kind: 'line',
			});
		}

		for (const range of difference.ranges) {
			const from = Math.max(0, Math.min(line.length, range.from));
			const to = Math.max(from, Math.min(line.length, range.to));
			if (to <= from) continue;
			decorations.push({
				from: lineStart + from,
				to: lineStart + to,
				className: 'bigao-inline-add',
				kind: 'mark',
			});
		}
	}
	return decorations;
}
