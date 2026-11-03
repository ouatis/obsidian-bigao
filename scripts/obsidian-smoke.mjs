import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const executable = process.env.BIGAO_OBSIDIAN_EXE;
const coreAsar = process.env.BIGAO_OBSIDIAN_ASAR;
if (!executable || !coreAsar) throw new Error('Set BIGAO_OBSIDIAN_EXE and BIGAO_OBSIDIAN_ASAR to the installed Obsidian executable and application .asar.');
if (process.platform !== 'win32') throw new Error('This isolated desktop harness currently supports Windows only.');
const temporary = await mkdtemp(join(tmpdir(), 'bigao-smoke-'));
const profile = join(temporary, 'profile');
await mkdir(profile);
const coreName = /obsidian-[\d.]+\.asar$/.exec(coreAsar)?.[0];
if (!coreName) throw new Error('Use a versioned obsidian-<version>.asar from the installed application profile.');
await copyFile(coreAsar, join(profile, coreName));

const before = {};
for (const name of ['main.js', 'inline-diff-runtime-v9.js', 'styles.css']) {
	before[name] = createHash('sha256').update(await readFile(join(root, name))).digest('hex');
}
const notes = {
	'original.md': '# 对照测试\n\n我喜欢春天的花园。\n\n我们沿着河岸散步。\n\n原稿独有的一段。\n',
	'revised.md': '# 对照测试\n\n我喜欢秋天的花园。\n\n我们沿着河岸慢慢散步。\n\n改稿独有的一段。\n',
};
const vaults = {};
for (const kind of ['baseline', 'candidate']) {
	const vault = join(temporary, kind);
	const plugin = join(vault, '.obsidian', 'plugins', 'bigao');
	await mkdir(plugin, { recursive: true });
	for (const [name, text] of Object.entries(notes)) await writeFile(join(vault, name), text);
	for (const name of ['manifest.json', 'styles.css', 'main.js']) {
		await copyFile(join(root, kind === 'candidate' ? 'dist/candidate' : '', name), join(plugin, name));
	}
	if (kind === 'baseline') await copyFile(join(root, 'inline-diff-runtime-v9.js'), join(plugin, 'inline-diff-runtime-v9.js'));
	await writeFile(join(vault, '.obsidian', 'community-plugins.json'), JSON.stringify(['bigao']));
	await writeFile(join(vault, '.obsidian', 'app.json'), JSON.stringify({ showInlineTitle: false, defaultViewMode: 'source', livePreview: false }));
	vaults[kind === 'baseline' ? 'baa0000000000001' : 'baa0000000000002'] = { path: vault, ts: Date.now(), open: true };
}
await writeFile(join(profile, 'obsidian.json'), JSON.stringify({ vaults, cli: false, updateDisabled: true }));
console.log(`Isolated fixtures and profile: ${temporary}`);
const child = execFileSync('powershell.exe', ['-NoProfile', '-Command',
	'$testProcess = Start-Process -FilePath $env:BIGAO_OBSIDIAN_EXE -ArgumentList @(("--user-data-dir=" + $env:BIGAO_TEST_PROFILE), "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1", "--disable-renderer-backgrounding") -WindowStyle Hidden -PassThru; $testProcess.Id',
], { env: { ...process.env, BIGAO_TEST_PROFILE: profile }, encoding: 'utf8' }).trim();
console.log(`Isolated Obsidian process: ${child}`);

