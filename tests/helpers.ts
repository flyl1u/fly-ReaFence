import { mkdir, mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export async function fixture(files: Record<string, string> = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'defencerea-test-')));
  const input = path.join(root, 'input 中文');
  const store = path.join(root, 'records');
  await mkdir(input);
  for (const [relative, contents] of Object.entries(files)) {
    const full = path.join(input, relative);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, contents);
  }
  return { root, input, store, cleanup: () => rm(root, { recursive: true, force: true }) };
}
