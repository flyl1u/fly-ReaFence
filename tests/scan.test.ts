import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import * as asar from '@electron/asar';
import { afterEach, expect, test } from 'vitest';
import { fixture } from './helpers.js';
import { Store } from '../src/store.js';
import { inventory, readEntry } from '../src/target.js';
import { scanTarget } from '../src/scan.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map(fn => fn())); });

test('static scan finds exposure, redacts credentials and never executes JS', async () => {
  const fake = 'ghp_' + 'x'.repeat(25);
  const f = await fixture({
    'main.cjs': `require('node:fs').writeFileSync('SHOULD_NOT_EXIST', 'executed'); throw new Error('not executed');\nconst apiKey = '${fake}'; const isPro = true; fetch('https://example.test/api?q=secret');\n//# sourceMappingURL=main.cjs.map`,
    'main.cjs.map': JSON.stringify({ version: 3, sources: ['main.ts'], sourcesContent: ['original implementation'], mappings: '' }),
    '.env': 'SERVICE_PASSWORD=privatevalue123456',
    'notes.txt': '<script>alert(1)</script>',
  }); cleanups.push(f.cleanup);
  const before = await inventory(f.input);
  const scan = await scanTarget(new Store(f.store), f.input, { rea: false });
  expect(scan.record.findings.map(x => x.rule)).toEqual(expect.arrayContaining(['SOURCE_MAP', 'SOURCE_MAP_REFERENCE', 'CREDENTIAL_CANDIDATE', 'LOCAL_AUTH_CANDIDATE', 'PACKAGED_ENV']));
  expect(scan.record.coverage).toBe('partial');
  expect((await inventory(f.input)).sha256).toBe(before.sha256);
  expect(JSON.stringify(scan.record)).not.toContain(fake);
  expect(await readFile(scan.reports.html, 'utf8')).not.toContain(fake);
  expect(await readFile(scan.reports.html, 'utf8')).toContain('<h2>代码包含源码映射引用</h2>');
});

test('malformed JavaScript remains unknown', async () => {
  const f = await fixture({ 'broken.js': 'const = invalid', 'src/file.ts': 'const x = 1' }); cleanups.push(f.cleanup);
  const scan = await scanTarget(new Store(f.store), f.input, { rea: false });
  expect(scan.record.limitations.join(' ')).toContain('语法分析失败');
  expect(scan.record.coverage).toBe('partial');
});

test('ASAR inventories bind packed and unpacked bytes without executing native modules', async () => {
  const f = await fixture({ 'main.js': 'export const value = 3;', 'native/addon.node': 'not a native binary' }); cleanups.push(f.cleanup);
  await mkdir(path.join(f.input, 'empty'));
  const archive = path.join(f.root, 'app.asar');
  await asar.createPackageWithOptions(f.input, archive, { unpack: '**/*.node' });
  const target = await inventory(archive);
  expect(target.files.find(x => x.path === 'native/addon.node')?.unpacked).toBe(true);
  expect((await readEntry(target, 'main.js')).toString()).toContain('value = 3');
  await writeFile(path.join(`${archive}.unpacked`, 'native/addon.node'), 'modified native bytes');
  await expect(inventory(archive)).rejects.toThrow('ASAR');
});

test('rejects report storage within a target', async () => {
  const f = await fixture({ 'main.js': '' }); cleanups.push(f.cleanup);
  await expect(scanTarget(new Store(path.join(f.input, '.reafence')), f.input, { rea: false })).rejects.toThrow('分离');
});
