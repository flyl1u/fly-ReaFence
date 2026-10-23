import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as asar from '@electron/asar';
import { Store } from '../dist/store.js';
import { scanTarget } from '../dist/scan.js';
import { preparePlan, applyPlan } from '../dist/harden.js';
import { inventory } from '../dist/target.js';

const require = createRequire(import.meta.url);
let electron;
try { electron = require('electron'); }
catch { throw new Error('Electron 测试需要开发依赖的运行时。请先运行 node node_modules/electron/install.js。'); }
const root = await mkdtemp(path.join(os.tmpdir(), 'defencerea-electron-'));
const example = fileURLToPath(new URL('../examples/electron-app', import.meta.url));
async function run(payload, label) {
  await new Promise((resolve, reject) => {
    const env = { ...process.env, DEFENCEREA_ELECTRON_DATA: path.join(root, `profile-${label}`) };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [payload], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let error = '';
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.stderr.on('data', chunk => { error = (error + chunk.toString()).slice(-2000); });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Electron test timed out')); }, 30_000);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); if (code === 0 && output.includes('DEFENCEREA_ELECTRON_OK:22')) resolve(); else reject(new Error(`Electron failed (${code}): ${error}`)); });
  });
}
try {
  const before = await inventory(example);
  await run(example, 'original');
  const store = new Store(path.join(root, 'records'));
  for (const format of ['directory', 'asar']) {
    const input = format === 'asar' ? path.join(root, 'input.asar') : example;
    if (format === 'asar') await asar.createPackage(example, input);
    const scan = await scanTarget(store, input, { rea: false });
    const plan = await preparePlan(store, scan.id, { output: path.join(root, `hardened-${format}`), obfuscate: ['calc.cjs'] });
    // Simulated approval is confined to this automated test and this repository's own fixture.
    const applied = await applyPlan(store, plan.id, async () => 'terminal', { rea: false });
    await run(applied.record.outputPath, format);
    console.log(JSON.stringify({ format, electron: process.platform, preload: 'passed', contextBridge: 'passed', ipc: 'passed', result: 22 }));
  }
  assert.equal((await inventory(example)).sha256, before.sha256);
} finally { await rm(root, { recursive: true, force: true }); }
