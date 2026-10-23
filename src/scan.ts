import { mkdir } from 'node:fs/promises';
import { inventory } from './target.js';
import { analyzeRules } from './rules.js';
import { analyzeRea } from './rea.js';
import { REA_VERSION, VERSION, scanSchema, fail, type Scan } from './model.js';
import { ensureOutside, now } from './util.js';
import { Store } from './store.js';
import { scanMarkdown, writeReport } from './report.js';

export async function scanTarget(store: Store, input: string, options: { rea?: boolean; signal?: AbortSignal } = {}) {
  options.signal?.throwIfAborted();
  const target = await inventory(input);
  await ensureOutside(target, store.root);
  await mkdir(store.root, { recursive: true, mode: 0o700 });
  const rules = await analyzeRules(target);
  const rea = options.rea === false ? { status: 'skipped' as const, version: REA_VERSION, coverage: 'unknown' as const, limitations: ['用户选择跳过 REA；模块与跨层关系覆盖未知。'] } : await analyzeRea(target, store.root, options.signal);
  options.signal?.throwIfAborted();
  if ((await inventory(input)).sha256 !== target.sha256) fail('TARGET_CHANGED', '体检期间输入已变化，请重新运行。');
  const record: Scan = { schemaVersion: 1, kind: 'scan', createdAt: now(), toolVersion: VERSION, target, findings: rules.findings,
    coverage: rules.limitations.length || rea.coverage !== 'complete' ? 'partial' : 'complete', ruleCoverage: rules.limitations.length ? 'partial' : 'complete', limitations: rules.limitations, rea };
  const id = await store.save(scanSchema, record);
  const reports = await writeReport(store, id, scanMarkdown(record), '体检报告');
  return { id, record, reports };
}
