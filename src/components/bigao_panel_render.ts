import type { PanelDifference } from '../data/panel_differences.ts';
import { getStrings } from '../i18n.ts';

export function renderFull(
	container: HTMLElement,
	docLines: string[],
	differences: PanelDifference[]
): HTMLElement {
	container.empty();
	const t = getStrings();
	const byLine = new Map(differences.map((difference) => [difference.a, difference]));
	const body = container.createDiv({ cls: 'bigao-panel__body' });
	for (let lineNumber = 0; lineNumber < Math.max(docLines.length, 1); lineNumber += 1) {
		const text = docLines[lineNumber] || '';
		const difference = byLine.get(lineNumber);
		const row = body.createDiv({ cls: 'bigao-panel__row' });
		row.dataset.line = String(lineNumber);
		row.createDiv({ cls: 'bigao-panel__gutter', text: String(lineNumber + 1) });
		const line = row.createDiv({ cls: 'bigao-panel__text' });

		if (difference?.removedLines) {
			line.createSpan({
				cls: 'bigao-panel__removed',
				text: t.panelRemovedLines(difference.removedLines),
			});
		}
		if (difference?.removed) {
			line.createSpan({ cls: 'bigao-panel__removed', text: t.panelRemovedBlock });
		}
		if (!text) {
			line.createSpan({ cls: 'bigao-panel__blank' });
		} else if (!difference?.ranges.length) {
			line.createSpan({ text });
		} else {
			const ranges = [...difference.ranges].sort((a, b) => a.from - b.from);
			let position = 0;
			for (const range of ranges) {
				if (range.from > position) {
					line.createSpan({ text: text.slice(position, range.from) });
				}
				line.createSpan({
					text: text.slice(range.from, range.to),
					cls: 'bigao-panel__add',
				});
				position = range.to;
			}
			if (position < text.length) line.createSpan({ text: text.slice(position) });
		}

		if (difference) {
			row.addClass('bigao-panel__row--diff');
			if (
				(difference.removedLines || difference.removed) &&
				!difference.ranges.length
			) {
				row.addClass('bigao-panel__row--removed');
			}
		}
	}
	return body;
}

export function scrollToLine(body: HTMLElement | null, lineNumber: number, smooth: boolean): boolean {
	const row = body?.querySelector<HTMLElement>(
		`.bigao-panel__row[data-line="${lineNumber}"]`
	);
	if (!body || !row) return false;
	try {
		if (typeof row.scrollIntoView === 'function') {
			row.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
			return true;
		}
		body.scrollTop = row.offsetTop - body.clientHeight / 2;
		return true;
	} catch {
		return false;
	}
}
