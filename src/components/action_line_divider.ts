export class ActionLineDivider {
	static build(actionLine: HTMLDivElement): void {
		actionLine.createSpan({
			text: '|',
			cls: 'text-xxs file-diff__action-line',
		});
	}
}
