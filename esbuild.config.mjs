import { builtinModules } from 'node:module';
import process from 'node:process';
import esbuild from 'esbuild';

const production = process.argv[2] === 'production';
const context = await esbuild.context({
	entryPoints: ['src/main.ts'],
	bundle: true,
	external: ['obsidian', 'electron', ...builtinModules],
	format: 'cjs',
	target: 'es2022',
	logLevel: 'info',
	sourcemap: production ? false : 'inline',
	treeShaking: true,
	outfile: 'dist/main.js',
	minify: production,
});

if (production) {
	await context.rebuild();
	await context.dispose();
	await import('./esbuild.inline-diff.config.mjs');
} else {
	await context.watch();
}
