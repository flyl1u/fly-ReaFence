import { createRequire } from 'node:module';
import { chmod, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { REA_VERSION, VERSION, type ReaAnalysis, type Target } from './model.js';
import { exists, hashFile, maskText } from './util.js';

const require = createRequire(import.meta.url);
export function reaEntry(): string { return path.join(path.dirname(require.resolve('rea-agents/package.json')), 'scripts/rea.mjs'); }

export async function analyzeRea(target: Target, storeRoot: string, signal?: AbortSignal): Promise<ReaAnalysis> {
  const base = { version: REA_VERSION, coverage: 'unknown' as const, limitations: [] as string[] };
  let client: Client | undefined;
  try {
    const transport = new StdioClientTransport({ command: process.execPath, args: [reaEntry(), 'mcp'], stderr: 'pipe', maxBufferSize: 12 * 1024 * 1024 });
    transport.stderr?.on('data', () => {});
    client = new Client({ name: 'reafence', version: VERSION });
    await client.connect(transport, { timeout: 30_000 });
    const call = await client.callTool({ name: 'analyze_javascript_application', arguments: { input_path: target.inputPath, format: target.format, integrity_policy: 'fail', detail: 'summary' } }, { timeout: 180_000, signal });
    if (call.isError || !call.structuredContent) return { ...base, status: 'failed', limitations: ['REA 分析失败；没有把失败作为加固有效的证据。'] };
    const evidence = call.structuredContent as Record<string, unknown>;
    const summary = evidence.normalized_result as Record<string, unknown>;
    if (!summary || typeof summary.parent_evidence_id !== 'string') return { ...base, status: 'failed', limitations: ['REA 摘要契约不匹配，需要检查适配器。'] };
    const directory = await mkdtemp(path.join(storeRoot, 'evidence-'));
    const evidencePath = path.join(directory, 'rea-evidence.json');
    const exported = await client.callTool({ name: 'export_evidence_bundle', arguments: { path: evidencePath, overwrite: false } }, { timeout: 180_000, signal });
    if (exported.isError || !(await exists(evidencePath))) return { ...base, status: 'failed', limitations: ['REA 分析完成但证据导出失败；不报告完整结果。'] };
    await chmod(evidencePath, 0o600);
    // Keep only counts, coverage and IDs in the agent-facing summary. Full target-derived evidence remains local.
    const payload = summary.summary as Record<string, unknown> | undefined;
    if (!payload) return { ...base, status: 'failed', limitations: ['REA 未返回预期的应用摘要。'] };
    const safeSummary: Record<string, unknown> = { parent_evidence_id: summary.parent_evidence_id };
    for (const key of ['statistics', 'coverage', 'source_selection', 'electron', 'limitation_count']) if (key in payload) safeSummary[key] = payload[key];
    const coverageValue = payload.coverage as Record<string, unknown> | undefined;
    const application = coverageValue?.application as { status?: string } | undefined;
    const semantic = coverageValue?.semantic as { status?: string } | undefined;
    const coverage = application?.status === 'complete' && semantic?.status === 'complete' ? 'complete' : 'partial';
    const limitations = Array.isArray(summary.limitations) ? summary.limitations.map(l => maskText(typeof l === 'string' ? l : JSON.stringify(l))) : [];
    return { version: REA_VERSION, status: coverage, coverage, evidenceId: summary.parent_evidence_id, evidencePath, evidenceSha256: await hashFile(evidencePath), summary: safeSummary, limitations };
  } catch (error) {
    return { ...base, status: 'unavailable', limitations: [signal?.aborted ? 'REA 已取消，覆盖未知。' : `REA 不可用或超时（${error instanceof Error ? error.name : 'error'}）；覆盖未知。`] };
  } finally { await client?.close().catch(() => {}); }
}
