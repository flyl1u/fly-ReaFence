import { z } from 'zod';

const runSchema = z.object({
  variant: z.enum(['original', 'hardened']), repetition: z.number().int().min(1).max(3),
  payloadSha256: z.string().regex(/^[a-f0-9]{64}$/),
  elapsedMs: z.number().nonnegative(), tokens: z.number().int().nonnegative().nullable(),
  passedCases: z.number().int().nonnegative(), totalCases: z.number().int().positive(),
  outcome: z.enum(['completed', 'budget-exhausted', 'error']),
  freshSession: z.literal(true), transcriptReference: z.string().min(1),
  grading: z.literal('externally-verified'),
}).strict().refine(r => r.passedCases <= r.totalCases, 'passedCases exceeds totalCases');
export const benchmarkSchema = z.object({
  schemaVersion: z.literal(1), task: z.string().min(1), taskSha256: z.string().regex(/^[a-f0-9]{64}$/),
  model: z.string().min(1), modelSettings: z.string().min(1), toolsVersion: z.string().min(1),
  timeBudgetMs: z.number().int().positive(), tokenBudget: z.number().int().positive().nullable(),
  runs: z.array(runSchema).length(6),
}).strict().superRefine((data, ctx) => {
  for (const variant of ['original', 'hardened']) {
    const runs = data.runs.filter(r => r.variant === variant);
    if (runs.length !== 3 || new Set(runs.map(r => r.repetition)).size !== 3 || new Set(runs.map(r => r.payloadSha256)).size !== 1) ctx.addIssue({ code: 'custom', message: `需要 ${variant} 的三个独立重复，载荷摘要必须一致。` });
  }
  if (new Set(data.runs.map(r => r.totalCases)).size !== 1) ctx.addIssue({ code: 'custom', message: '两组必须使用相同数量的验收用例。' });
  if (new Set(data.runs.map(r => r.transcriptReference)).size !== 6) ctx.addIssue({ code: 'custom', message: '每次尝试必须引用独立会话记录。' });
  if (data.runs.some(r => data.tokenBudget !== null && r.tokens !== null && r.tokens > data.tokenBudget)) ctx.addIssue({ code: 'custom', message: '记录超过约定 Token 预算，不能作为同预算对比。' });
});

export function summarizeBenchmark(input: unknown) {
  const data = benchmarkSchema.parse(input);
  const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const group = (variant: 'original' | 'hardened') => {
    const runs = data.runs.filter(r => r.variant === variant);
    return { attempts: 3, completed: runs.filter(r => r.outcome === 'completed').length,
      errors: runs.filter(r => r.outcome === 'error').length, meanElapsedMs: average(runs.map(r => r.elapsedMs)),
      meanTokens: runs.every(r => r.tokens !== null) ? average(runs.map(r => r.tokens!)) : null,
      meanCasePassRate: average(runs.map(r => r.passedCases / r.totalCases)) };
  };
  return { task: data.task, model: data.model, original: group('original'), hardened: group('hardened'),
    limitations: ['记录由用户从外部独立会话和外部验收环境提供，本工具只校验结构并汇总，不能证明来源真实性。', '工具异常和预算耗尽会保留为独立状态，不得解释为普遍防逆向成功。', '不得在宿主直接执行未知的 Agent 生成代码；验收应在另行准备的隔离环境中完成。', '三次重复仅为小样本观察，不代表其他模型、工具或预算下的效果。'] };
}
