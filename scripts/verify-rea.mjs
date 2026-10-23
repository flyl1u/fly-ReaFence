import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanTarget } from '../dist/scan.js';
import { Store } from '../dist/store.js';

const root = await mkdtemp(path.join(os.tmpdir(), 'reafence-real-rea-'));
try {
  const input = path.join(root, 'input');
  await mkdir(input);
  await writeFile(path.join(input, 'package.json'), JSON.stringify({ name: 'reafence-owned-fixture', main: 'main.cjs' }));
  await writeFile(path.join(input, 'main.cjs'), `const {ipcMain} = require('electron'); ipcMain.handle('price', () => 42);\n//# sourceMappingURL=main.cjs.map`);
  await writeFile(path.join(input, 'main.cjs.map'), JSON.stringify({ version: 3, sources: ['original.ts'], sourcesContent: ['const price = 42'], mappings: '' }));
  const result = await scanTarget(new Store(path.join(root, 'store')), input);
  assert.ok(['complete', 'partial'].includes(result.record.rea.status), JSON.stringify(result.record.rea));
  assert.ok(result.record.rea.evidenceSha256);
  assert.ok(result.record.findings.some(f => f.rule === 'SOURCE_MAP'));
  console.log(JSON.stringify({ status: result.record.rea.status, coverage: result.record.rea.coverage, summary: result.record.rea.summary, evidenceSaved: true }));
} finally { await rm(root, { recursive: true, force: true }); }
