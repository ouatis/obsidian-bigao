type StorageReader = (key: string) => string | null;

// The active reader lives on globalThis so every copy of this module (the
// installed bundle and a freshly built one, as exercised by the parity
// tests) shares one configuration once the plugin wires it.
const globalScope = globalThis as typeof globalThis & {
	__bigaoStorage?: StorageReader;
};

/**
 * App-scoped key/value reads. The plugin wires the Obsidian-backed
 * implementation during onload; module-level consumers (palette, language,
 * tokenizer settings) read through storageGet. Before onload — and in Node
 * test sandboxes — reads return null, so the defaults apply everywhere.
 * Writes bypass this module: preference writes go through the same
 * Obsidian API directly at their call sites.
 */
export function configureStorage(read: StorageReader): void {
	globalScope.__bigaoStorage = read;
}

export function storageGet(key: string): string | null {
	try {
		return globalScope.__bigaoStorage?.(key) ?? null;
	} catch {
		return null;
	}
}
