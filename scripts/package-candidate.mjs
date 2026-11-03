import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const destination = join(root, 'dist', 'candidate');
await mkdir(destination, { recursive: true });
const hashes = {};
for (const [name, source] of [
	['main.js', 'dist/main.js'], ['manifest.json', 'manifest.json'], ['styles.css', 'styles.css'],
]) {
	const bytes = await readFile(join(root, source));
	await writeFile(join(destination, name), bytes);
	hashes[name] = createHash('sha256').update(bytes).digest('hex');
}
await writeFile(join(destination, 'build-info.json'), JSON.stringify({
	status: 'source-candidate-not-installed', files: hashes,
}, null, 2) + '\n');
console.log(JSON.stringify({ directory: destination, files: hashes }, null, 2));
