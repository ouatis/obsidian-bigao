import { EN } from './locales/en.ts';
import { ZH_CN } from './locales/zh-CN.ts';

export type Language = 'zh-CN' | 'en';

export interface Strings {
	/** 命令面板里的命令名。Command names in the palette. */
	commandPanelVertical: string;
	commandPanelHorizontal: string;
	commandPanelOff: string;
	commandCompare: string;
	commandCompareAndMerge: string;
	commandFindSyncConflicts: string;
	/** 通知。Notices. */
	noticePanelClosed: string;
	noticeNoComparisonPanes: string;
	noticeNoOtherNotes: string;
	noticeOpenEditorFirst: string;
	noticeFollowOn: string;
	noticeFollowOff: string;
	noticeOpenedVertical: (name: string) => string;
	noticeOpenedHorizontal: (name: string) => string;
	noticeOpenFailed: (error: string) => string;
	errorPaneNotLoaded: (name: string) => string;
	/** 对照稿选择器。Comparison-note picker. */
	pickerPlaceholder: string;
	/** 全文差异的动作按钮。Action buttons of the full diff. */
	keepTop: string;
	keepBottom: string;
	keepAll: string;
	discardAll: string;
	keepVersionOf: (name: string) => string;
	deleteBlock: string;
	/** 全文差异视图。Full-diff view. */
	viewDisplayName: string;
	viewDisplayNamePair: (name1: string, name2: string) => string;
	limitLines: (name: string, lines: number) => string;
	limitCharacters: (name: string, characters: number) => string;
	limitDiffBudget: (edits: number, milliseconds: number) => string;
	readError: (error: string) => string;
	/** 侧边对照面板。Side-by-side comparison panel. */
	panelDisplayName: string;
	differenceCount: (count: number) => string;
	followToggleTitle: string;
	followOn: string;
	followOff: string;
	panelHint: string;
	panelLineLimit: (lines: number) => string;
	panelUpdateFailed: (error: string) => string;
	panelRemovedLines: (count: number) => string;
	panelRemovedBlock: string;
	/** 确认弹窗。Confirmation modals. */
	riskyTitle: string;
	riskyBody: string;
	riskyAccept: string;
	deleteTitle: (name: string) => string;
	deleteBody: (keptName: string, removedName: string) => string;
	deleteButton: string;
	cancel: string;
	/** 全文差异视图的移动标注。Full-diff move badges. */
	movedOutLabel: (line: number) => string;
	movedInLabel: (line: number) => string;
}

const LANGUAGE_OVERRIDE_KEY = 'bigao-language';
const OBSIDIAN_LANGUAGE_KEY = 'language';

function readStoredLanguage(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

/**
 * 简体中文保持默认，已安装的中文环境不受影响；
 * 英文环境跟随 Obsidian 的界面语言。可用 localStorage
 * 的 bigao-language 显式指定 en 或 zh-CN。
 */
export function getLanguage(): Language {
	const override = readStoredLanguage(LANGUAGE_OVERRIDE_KEY);
	if (override === 'en' || override === 'zh-CN') return override;
	if (readStoredLanguage(OBSIDIAN_LANGUAGE_KEY) === 'en') return 'en';
	return 'zh-CN';
}

export function getStrings(): Strings {
	return getLanguage() === 'en' ? EN : ZH_CN;
}
