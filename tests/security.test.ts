import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as asar from '@electron/asar';
import { afterEach, expect, test } from 'vitest';
import { fixture } from './helpers.js';
import { inventory } from '../src/target.js';
import { Store } from '../src/store.js';
import { scanTarget } from '../src/scan.js';
import { applyPlan, preparePlan } from '../src/harden.js';
import { sanitizeData } from '../src/util.js';
import { scanMarkdown, writeReport } from '../src/report.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map(fn => fn())); });

test('symlink contents are not inspected and symlink targets cannot be rebuilt', async () => {
  const f = await fixture({ 'main.js': 'module.exports = 1;\n//# sourceMappingURL=a.map' }); cleanups.push(f.cleanup);
  const outside = path.join(f.root, 'outside'); await mkdir(outside);
  await writeFile(path.join(outside, 'secret.pem'), '-----BEGIN PRIVATE KEY-----\nprivate\n-----END PRIVATE KEY-----');
  await symlink(outside, path.join(f.input, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const store = new Store(f.store);
  const scan = await scanTarget(store, f.input, { rea: false });
  expect(scan.record.findings.some(f => f.rule === 'PRIVATE_KEY')).toBe(false);
  expect(scan.record.coverage).toBe('partial');
  await expect(preparePlan(store, scan.id, { output: path.join(f.root, 'output') })).rejects.toThrow('符号链接');
});

test('unmodeled unpacked files cannot disappear unnoticed during ASAR reconstruction', async () => {
  const f = await fixture({ 'main.js': 'module.exports = 1;' }); cleanups.push(f.cleanup);
  const archive = path.join(f.root, 'app.asar');
  await asar.createPackage(f.input, archive);
  await mkdir(`${archive}.unpacked`);
  await writeFile(path.join(`${archive}.unpacked`, 'extra.env'), 'SECRET=example');
  await expect(inventory(archive)).rejects.toThrow('未被 ASAR 头记录');
});

test('corrupt archive headers fail with a bounded diagnostic', async () => {
  const f = await fixture(); cleanups.push(f.cleanup);
  const archive = path.join(f.root, 'corrupt.asar');
  const bytes = Buffer.alloc(8); bytes.writeUInt32LE(2 ** 31, 4); await writeFile(archive, bytes);
  await expect(inventory(archive)).rejects.toThrow('ASAR 头');
});

test('re-entrant text cannot change JSON or execute in offline reports', async () => {
  const f = await fixture({ 'main.js': 'const checkLicense = () => true;' }); cleanups.push(f.cleanup);
  const store = new Store(f.store);
  const scan = await scanTarget(store, f.input, { rea: false });
  scan.record.findings[0]!.evidence = '<script>fetch("https://untrusted.test")</script>\u001b[2J';
  const report = await writeReport(store, scan.id, scanMarkdown(scan.record), 'Security test');
  const html = await readFile(report.html, 'utf8');
  expect(html).not.toContain('<script>'); expect(html).toContain('&lt;');
  const data = { text: '-----BEGIN PRIVATE KEY-----\nsecret', next: { valid: true } };
  const cleaned = JSON.parse(JSON.stringify(sanitizeData(data)));
  expect(cleaned.next.valid).toBe(true); expect(cleaned.text).not.toContain('secret');
});

test('failed validation is retained and marked rather than silently succeeding', async () => {
  const f = await fixture({ 'main.js': 'module.exports = 1;\n//# sourceMappingURL=a.map' }); cleanups.push(f.cleanup);
  const store = new Store(f.store);
  const scan = await scanTarget(store, f.input, { rea: false });
  const plan = await preparePlan(store, scan.id, { output: path.join(f.root, 'output'), commands: [{ executable: process.execPath, args: ['-e', 'process.exit(2)'], timeoutMs: 2000 }] });
  const applied = await applyPlan(store, plan.id, async () => 'terminal', { rea: false });
  expect(applied.record.checks.some(c => c.status === 'failed')).toBe(true);
  expect(applied.record.validationStatus).toBe('failed');
  expect(await readFile(path.join(plan.record.outputPath, 'VALIDATION_FAILED'), 'utf8')).toContain('验证失败');
});

test('validation timeouts terminate owned processes and remain failures', async () => {
  const f = await fixture({ 'main.js': 'module.exports = 1;\n//# sourceMappingURL=a.map' }); cleanups.push(f.cleanup);
  const store = new Store(f.store);
  const scan = await scanTarget(store, f.input, { rea: false });
  const plan = await preparePlan(store, scan.id, { output: path.join(f.root, 'output'), commands: [{ executable: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 100 }] });
  const result = await applyPlan(store, plan.id, async () => 'terminal', { rea: false });
  expect(result.record.checks.some(c => c.status === 'failed' && c.details.includes('timeout=true'))).toBe(true);
});
