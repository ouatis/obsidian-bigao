import esbuild from 'esbuild';

await esbuild.build({
	entryPoints: ['src/inline_diff_runtime.ts'],
	bundle: true,
	external: ['obsidian'],
	format: 'cjs',
	target: 'es2022',
	minify: true,
	outfile: 'dist/inline-diff-runtime-v9.js',
});
