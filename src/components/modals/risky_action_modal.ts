import { App, Modal } from 'obsidian';
import { getStrings } from '../../i18n.ts';

export class RiskyActionModal extends Modal {
	constructor(args: {
		app: App;
		onAccept: (error: Error | null) => void;
	}) {
		super(args.app);
		this.onAccept = args.onAccept;
	}

	private readonly onAccept: (error: Error | null) => void;

	onOpen(): void {
		const t = getStrings();
		// Counteract gravity pull by moving box up for balanced composition
		this.modalEl.addClass('mb-20');

		this.contentEl.createEl('h3', { text: t.riskyTitle });
		this.contentEl.createEl('p', {
			text: t.riskyBody,
		});

		const buttonContainer = this.contentEl.createDiv(
			'file-diff__button-container'
		);

		const deleteButton = buttonContainer.createEl('button', {
			text: t.riskyAccept,
			cls: 'mod-warning mr-2',
		});
		const cancelButton = buttonContainer.createEl('button', {
			text: t.cancel,
		});

		cancelButton.addEventListener('click', () => this.close());
		deleteButton.addEventListener('click', () => {
			this.close();
			this.onAccept(null);
		});
	}
}
