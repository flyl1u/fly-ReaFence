import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as asar from '@electron/asar';
import { afterEach, expect, test } from 'vitest';
import { fixture } from './helpers.js';
import { Store } from '../src/store.js';
import { scanTarget } from '../src/scan.js';
import { preparePlan, applyPlan, verifyApplied, type HumanApprover } from '../src/harden.js';
import { inventory } from '../src/target.js';
import { exists } from '../src/util.js';
import { compareScans } from '../src/compare.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map(fn => fn())); });
const confirm: HumanApprover = async () => 'terminal';
const files = { 'package.json': '{"type":"module"}', 'calc.js': 'export function total(price, count) { return price * count + 7; }\n//# sourceMappingURL=calc.js.map', 'calc.js.map': JSON.stringify({ version: 3, sources: ['calc.ts'], sourcesContent: ['original source'], mappings: '' }) };

async function setup() {
  const f = await fixture(files); cleanups.push(f.cleanup);
  const store = new Store(f.store);
  const scan = await scanTarget(store, f.input, { rea: false });
  return { ...f, store, scan };
}

test('declining never creates output or modifies input', async () => {
  const f = await setup();
  const output = path.join(f.root, 'hardened');
  const plan = await preparePlan(f.store, f.scan.id, { output });
  await expect(applyPlan(f.store, plan.id, async () => undefined, { rea: false })).rejects.toThrow('未同意');
  expect(await exists(output)).toBe(false);
  expect((await inventory(f.input)).sha256).toBe(f.scan.record.target.sha256);
});

test('approval is invalid when files change while the human reviews', async () => {
  const f = await setup(); const output = path.join(f.root, 'hardened');
  const plan = await preparePlan(f.store, f.scan.id, { output });
  await expect(applyPlan(f.store, plan.id, async () => { await writeFile(path.join(f.input, 'calc.js'), 'changed'); return 'terminal'; }, { rea: false })).rejects.toThrow('输入已变化');
  expect(await exists(output)).toBe(false);
});

test('approved cleanup and obfuscation preserve exports and behavior in a separate copy', async () => {
  const f = await setup();
  const plan = await preparePlan(f.store, f.scan.id, { output: path.join(f.root, 'hardened'), obfuscate: ['calc.js'] });
  const result = await applyPlan(f.store, plan.id, confirm, { rea: false });
  const output = result.record.outputPath;
  expect(await exists(path.join(output, 'calc.js.map'))).toBe(false);
  expect(await readFile(path.join(output, 'calc.js'), 'utf8')).not.toContain('sourceMappingURL');
  const module = await import(/* @vite-ignore */ pathToFileURL(path.join(output, 'calc.js')).href);
  expect(module.total(3, 5)).toBe(22);
  expect(module.total(-2, 0)).toBe(7);
  expect((await inventory(f.input)).sha256).toBe(f.scan.record.target.sha256);
  expect(result.record.checks.some(c => c.status === 'not-run')).toBe(true);
  expect(await readFile(result.reports.markdown, 'utf8')).toContain('功能验证：not-run');
  expect(await exists(path.join(plan.record.outputPath, 'INCOMPLETE'))).toBe(false);
  const comparison = await compareScans(f.store, f.scan.id, result.record.afterScanId!);
  expect(comparison.record.resolved.some(f => f.rule === 'SOURCE_MAP')).toBe(true);
  expect(comparison.record.coverage).toBe('partial');
  await expect(applyPlan(f.store, plan.id, confirm, { rea: false })).rejects.toThrow('输出');
});

test('ASAR rebuilding preserves unpacked placement and executable flags', async () => {
  const f = await setup();
  await writeFile(path.join(f.input, 'addon.node'), Buffer.from([0, 1, 2, 3]));
  const input = path.join(f.root, 'input.asar');
  await asar.createPackageWithOptions(f.input, input, { unpack: '**/*.node' });
  const before = await inventory(input);
  const scan = await scanTarget(f.store, input, { rea: false });
  const plan = await preparePlan(f.store, scan.id, { output: path.join(f.root, 'hardened') });
  const result = await applyPlan(f.store, plan.id, confirm, { rea: false });
  const after = await inventory(result.record.outputPath);
  expect(after.files.find(f => f.path === 'addon.node')?.unpacked).toBe(true);
  expect(after.files.find(f => f.path === 'addon.node')?.sha256).toBe(before.files.find(f => f.path === 'addon.node')?.sha256);
  expect((await stat(`${result.record.outputPath}.unpacked/addon.node`)).size).toBe(4);
  expect(result.record.requiresRepackaging).toBe(true);
});

test('runtime validation needs fresh approval and binds the output digest', async () => {
  const f = await setup();
  const plan = await preparePlan(f.store, f.scan.id, { output: path.join(f.root, 'hardened'), commands: [{ executable: process.execPath, args: ['--input-type=module', '-e', 'const {total} = await import("./calc.js"); if(total(2,3)!==13) process.exit(1);'], timeoutMs: 5000 }] });
  const applied = await applyPlan(f.store, plan.id, confirm, { rea: false });
  expect(applied.record.checks.find(c => c.name === 'command-1')?.status).toBe('passed');
  await expect(verifyApplied(f.store, applied.id, async () => undefined)).rejects.toThrow('未同意');
  const verified = await verifyApplied(f.store, applied.id, confirm);
  expect(verified.record.checks.every(c => c.status === 'passed')).toBe(true);
  await writeFile(path.join(applied.record.outputPath, 'calc.js'), 'changed');
  await expect(verifyApplied(f.store, applied.id, confirm)).rejects.toThrow('已变化');
});

test('partial parsing cannot be reported as a protection improvement', async () => {
  const f = await setup();
  await writeFile(path.join(f.input, 'calc.js'), 'const = invalid');
  const after = await scanTarget(f.store, f.input, { rea: false });
  const compare = await compareScans(f.store, f.scan.id, after.id);
  expect(compare.record.resolved).toHaveLength(0);
  expect(compare.record.coverage).toBe('partial');
});

test('invalid selections and external integrity bindings require correction', async () => {
  const f = await setup();
  await expect(preparePlan(f.store, f.scan.id, { output: path.join(f.root, 'a'), obfuscate: ['../calc.js'] })).rejects.toThrow();
  await expect(preparePlan(f.store, f.scan.id, { output: path.join(f.root, 'a'), obfuscate: ['preload.js'] })).rejects.toThrow();
  await writeFile(path.join(f.input, 'index.html'), '<script src="calc.js" integrity="sha256-abc"></script>');
  const fresh = await scanTarget(f.store, f.input, { rea: false });
  await expect(preparePlan(f.store, fresh.id, { output: path.join(f.root, 'a') })).rejects.toThrow('SRI');
});
