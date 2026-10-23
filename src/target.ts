import { lstat, readFile, readdir, readlink, realpath, open } from 'node:fs/promises';
import path from 'node:path';
import * as asar from '@electron/asar';
import { fail, type Target } from './model.js';
import { canonical, hash, hashFile, exists, safeRelative } from './util.js';

export const MAX_ENTRIES = 20_000;
export const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
export const MAX_TEXT_BYTES = 4 * 1024 * 1024;
const MAX_ASAR_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_HEADER_BYTES = 16 * 1024 * 1024;

async function noSymlinks(file: string): Promise<void> {
  let current = path.resolve(file);
  while (true) {
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) fail('SYMLINK', `拒绝跟随符号链接：${current}`);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

async function checkAsar(file: string) {
  const handle = await open(file, 'r');
  try {
    const first = Buffer.alloc(8);
    const { bytesRead } = await handle.read(first, 0, 8, 0);
    const size = first.readUInt32LE(4);
    if (bytesRead !== 8 || size > MAX_HEADER_BYTES || size < 8) fail('ASAR_HEADER', 'ASAR 头不合法或超过 16 MiB 上限。');
    if ((await handle.stat()).size > MAX_TOTAL_BYTES) fail('RESOURCE_LIMIT', 'ASAR 超过 512 MiB 首版限制。');
  } finally { await handle.close(); }
  asar.uncache(file);
}

export async function inventory(request: string): Promise<Target> {
  const requestedPath = path.resolve(request);
  if ((await lstat(requestedPath)).isSymbolicLink()) fail('SYMLINK', '请直接指定真实输入，不使用根符号链接。');
  let inputPath = await realpath(requestedPath);
  await noSymlinks(inputPath);
  let stat = await lstat(inputPath);
  const limitations: string[] = [];
  if (stat.isDirectory()) {
    const candidates = [path.join(inputPath, 'app.asar'), path.join(inputPath, 'resources', 'app.asar')];
    const found: string[] = [];
    for (const candidate of candidates) if (await exists(candidate)) found.push(candidate);
    if (found.length > 1) fail('AMBIGUOUS_TARGET', '存在多个 app.asar，请直接指定要检查的 ASAR。');
    if (found[0]) {
      inputPath = found[0]; await noSymlinks(inputPath); stat = await lstat(inputPath);
      limitations.push('已选择目录内的 app.asar 载荷；外部可执行文件、签名和运行时不在加固范围内。');
    }
  }
  const format = stat.isDirectory() ? 'directory' : stat.isFile() && /\.asar$/i.test(inputPath) ? 'asar' : fail('UNSUPPORTED_TARGET', '请提供构建目录或 .asar 文件。');
  const files: Target['files'] = [];
  const casePaths = new Set<string>();
  let total = 0;
  const add = (entry: Target['files'][number]) => {
    safeRelative(entry.path);
    const key = entry.path.toLowerCase();
    if (casePaths.has(key)) fail('PATH_COLLISION', `存在跨平台文件名冲突：${entry.path}`);
    casePaths.add(key);
    if (files.length >= MAX_ENTRIES || (total += entry.size) > MAX_TOTAL_BYTES) fail('RESOURCE_LIMIT', '输入超过首版限制：20,000 个条目或 512 MiB。');
    files.push(entry);
  };
  if (format === 'directory') {
    const walk = async (directory: string, prefix = ''): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      for (const entry of entries) {
        const relative = safeRelative(prefix ? `${prefix}/${entry.name}` : entry.name);
        const full = path.join(directory, entry.name);
        const info = await lstat(full);
        if (info.isSymbolicLink()) {
          add({ path: relative, size: 0, sha256: hash(await readlink(full)), kind: 'symlink', executable: false, unpacked: false });
          limitations.push(`未跟随符号链接：${relative}`);
        } else if (info.isDirectory()) {
          add({ path: relative, size: 0, sha256: hash('directory'), kind: 'directory', executable: true, unpacked: false });
          await walk(full, relative);
        } else if (info.isFile()) {
          if (info.size + total > MAX_TOTAL_BYTES) fail('RESOURCE_LIMIT', '输入超过 512 MiB。');
          add({ path: relative, size: info.size, sha256: await hashFile(full), kind: 'file', executable: Boolean(info.mode & 0o111), unpacked: false });
          if (/\.asar$/i.test(relative)) limitations.push(`嵌套 ASAR 未由本地规则展开：${relative}；请直接指定该 ASAR 单独体检。`);
        } else fail('SPECIAL_FILE', `不读取特殊文件：${relative}`);
      }
    };
    await walk(inputPath);
  } else {
    await checkAsar(inputPath);
    for (const item of asar.listPackage(inputPath, { isPack: false })) {
      const relative = safeRelative(item.replace(/^[/\\]/, ''));
      const info = asar.statFile(inputPath, relative, false);
      if ('files' in info) {
        add({ path: relative, size: 0, sha256: hash('directory'), kind: 'directory', executable: true, unpacked: Boolean(info.unpacked) });
      } else if ('link' in info) {
        add({ path: relative, size: 0, sha256: hash(info.link), kind: 'symlink', executable: false, unpacked: Boolean(info.unpacked) });
        limitations.push(`未跟随 ASAR 链接：${relative}`);
      } else {
        if (info.size > MAX_ASAR_ENTRY_BYTES || info.size + total > MAX_TOTAL_BYTES) fail('RESOURCE_LIMIT', `ASAR 条目超过内存读取上限：${relative}`);
        if (info.unpacked) await noSymlinks(path.join(`${inputPath}.unpacked`, relative));
        const bytes = asar.extractFile(inputPath, relative, false);
        if (bytes.length !== info.size) fail('ASAR_INTEGRITY', `ASAR 条目长度不匹配：${relative}`);
        const digest = hash(bytes);
        if (info.integrity && (info.integrity.algorithm !== 'SHA256' || info.integrity.hash !== digest)) fail('ASAR_INTEGRITY', `ASAR 条目摘要不匹配：${relative}`);
        add({ path: relative, size: info.size, sha256: digest, kind: 'file', executable: Boolean(info.executable), unpacked: Boolean(info.unpacked) });
      }
    }
    const sidecar = `${inputPath}.unpacked`;
    if (await exists(sidecar)) {
      await noSymlinks(sidecar);
      const unpacked = new Set(files.filter(f => f.unpacked).map(f => f.path));
      const inspectSidecar = async (directory: string, prefix = ''): Promise<void> => {
        for (const item of await readdir(directory, { withFileTypes: true })) {
          const relative = safeRelative(prefix ? `${prefix}/${item.name}` : item.name);
          const full = path.join(directory, item.name);
          const info = await lstat(full);
          if (info.isSymbolicLink()) fail('SYMLINK', `unpacked 目录包含符号链接：${relative}`);
          if (info.isDirectory()) {
            if (![...unpacked].some(p => p === relative || p.startsWith(`${relative}/`))) fail('UNMODELED_SIDECAR', `unpacked 目录存在未被 ASAR 头记录的目录：${relative}；请单独检查该目录。`);
            await inspectSidecar(full, relative);
          } else if (!info.isFile() || !unpacked.has(relative)) fail('UNMODELED_SIDECAR', `unpacked 目录存在未被 ASAR 头记录的文件：${relative}；请单独检查该目录。`);
        }
      };
      await inspectSidecar(sidecar);
    }
  }
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const archiveSha256 = format === 'asar' ? await hashFile(inputPath) : undefined;
  return { requestedPath, inputPath, format, files, sha256: hash(canonical({ format, files, archiveSha256 })), limitations };
}

export async function readEntry(target: Target, relative: string): Promise<Buffer> {
  safeRelative(relative);
  const entry = target.files.find(file => file.path === relative);
  if (!entry || entry.kind !== 'file') fail('NOT_A_FILE', `不是已检查的普通文件：${relative}`);
  const full = path.join(target.inputPath, relative);
  if (target.format === 'directory') await noSymlinks(full);
  else if (entry.unpacked) await noSymlinks(path.join(`${target.inputPath}.unpacked`, relative));
  const bytes = target.format === 'directory' ? await readFile(full) : asar.extractFile(target.inputPath, relative, false);
  if (hash(bytes) !== entry.sha256) fail('TARGET_CHANGED', `输入已变化，请重新体检：${relative}`);
  return bytes;
}
