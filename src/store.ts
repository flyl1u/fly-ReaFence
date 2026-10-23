import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { canonical, hash } from './util.js';
import { fail, idSchema } from './model.js';

export class Store {
  readonly root: string;
  constructor(root = path.join(homedir(), '.reafence')) { this.root = path.resolve(root); }
  directory(id: string): string { return path.join(this.root, idSchema.parse(id)); }
  async save<T extends { kind: string }>(schema: z.ZodType<T>, value: T): Promise<string> {
    const parsed = schema.parse(value);
    const content = canonical(parsed);
    const id = idSchema.parse(`${parsed.kind}_${hash(content)}`);
    const directory = this.directory(id);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    try { await mkdir(directory, { mode: 0o700 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await this.read(id, schema);
      return id;
    }
    try { await writeFile(path.join(directory, 'record.json'), content, { flag: 'wx', mode: 0o600 }); }
    catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
    return id;
  }
  async read<T>(id: string, schema: z.ZodType<T>): Promise<T> {
    const content = await readFile(path.join(this.directory(id), 'record.json'), 'utf8');
    const value = JSON.parse(content) as unknown;
    if (id.split('_')[1] !== hash(canonical(value))) fail('RECORD_TAMPERED', '记录摘要不匹配；请重新生成体检或计划。');
    const parsed = schema.parse(value);
    if (typeof parsed === 'object' && parsed && 'kind' in parsed && !id.startsWith(`${parsed.kind}_`)) fail('RECORD_TYPE', '记录类型不匹配。');
    return parsed;
  }
}
