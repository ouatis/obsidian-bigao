import { namespacedId } from '../ids.ts';

const palettes = ['scriptorium', 'classic', 'mono', 'ocean', 'forest'] as const;

export type Palette = (typeof palettes)[number];

export function applyPalette(): void {
	try {
		if (!document.body) return;
		const selected = localStorage.getItem(namespacedId('palette'));
	const palette = palettes.includes(selected as Palette)
			? selected as Palette
			: 'scriptorium';
		document.body.setAttribute('data-bigao-palette', palette);
	} catch {
		// The theme attributes are optional; comparison must still work.
	}
}
