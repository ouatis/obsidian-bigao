/** Method to insert a line in a string */
export function insertLine(args: {
	fullText: string;
	newLine: string;
	position: number;
}): string {
	const lines = args.fullText.split('\n');
	lines.splice(args.position, 0, args.newLine);
	return lines.join('\n');
}

/** Method to replace a line in a string */
export function replaceLine(args: {
	fullText: string;
	newLine: string;
	position: number;
	linesToReplace: number;
}): string {
	const lines = args.fullText.split('\n');
	if (args.newLine === '') {
		lines.splice(args.position, args.linesToReplace);
	} else {
		lines.splice(args.position, args.linesToReplace, args.newLine);
	}
	return lines.join('\n');
}

/** Method to delete a line in a string */
export function deleteLines(args: {
	fullText: string;
	position: number;
	count: number;
}): string {
	const lines = args.fullText.split('\n');
	lines.splice(args.position, args.count);
	return lines.join('\n');
}

/**
 * Applies an accepted move in one splice pass: deletes `removedCount` lines at
 * `removedStart` and inserts `insertedLines` at `insertStart`, both positions
 * given in the original text's coordinates. One call means one write and one
 * undo step, and the two positions may sit in either order.
 */
export function applyMove(args: {
	fullText: string;
	removedStart: number;
	removedCount: number;
	insertStart: number;
	insertedLines: string[];
}): string {
	const lines = args.fullText.split('\n');
	if (args.removedStart < args.insertStart) {
		lines.splice(args.removedStart, args.removedCount);
		// Deleting first shifts the original insert position left; the clamp is
		// defensive, since diff hunks never overlap in file1 coordinates.
		const insertAt = Math.max(args.removedStart, args.insertStart - args.removedCount);
		lines.splice(insertAt, 0, ...args.insertedLines);
	} else {
		lines.splice(args.insertStart, 0, ...args.insertedLines);
		// Inserting first shifts the original removal position right.
		lines.splice(args.removedStart + args.insertedLines.length, args.removedCount);
	}
	return lines.join('\n');
}

/** Returns an invisible character when the text is empty. */
export function preventEmptyString(text: string): string {
	return text !== '' ? text : '‎';
}
