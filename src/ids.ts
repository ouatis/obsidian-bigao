/**
 * Global identifiers (command ids, view types, localStorage keys) are derived
 * from the manifest id so that a second copy of the plugin can be installed
 * side by side. The installed copy keeps its historical `bigao-` prefix
 * because its manifest id is `bigao`.
 */
const DEFAULT_PLUGIN_ID = 'bigao';

let prefix = `${DEFAULT_PLUGIN_ID}-`;

/** Must be called at the start of `onload`; Obsidian sets `manifest` before it. */
export function configurePluginId(pluginId?: string | null): void {
	const id = pluginId?.trim();
	prefix = `${id ? id : DEFAULT_PLUGIN_ID}-`;
}

/** Widen a stable identifier to the plugin's global namespace. */
export function namespacedId(name: string): string {
	return `${prefix}${name}`;
}
