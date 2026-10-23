import { mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { z } from 'zod';
import { Store } from '../src/store.js';
import { safeRelative, ensureOutside } from '../src/util.js';

const temps: string[] = [];
afterEach(async () => { await Promise.all(temps.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function temp() { const p = await realpath(await mkdtemp(path.join(os.tmpdir(), 'reafence-'))); temps.push(p); return p; }

test('content-addressed records reject tampering', async () => {
  const store = new Store(await temp());
  const schema = z.object({ kind: z.literal('scan'), value: z.string() }).strict();
  const id = await store.save(schema, { kind: 'scan', value: 'original' });
  expect((await store.read(id, schema)).value).toBe('original');
  const file = path.join(store.directory(id), 'record.json');
  await writeFile(file, (await readFile(file, 'utf8')).replace('original', 'tampered'));
  await expect(store.read(id, schema)).rejects.toThrow('摘要不匹配');
});

test.each(['../escape', '/absolute', 'C:/escape', 'x/../../escape', 'a\\..\\b', 'NUL.txt', 'a:stream', 'a.'])('rejects unsafe paths %s', input => {
  expect(() => safeRelative(input)).toThrow();
});

test('work and output locations cannot overlap targets', async () => {
  const root = await temp();
  const target = { inputPath: root, requestedPath: root };
  await expect(ensureOutside(target, path.join(root, 'reports'))).rejects.toThrow('分离');
  await expect(ensureOutside(target, path.dirname(root))).rejects.toThrow('分离');
  expect(await ensureOutside(target, `${root}-output`)).toBe(`${root}-output`);
});
