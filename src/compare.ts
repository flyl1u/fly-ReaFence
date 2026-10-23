import { Store } from './store.js';
import { scanSchema, compareSchema, type Comparison } from './model.js';
import { now } from './util.js';
import { compareMarkdown, writeReport } from './report.js';

export async function compareScans(store: Store, beforeId: string, afterId: string) {
  const before = await store.read(beforeId, scanSchema);
  const after = await store.read(afterId, scanSchema);
  const key = (f: { rule: string; path: string }) => `${f.rule}:${f.path}`;
  const beforeKeys = new Set(before.findings.map(key));
  const afterKeys = new Set(after.findings.map(key));
  const complete = before.coverage === 'complete' && after.coverage === 'complete';
  const missing = before.findings.filter(f => !afterKeys.has(key(f)));
  const comparison: Comparison = { schemaVersion: 1, kind: 'compare', createdAt: now(), beforeId, afterId,
    coverage: complete ? 'complete' : 'partial',
    resolved: complete ? missing : [],
    remaining: before.findings.filter(f => afterKeys.has(key(f))).concat(complete ? [] : missing.map(f => ({ ...f, confidence: 'unknown' as const, evidence: '复测未再观察到，但至少一侧分析不完整，不能证明该项已消除。' }))),
    added: after.findings.filter(f => !beforeKeys.has(key(f))),
    limitations: ['这里只比较同一规则在同一路径的观察，不是逆向难度评分或行为等价证明。', '分析失败、解析能力下降和缺失边不能当作加固成功。', ...(complete ? [] : ['至少一侧覆盖不完整；未再观察到的发现保留为未知。']), ...before.limitations, ...after.limitations] };
  const id = await store.save(compareSchema, comparison);
  return { id, record: comparison, reports: await writeReport(store, id, compareMarkdown(comparison), '前后对比报告') };
}
