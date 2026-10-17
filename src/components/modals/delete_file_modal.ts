import { App, Modal, TFile } from 'obsidian';

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
		// Counteract gravity pull by moving box up for balanced composition
		this.modalEl.addClass('mb-20');

		this.contentEl.createEl('h3', {
			text: `删除「${this.file2.name}」？`,
		});
		this.contentEl.createEl('p', {
			text:
				`「${this.file1.name}」与「${this.file2.name}」的内容完全相同。` +
				`要删除这个重复文件吗？请注意，此操作不可撤销。`,
		});

		const buttonContainer = this.contentEl.createDiv(
			'file-diff__button-container'
		);

		const deleteButton = buttonContainer.createEl('button', {
			text: '删除',
			cls: 'mod-warning mr-2',
		});
		const cancelButton = buttonContainer.createEl('button', {
			text: '取消',
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
