import { App, Notice, SuggestModal, TFile } from 'obsidian';
import { getStrings } from '../i18n.ts';

class CompareFileModal extends SuggestModal<TFile> {
	private readonly files: TFile[];
	private readonly resolveChoice: (file: TFile | null) => void;
	private selectedFile: TFile | null = null;
	private choiceSettled = false;
	private readonly resultLimit = 60;

	constructor(app: App, files: TFile[], resolveChoice: (file: TFile | null) => void) {
		super(app);
		this.files = files;
		this.resolveChoice = resolveChoice;
	}

	override getSuggestions(query: string): TFile[] {
		const normalizedQuery = query.trim().toLocaleLowerCase();
		if (!normalizedQuery) return this.files.slice(0, this.resultLimit);
		return this.files
			.filter((file) =>
				`${file.name}\n${file.path}`
					.toLocaleLowerCase()
					.includes(normalizedQuery)
			)
			.slice(0, this.resultLimit);
	}

	override renderSuggestion(file: TFile, element: HTMLElement): void {
		element.createDiv({ text: file.name });
		const directory = file.parent?.path;
		if (directory) {
			element.createDiv({ cls: 'bigao-pick__dir', text: directory });
		}
	}

	override onChooseSuggestion(file: TFile): void {
		this.selectedFile = file;
		this.settleChoice(file);
		this.close();
	}

	override onClose(): void {
		// Obsidian may fire onClose before onChooseSuggestion for a picked item.
		// Defer cancellation by one microtask so a same-turn selection can win.
		void Promise.resolve().then(() => this.settleChoice(this.selectedFile));
	}

	private settleChoice(file: TFile | null): void {
		if (this.choiceSettled) return;
		this.choiceSettled = true;
		this.resolveChoice(file);
	}
}

export async function pickCompareFile(app: App, activeFile: TFile): Promise<TFile | null> {
	const t = getStrings();
	const files = app.vault
		.getMarkdownFiles()
		.filter((file) => file.path !== activeFile.path)
		.sort((a, b) => b.stat.mtime - a.stat.mtime);
	if (!files.length) {
		new Notice(t.noticeNoOtherNotes);
		return null;
	}

	return new Promise((resolve) => {
		const modal = new CompareFileModal(app, files, resolve);
		modal.setPlaceholder(t.pickerPlaceholder);
		modal.open();
	});
}
