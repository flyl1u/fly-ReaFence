import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fail } from './model.js';

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export function hash(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }
export async function hashFile(file: string): Promise<string> {
  const result = createHash('sha256');
  for await (const chunk of createReadStream(file)) result.update(chunk);
  return result.digest('hex');
}
export async function exists(file: string): Promise<boolean> {
  try { await lstat(file); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; }
}
export function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
export async function resolvedFuture(file: string): Promise<string> {
  const absolute = path.resolve(file);
  if (await exists(absolute)) return realpath(absolute);
  const parent = path.dirname(absolute);
  if (parent === absolute) fail('INVALID_PATH', `无法解析路径：${absolute}`);
  return path.join(await resolvedFuture(parent), path.basename(absolute));
}
export function safeRelative(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.includes('\0') || normalized.split('/').some(p => !p || p === '.' || p === '..' || /[:<>"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) {
    fail('UNSAFE_PATH', `不支持的文件路径：${value}`);
  }
  return normalized;
}
export async function ensureOutside(target: { inputPath: string; requestedPath: string }, candidate: string): Promise<string> {
  const resolved = await resolvedFuture(candidate);
  for (const source of new Set([target.inputPath, target.requestedPath])) {
    const input = await realpath(source);
    if (inside(input, resolved) || inside(resolved, input)) fail('OVERLAPPING_PATH', `输出/工作目录必须与输入分离：${resolved}`);
  }
  return resolved;
}
export function now(): string { return new Date().toISOString(); }
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
export function maskText(text: string): string {
  return text.replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-\r\n]*PRIVATE KEY-----|$)/g, '[PRIVATE KEY REDACTED]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/g, '[CREDENTIAL REDACTED]')
    .replace(/((?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*["']?)[^\s"'`,;]{8,}/gi, '$1[REDACTED]');
}
