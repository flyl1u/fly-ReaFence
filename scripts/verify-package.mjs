import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const project = fileURLToPath(new URL('..', import.meta.url));
const npm = process.env.npm_execpath;
assert.ok(npm?.endsWith('.js'), 'Run this check with npm run test:package');
const root = await mkdtemp(path.join(os.tmpdir(), 'reafence-package-'));
try {
  const packed = JSON.parse((await run(process.execPath, [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', root], { cwd: project })).stdout)[0];
  assert.equal(packed.name, 'reafence');
  assert.ok(packed.files.some(f => f.path === 'bin/reafence.mjs'));
  assert.ok(packed.files.some(f => f.path === 'SECURITY.md'));
  assert.ok(packed.files.some(f => f.path === 'scripts/benchmark.mjs'));
  assert.ok(!packed.files.some(f => f.path.startsWith('.reafence/') || f.path.startsWith('node_modules/') || f.path.startsWith('.git/')));
  const install = path.join(root, 'installed');
  await mkdir(install);
  await writeFile(path.join(install, 'package.json'), '{"name":"reafence-install-test","version":"1.0.0","private":true}');
  await run(process.execPath, [npm, 'install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', path.join(root, packed.filename)], { cwd: install, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
  const cli = path.join(install, 'node_modules', 'reafence', 'bin', 'reafence.mjs');
  const fixture = path.join(install, 'node_modules', 'reafence', 'examples', 'electron-app');
  const doctor = JSON.parse((await run(process.execPath, [cli, 'doctor'], { cwd: install })).stdout);
  assert.equal(doctor.rea.available, true);
  assert.equal(doctor.name, 'reafence');
  const scan = JSON.parse((await run(process.execPath, [cli, '--store', path.join(root, 'store'), 'scan', fixture], { cwd: install, timeout: 180_000 })).stdout);
  assert.ok(scan.findings > 0);
  const record = JSON.parse(await readFile(path.join(path.dirname(scan.reports.html), 'record.json'), 'utf8'));
  assert.ok(['complete', 'partial'].includes(record.rea.status), JSON.stringify(record.rea));
  console.log(JSON.stringify({ package: packed.filename, bytes: packed.size, productionInstall: 'passed', cli: 'passed', realReaScan: record.rea.status, findings: scan.findings }));
} finally { await rm(root, { recursive: true, force: true }); }
