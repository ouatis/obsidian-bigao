import { namespacedId } from '../ids.ts';
import { storageGet } from './app_storage.ts';

const palettes = ['scriptorium', 'classic', 'mono', 'ocean', 'forest'] as const;

export type Palette = (typeof palettes)[number];

function hostBody(): HTMLElement | null {
	return typeof activeDocument !== 'undefined' && activeDocument?.body
		? activeDocument.body
		: null;
}

export function applyPalette(): void {
	try {
		const body = hostBody();
		if (!body) return;
		const selected = storageGet(namespacedId('palette')) ?? undefined;
		const palette = palettes.includes(selected as Palette)
			? selected as Palette
			: 'scriptorium';
		body.setAttribute('data-bigao-palette', palette);
	} catch {
		// The theme attributes are optional; comparison must still work.
	}
}

export function clearPalette(): void {
	try {
		hostBody()?.removeAttribute?.('data-bigao-palette');
	} catch {
		// Unload cleanup is best-effort.
	}
}
