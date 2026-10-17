import { App, Modal } from 'obsidian';

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
		// Counteract gravity pull by moving box up for balanced composition
		this.modalEl.addClass('mb-20');

		this.contentEl.createEl('h3', { text: '确定要承担此风险吗？' });
		this.contentEl.createEl('p', {
			text: '合并操作会不可逆地修改文件。请谨慎继续，仅在你已了解并接受相关风险时执行。',
		});

		const buttonContainer = this.contentEl.createDiv(
			'file-diff__button-container'
		);

		const deleteButton = buttonContainer.createEl('button', {
			text: '接受风险',
			cls: 'mod-warning mr-2',
		});
		const cancelButton = buttonContainer.createEl('button', {
			text: '取消',
		});

		cancelButton.addEventListener('click', () => this.close());
		deleteButton.addEventListener('click', () => {
			this.close();
			this.onAccept(null);
		});
	}
}
