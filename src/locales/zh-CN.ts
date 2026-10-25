import type { Strings } from '../i18n.ts';

/** 简体中文是本插件的原始界面语言；迁移到 i18n 时逐条保留了原文案。 */
export const ZH_CN: Strings = {
	commandPanelVertical: '比稿：开启左右分屏对照',
	commandPanelHorizontal: '比稿：开启上下分屏对照',
	commandPanelOff: '比稿：关闭分屏对照',
	commandCompare: '比稿：对比两篇',
	commandCompareAndMerge: '比稿：对比并合并',
	commandFindSyncConflicts: '比稿：查找同步冲突并合并',

	noticePanelClosed: '比稿：分屏对照已关闭',
	noticeNoComparisonPanes: '比稿：没有由比稿创建的分屏对照窗格',
	noticeNoOtherNotes: '库里没有其他笔记可作为对照',
	noticeOpenEditorFirst: '比稿：请先在笔记编辑窗格中打开一篇稿子',
	noticeFollowOn: '比稿：面板将跟随光标',
	noticeFollowOff: '比稿：面板已停止跟随',
	noticeOpenedVertical: (name) => `比稿：已在左右分屏中打开「${name}」`,
	noticeOpenedHorizontal: (name) => `比稿：已在上下分屏中打开「${name}」`,
	noticeOpenFailed: (error) => `比稿：打开分屏对照失败 —— ${error}`,
	errorPaneNotLoaded: (name) => `「${name}」没有载入分屏窗格`,

	pickerPlaceholder: '选择一篇作为对照稿…（可输入名称或路径筛选）',

	keepTop: '采用上方',
	keepBottom: '采用下方',
	keepAll: '全部采用',
	discardAll: '全部放弃',
	keepVersionOf: (name) => `采用「${name}」的版本`,
	deleteBlock: '删除这段',

	viewDisplayName: '比稿',
	viewDisplayNamePair: (name1, name2) => `比稿：${name1} ↔ ${name2}`,
	limitLines: (name, lines) =>
		`「${name}」超过 ${lines.toLocaleString()} 行，全文差异视图暂不计算。可缩短稿件，或使用原生分屏阅读。`,
	limitCharacters: (name, characters) =>
		`「${name}」超过 ${characters.toLocaleString()} 个字符，全文差异视图暂不计算。可缩短稿件，或使用原生分屏阅读。`,
	limitDiffBudget: (edits, milliseconds) =>
		`两篇稿件的差异规模超过安全计算上限（${edits.toLocaleString()} 次编辑或 ${milliseconds} 毫秒）。可使用原生分屏继续阅读。`,
	readError: (error) => `读取或计算差异失败：${error}`,

	panelDisplayName: '比稿：对照差异',
	differenceCount: (count) => `${count} 处差异`,
	followToggleTitle: '切换是否跟随原稿光标',
	followOn: '跟随中',
	followOff: '不跟随',
	panelHint: '用「比稿：开启左右分屏对照」选择一篇对照稿。',
	panelLineLimit: (lines) => `任一篇笔记超过 ${lines} 行，分屏对照暂不计算。`,
	panelUpdateFailed: (error) => `更新失败：${error}`,
	panelRemovedLines: (count) => `− 对照稿多 ${count} 行`,
	panelRemovedBlock: '− 对照稿有删减',

	riskyTitle: '确定要承担此风险吗？',
	riskyBody: '合并操作会不可逆地修改文件。请谨慎继续，仅在你已了解并接受相关风险时执行。',
	riskyAccept: '接受风险',
	deleteTitle: (name) => `删除「${name}」？`,
	deleteBody: (keptName, removedName) =>
		`「${keptName}」与「${removedName}」的内容完全相同。` +
		`要删除这个重复文件吗？文件会移入系统回收站。`,
	deleteButton: '删除',
	cancel: '取消',
	movedOutLabel: (line) => `↔ 移至对照稿第 ${line} 行`,
	movedInLabel: (line) => `↔ 自原稿第 ${line} 行移入`,
};
