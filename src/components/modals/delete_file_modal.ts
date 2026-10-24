import { App, Modal, TFile } from 'obsidian';
import { getStrings } from '../../i18n.ts';

export class DeleteFileModal extends Modal {
	constructor(args: {
		app: App;
		file1: TFile;
		file2: TFile;
		onDone: (error: Error | null) => void;
	}) {
		super(args.app);
		this.file1 = args.file1;
		this.file2 = args.file2;
		this.onDone = args.onDone;
	}

	private readonly file1: TFile;

	private readonly file2: TFile;

	private readonly onDone: (error: Error | null) => void;

	onOpen(): void {
		const t = getStrings();
		// Counteract gravity pull by moving box up for balanced composition
		this.modalEl.addClass('mb-20');

		this.contentEl.createEl('h3', {
			text: t.deleteTitle(this.file2.name),
		});
		this.contentEl.createEl('p', {
			text: t.deleteBody(this.file1.name, this.file2.name),
		});

		const buttonContainer = this.contentEl.createDiv(
			'file-diff__button-container'
		);

		const deleteButton = buttonContainer.createEl('button', {
			text: t.deleteButton,
			cls: 'mod-warning mr-2',
		});
		const cancelButton = buttonContainer.createEl('button', {
			text: t.cancel,
		});

		deleteButton.addEventListener('click', () => this.handleDeleteClick());
		cancelButton.addEventListener('click', () => this.close());
	}

	handleDeleteClick(): void {
		this.app.vault.delete(this.file2);

		this.close();

		this.onDone(null);
	}
}