const delay = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));
async function until(action, label, timeout = 30000) {
	const end = Date.now() + timeout;
	let failure;
	while (Date.now() < end) {
		try { const value = await action(); if (value) return value; } catch (error) { failure = error; }
		await delay(250);
	}
	throw new Error(`Timed out: ${label}${failure ? ` (${failure.message})` : ''}`);
}
async function connect(url) {
	const socket = new WebSocket(url);
	await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', reject, { once: true }); });
	let serial = 0;
	const pending = new Map();
	socket.addEventListener('message', ({ data }) => {
		const message = JSON.parse(String(data));
		const request = pending.get(message.id);
		if (!request) return;
		pending.delete(message.id);
		clearTimeout(request.timer);
		if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
	});
	socket.addEventListener('close', () => {
		for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('CDP connection closed')); }
		pending.clear();
	});
	return {
		close: () => socket.close(),
		call(method, params = {}) {
			const id = ++serial;
			return new Promise((done, reject) => {
				const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)); }, 10000);
				pending.set(id, { resolve: done, reject, timer });
				socket.send(JSON.stringify({ id, method, params }));
			});
		},
	};
}
const port = await until(async () => Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]), 'isolated debug port');
const endpoint = `http://127.0.0.1:${port}`;
const browserInfo = await (await fetch(`${endpoint}/json/version`)).json();
const browser = await connect(browserInfo.webSocketDebuggerUrl);
const report = { application: coreName, checks: [], installedFilesUnchanged: false };
const clients = [];
try {
	await until(async () => {
		const pages = await (await fetch(`${endpoint}/json/list`)).json();
		for (const page of pages.filter((page) => page.type === 'page' && page.webSocketDebuggerUrl)) {
			if (clients.some((client) => client.id === page.id)) continue;
			const cdp = await connect(page.webSocketDebuggerUrl);
			const evaluate = async (expression) => {
				const result = await cdp.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
				if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + result.exceptionDetails.exception?.description);
				return result.result?.value;
			};
			const path = await evaluate('typeof app !== "undefined" ? app.vault.adapter.getBasePath() : null');
			const kind = Object.keys(vaults).map((key) => vaults[key].path).find((vault) => resolve(vault) === resolve(path || '.'));
			if (!kind) { cdp.close(); continue; }
			clients.push({ id: page.id, kind: kind.endsWith('candidate') ? 'candidate' : 'baseline', cdp, evaluate });
		}
		return clients.length === 2;
	}, 'both synthetic vaults');
	for (const client of clients) {
		const { evaluate, cdp, kind } = client;
		console.log(`Checking ${kind}: enabling the plugin in the synthetic vault only`);
		await cdp.call('Page.bringToFront');
		await until(() => evaluate('!!app.plugins.manifests.bigao'), `${kind} manifest loaded`);
		await evaluate(`(async()=>{
			window.__bigaoSmokeErrors=[];
			window.addEventListener('error',e=>window.__bigaoSmokeErrors.push(e.message));
			window.addEventListener('unhandledrejection',e=>window.__bigaoSmokeErrors.push(String(e.reason)));
			await app.plugins.setEnable(true);
		})()`);
		await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
		await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
		await until(() => evaluate(`!document.querySelector('.modal-container')`), `${kind} synthetic vault trust prompt dismissed`, 10000);
		await until(() => evaluate('!!app.plugins.plugins.bigao'), `${kind} plugin loaded`);
		await until(() => evaluate('app.workspace.layoutReady === true'), `${kind} workspace layout ready`);
		await until(() => evaluate(`app.vault.getMarkdownFiles().length===2`), `${kind} synthetic notes indexed`);
		const setup = await evaluate(`(async()=>{
			const original=app.vault.getAbstractFileByPath('original.md');
			const leaf=app.workspace.getLeaf(true);await leaf.openFile(original,{active:true});
			window.__bigaoSmokeSource=leaf;
			return Object.keys(app.commands.commands).filter(id=>id.startsWith('bigao:'));
		})()`);
		assert.equal(setup.length, 6);
		for (const [command, direction] of [['bigao-panel-on', 'vertical'], ['bigao-panel-on-horizontal', 'horizontal']]) {
			console.log(`Checking ${kind}: ${direction} split, live refresh and plugin reload`);
			console.log(await evaluate(`(()=>{app.workspace.setActiveLeaf(window.__bigaoSmokeSource,{focus:true});return {executed:app.commands.executeCommandById('bigao:${command}'),notes:app.vault.getMarkdownFiles().map(f=>f.path)}})()`));
			await until(() => evaluate(`(()=>{const input=document.querySelector('.prompt-input');if(!input)return false;input.value='revised.md';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();return !!document.querySelector('.suggestion-item.is-selected')})()`), `${kind} picker`);
			await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
			await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
			const pair = await until(() => evaluate(`(()=>{const pair=[...(window.__bigaoSplitComparisonsV1||new Map())][0];if(!pair)return null;const [right,c]=pair;const panes=[c.sourceLeaf,right].map(l=>{const r=l.view.editor.cm.scrollDOM.getBoundingClientRect();return {path:l.view.file.path,x:r.x,y:r.y,width:r.width,height:r.height,highlights:l.view.containerEl.querySelectorAll('.bigao-inline-add').length}});return panes.every(p=>p.highlights>0)?{direction:c.direction,panes}:null})()`), `${kind} ${direction} comparison`);
			assert.equal(pair.direction, direction);
			assert.ok(pair.panes.every((pane) => pane.highlights > 0), JSON.stringify(pair));
			assert.ok(direction === 'vertical' ? pair.panes[0].x < pair.panes[1].x : pair.panes[0].y < pair.panes[1].y);
			report.checks.push({ kind, direction, ...pair });
			const sourceCount = pair.panes[0].highlights;
			await evaluate(`window.__bigaoSmokeOriginal=window.__bigaoSmokeSource.view.editor.getValue();window.__bigaoSmokeSource.view.editor.setValue(window.__bigaoSmokeOriginal.replace('春天','秋天'))`);
			await until(() => evaluate(`window.__bigaoSmokeSource.view.containerEl.querySelectorAll('.bigao-inline-add').length < ${sourceCount} && window.__bigaoSmokeSource.view.containerEl.querySelectorAll('.bigao-inline-add').length > 0`), `${kind} live edit refresh`);
			await evaluate(`window.__bigaoSmokeSource.view.editor.setValue(window.__bigaoSmokeOriginal)`);
			await until(() => evaluate(`window.__bigaoSmokeSource.view.containerEl.querySelectorAll('.bigao-inline-add').length === ${sourceCount}`), `${kind} restored highlights`);
			await evaluate(`(async()=>{await app.plugins.unloadPlugin('bigao');await app.plugins.loadPlugin('bigao')})()`);
			await until(() => evaluate(`window.__bigaoSplitComparisonsV1?.size===1 && window.__bigaoSmokeSource.view.containerEl.querySelectorAll('.bigao-inline-add').length===${sourceCount}`), `${kind} plugin reload keeps comparison`);
			await cdp.call('Page.bringToFront');
			await evaluate(`document.querySelectorAll('.notice-container').forEach(e=>e.style.display='none')`);
			await delay(150);
			const shot = await cdp.call('Page.captureScreenshot', { format: 'png' });
			await writeFile(join(root, 'dist', `smoke-${kind}-${direction}.png`), Buffer.from(shot.data, 'base64'));
			await evaluate(`app.commands.executeCommandById('bigao:bigao-panel-off')`);
		}
		console.log(`Checking ${kind}: full-diff view and cancelled merge warning`);
		await evaluate(`(async()=>{const plugin=app.plugins.plugins.bigao;await plugin.openDifferencesView({file1:app.vault.getAbstractFileByPath('original.md'),file2:app.vault.getAbstractFileByPath('revised.md'),showMergeOption:false})})()`);
		const fullDiff = await until(() => evaluate(`(()=>{const leaf=app.workspace.getLeavesOfType('bigao-differences-view')[0];if(!leaf)return null;const el=leaf.view.contentEl;const count=el.querySelectorAll('.difference').length;return count?{count,text:el.textContent,wordSpans:el.querySelectorAll('.file-diff_top-line__character,.file-diff_bottom-line__character').length}:null})()`), `${kind} full-diff rendered`);
		assert.ok(fullDiff.wordSpans > 0);
		report.checks.push({ kind, fullDiff });
		await evaluate(`app.workspace.getLeavesOfType('bigao-differences-view').forEach(l=>l.detach());app.workspace.setActiveLeaf(window.__bigaoSmokeSource,{focus:true});app.commands.executeCommandById('bigao:bigao-compare-and-merge')`);
		await until(() => evaluate(`!![...document.querySelectorAll('.modal-container')].find(e=>/接受风险|Accept Risk/.test(e.textContent))`), `${kind} merge risk warning`);
		await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
		await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
		assert.ok(await evaluate(`!localStorage.getItem('bigao-merge-warning') && !app.workspace.getLeavesOfType('bigao-differences-view').length`));
		const unsaved = await evaluate(`(async()=>{const leaf=window.__bigaoSmokeSource;const original=leaf.view.editor.getValue();leaf.view.editor.setValue(original.replace('春天','冬天'));await new Promise(r=>setTimeout(r,300));const value=leaf.view.editor.getValue();leaf.view.editor.setValue(original);return value.includes('冬天')})()`);
		assert.ok(unsaved);
		const editorState = await evaluate(`(()=>{const cm=window.__bigaoSmokeSource.view.editor.cm;const failures=[];app.workspace.editorExtensions.forEach((x,i)=>{try{cm.state.constructor.create({doc:'',extensions:[x]})}catch(e){failures.push({i,error:e.message})}});return {invalidExtensions:failures,errors:window.__bigaoSmokeErrors}})()`);
		assert.deepEqual(editorState.invalidExtensions, []);
		assert.deepEqual(editorState.errors, []);
		report.checks.push({ kind, editorState, editingWorks: true });
		for (const [name, text] of Object.entries(notes)) assert.equal(await readFile(join(temporary, kind, name), 'utf8'), text);
	}
	assert.deepEqual(report.checks.find(c=>c.kind==='candidate'&&c.fullDiff)?.fullDiff, report.checks.find(c=>c.kind==='baseline'&&c.fullDiff)?.fullDiff);
	for (const [name, hash] of Object.entries(before)) {
		assert.equal(createHash('sha256').update(await readFile(join(root, name))).digest('hex'), hash, `${name} changed during isolated test`);
	}
	report.installedFilesUnchanged = true;
	await writeFile(join(root, 'dist', 'obsidian-smoke-report.json'), JSON.stringify(report, null, 2) + '\n');
	console.log(JSON.stringify(report, null, 2));
} catch (error) {
	for (const { kind, cdp, evaluate } of clients) {
		console.log(kind, await evaluate(`({loaded:Object.keys(app.plugins.plugins),commands:Object.keys(app.commands.commands).filter(c=>c.startsWith('bigao:')),active:app.workspace.activeLeaf?.view?.getViewType(),leaves:app.workspace.getLeavesOfType('markdown').map(l=>l.view.file?.path),modals:[...document.querySelectorAll('.modal-container')].map(e=>e.textContent),errors:window.__bigaoSmokeErrors})`).catch(e=>e.message));
		const shot = await cdp.call('Page.captureScreenshot', { format: 'png' }).catch(()=>null);
		if (shot) await writeFile(join(root, 'dist', `smoke-${kind}-failure.png`), Buffer.from(shot.data, 'base64'));
	}
	throw error;
} finally {
	for (const client of clients) client.cdp.close();
	await browser.call('Browser.close').catch(() => {});
	browser.close();
}
