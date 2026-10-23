import { z } from 'zod';
import { Store } from './store.js';
import { VERSION, REA_VERSION, applySchema, compareSchema, fail, planSchema, scanSchema, verifySchema } from './model.js';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
export async function doctor() {
  let rea: { available: boolean; version?: string; expected: string } = { available: false, expected: REA_VERSION };
  try { const pkg = JSON.parse(await readFile(require.resolve('rea-agents/package.json'), 'utf8')); rea = { available: pkg.version === REA_VERSION, version: pkg.version, expected: REA_VERSION }; } catch { /* reported as unavailable */ }
  return { version: VERSION, node: process.versions.node, platform: process.platform, rea, capabilities: ['static-js-directory', 'asar', 'local-reports', 'source-map-cleanup', 'selective-obfuscation', 'human-approval'], limits: { entries: 20_000, totalBytes: 512 * 1024 * 1024, textBytesPerFile: 4 * 1024 * 1024 }, notes: ['体检不执行目标代码。', 'REA 不可用时规则仍可运行，但跨层覆盖未知。', 'MCP 用户确认能力取决于宿主；不支持时须使用交互式 CLI。'] };
}
export async function getReport(store: Store, id: string, offset = 0, limit = 25) {
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) fail('INVALID_PAGE', '分页要求 offset>=0 且 1<=limit<=100。');
  const page = <T>(items: T[]) => ({ items: items.slice(offset, offset + limit), total: items.length, nextOffset: offset + limit < items.length ? offset + limit : null });
  const kind = id.split('_')[0];
  if (kind === 'scan') {
    const record = await store.read(id, scanSchema);
    return { id, kind, target: record.target.inputPath, sha256: record.target.sha256, coverage: record.coverage, rea: record.rea, limitations: record.limitations, ...page(record.findings), reportsDirectory: store.directory(id) };
  }
  if (kind === 'plan') {
    const record = await store.read(id, planSchema);
    return { id, kind, input: record.target.inputPath, inputSha256: record.target.sha256, outputPath: record.outputPath, commands: record.commands, warnings: record.warnings, ...page(record.actions), reportsDirectory: store.directory(id) };
  }
  if (kind === 'apply') return { id, ...await store.read(id, applySchema) };
  if (kind === 'verify') return { id, ...await store.read(id, verifySchema) };
  if (kind === 'compare') {
    const record = await store.read(id, compareSchema);
    return { id, kind, beforeId: record.beforeId, afterId: record.afterId, coverage: record.coverage, limitations: record.limitations,
      ...page([...record.resolved.map(f => ({ category: 'not-observed', ...f })), ...record.remaining.map(f => ({ category: 'remaining-or-unknown', ...f })), ...record.added.map(f => ({ category: 'added', ...f }))]), reportsDirectory: store.directory(id) };
  }
  fail('UNKNOWN_RECORD', '未知记录类型。');
}
export function compact(result: { id: string; record: unknown; reports?: unknown }) {
  const record = result.record as Record<string, unknown>;
  return { id: result.id, kind: record.kind, coverage: record.coverage, findings: Array.isArray(record.findings) ? record.findings.length : undefined,
    actions: Array.isArray(record.actions) ? record.actions.length : undefined, outputPath: record.outputPath, afterScanId: record.afterScanId,
    checks: record.checks, requiresRepackaging: record.requiresRepackaging, reports: result.reports };
}
export const commandsFileSchema = z.array(z.object({ executable: z.string().min(1), args: z.array(z.string()), timeoutMs: z.number().int().min(100).max(600_000) }).strict());
