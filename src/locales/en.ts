import type { Strings } from '../i18n.ts';

export const EN: Strings = {
	commandPanelVertical: 'Collate: Start side-by-side comparison',
	commandPanelHorizontal: 'Collate: Start top-and-bottom comparison',
	commandPanelOff: 'Collate: Close side-by-side comparison',
	commandCompare: 'Collate: Compare two notes',
	commandCompareAndMerge: 'Collate: Compare and merge',
	commandFindSyncConflicts: 'Collate: Find sync conflicts and merge',

	noticePanelClosed: 'Collate: Side-by-side comparison closed',
	noticeNoComparisonPanes: 'Collate: No comparison panes to close',
	noticeNoOtherNotes: 'No other notes in this vault to compare against',
	noticeOpenEditorFirst: 'Collate: Open a note in the editor first',
	noticeFollowOn: 'Collate: The panel will follow the cursor',
	noticeFollowOff: 'Collate: The panel stopped following the cursor',
	noticeOpenedVertical: (name) => `Collate: Opened "${name}" in a side-by-side split`,
	noticeOpenedHorizontal: (name) => `Collate: Opened "${name}" in a top-and-bottom split`,
	noticeOpenFailed: (error) => `Collate: Failed to open the comparison — ${error}`,
	errorPaneNotLoaded: (name) => `"${name}" did not load into a split pane`,

	pickerPlaceholder: 'Pick a note to compare against… (type a name or path to filter)',

	keepTop: 'Keep top',
	keepBottom: 'Keep bottom',
	keepAll: 'Keep all',
	discardAll: 'Discard all',
	keepVersionOf: (name) => `Keep "${name}"'s version`,
	deleteBlock: 'Delete this block',

	viewDisplayName: 'Collate',
	viewDisplayNamePair: (name1, name2) => `Collate: ${name1} ↔ ${name2}`,
	limitLines: (name, lines) =>
		`"${name}" exceeds ${lines.toLocaleString()} lines, so the full-diff view skips it. Shorten the note, or read it in a native split.`,
	limitCharacters: (name, characters) =>
		`"${name}" exceeds ${characters.toLocaleString()} characters, so the full-diff view skips it. Shorten the note, or read it in a native split.`,
	limitDiffBudget: (edits, milliseconds) =>
		`The two notes differ beyond the safe computation budget (${edits.toLocaleString()} edits or ${milliseconds} ms). Use a native split to keep reading.`,
	readError: (error) => `Failed to read or compute the diff: ${error}`,

	panelDisplayName: 'Collate: Comparison differences',
	differenceCount: (count) => (count === 1 ? '1 difference' : `${count} differences`),
	followToggleTitle: 'Toggle following the source cursor',
	followOn: 'Following',
	followOff: 'Not following',
	panelHint:
		'Run "Collate: Start side-by-side comparison" to pick a note to compare against.',
	panelLineLimit: (lines) =>
		`Either note exceeds ${lines} lines, so the side-by-side comparison is skipped.`,
	panelUpdateFailed: (error) => `Update failed: ${error}`,
	panelRemovedLines: (count) => `− the other note has ${count} more lines`,
	panelRemovedBlock: '− trimmed in the other note',

	riskyTitle: 'Do you accept this risk?',
	riskyBody:
		'Merging changes files irreversibly. Continue only if you understand and accept the risks.',
	riskyAccept: 'I accept the risk',
	deleteTitle: (name) => `Delete "${name}"?`,
	deleteBody: (keptName, removedName) =>
		`"${keptName}" and "${removedName}" have identical content. ` +
		`Delete this duplicate? This cannot be undone.`,
	deleteButton: 'Delete',
	cancel: 'Cancel',
	movedOutLabel: (line) => `↔ moved to comparison line ${line}`,
	movedInLabel: (line) => `↔ moved in from source line ${line}`,
};
