type StorageReader = (key: string) => string | null;
type StorageWriter = (key: string, value: string) => void;

interface StoragePair {
	read: StorageReader;
	write: StorageWriter;
}

// The active pair lives on globalThis so every copy of this module (the
// installed bundle and a freshly built one, as exercised by the parity
// tests) shares one configuration once the plugin wires it.
const globalScope = globalThis as typeof globalThis & {
	__bigaoStorage?: StoragePair;
};

/**
 * App-scoped key/value storage. The plugin wires the Obsidian-backed
 * implementation during onload; module-level consumers (palette, language,
 * tokenizer settings) read through these accessors. Before onload — and in
 * Node test sandboxes — reads return null and writes are dropped, so the
 * defaults apply everywhere.
 */
export function configureStorage(read: StorageReader, write: StorageWriter): void {
	globalScope.__bigaoStorage = { read, write };
}

export function storageGet(key: string): string | null {
	try {
		return globalScope.__bigaoStorage?.read(key) ?? null;
	} catch {
		return null;
	}
}

export function storageSet(key: string, value: string): void {
	try {
		globalScope.__bigaoStorage?.write(key, value);
	} catch {
		// Settings are advisory; comparison must still work without them.
	}
}
