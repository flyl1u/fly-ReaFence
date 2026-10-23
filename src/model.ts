import { z } from 'zod';

export const VERSION = '0.1.0';
export const REA_VERSION = '6.7.0';
export const shaSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const idSchema = z.string().regex(/^(scan|plan|apply|verify|compare)_[a-f0-9]{64}$/);
const coverageSchema = z.enum(['complete', 'partial', 'unknown']);

export const fileSchema = z.object({
  path: z.string().min(1), size: z.number().int().nonnegative(), sha256: shaSchema,
  kind: z.enum(['file', 'directory', 'symlink']), executable: z.boolean(), unpacked: z.boolean(),
}).strict();
export const targetSchema = z.object({
  requestedPath: z.string(), inputPath: z.string(), format: z.enum(['directory', 'asar']),
  sha256: shaSchema, files: z.array(fileSchema), limitations: z.array(z.string()),
}).strict();
export type Target = z.infer<typeof targetSchema>;

export const findingSchema = z.object({
  id: z.string(), rule: z.string(), title: z.string(),
  severity: z.enum(['high', 'medium', 'low', 'info']),
  confidence: z.enum(['observed', 'inferred', 'unknown']),
  path: z.string(), line: z.number().int().positive().optional(),
  evidence: z.string(), impact: z.string(), recommendation: z.string(),
  action: z.enum(['remove-sourcemap', 'remove-file', 'review']).default('review'),
}).strict();
export type Finding = z.infer<typeof findingSchema>;

export const reaSchema = z.object({
  status: z.enum(['complete', 'partial', 'unavailable', 'skipped', 'failed']),
  version: z.string(), coverage: coverageSchema,
  evidenceId: z.string().optional(), evidencePath: z.string().optional(),
  evidenceSha256: shaSchema.optional(), summary: z.record(z.string(), z.unknown()).optional(),
  limitations: z.array(z.string()),
}).strict();
export type ReaAnalysis = z.infer<typeof reaSchema>;
export const scanSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('scan'), createdAt: z.string(),
  toolVersion: z.string(), target: targetSchema, findings: z.array(findingSchema),
  coverage: coverageSchema, ruleCoverage: coverageSchema, limitations: z.array(z.string()), rea: reaSchema,
}).strict();
export type Scan = z.infer<typeof scanSchema>;

export const commandSchema = z.object({
  executable: z.string().min(1), args: z.array(z.string()), timeoutMs: z.number().int().min(100).max(600_000),
}).strict();
export type ValidationCommand = z.infer<typeof commandSchema>;
export const actionSchema = z.object({
  type: z.enum(['remove-sourcemap', 'remove-file', 'obfuscate']), path: z.string().min(1),
  reason: z.string(), environment: z.enum(['node', 'browser-no-eval']).optional(),
}).strict();
export type Action = z.infer<typeof actionSchema>;
export const planSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('plan'), createdAt: z.string(),
  scanId: idSchema, target: targetSchema, outputPath: z.string(),
  actions: z.array(actionSchema).min(1), commands: z.array(commandSchema),
  warnings: z.array(z.string()), seed: z.number().int().positive(),
}).strict();
export type Plan = z.infer<typeof planSchema>;

export const checkSchema = z.object({
  name: z.string(), status: z.enum(['passed', 'failed', 'not-run', 'unknown']), details: z.string(),
}).strict();
export type Check = z.infer<typeof checkSchema>;
export const applySchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('apply'), createdAt: z.string(),
  planId: idSchema, scanId: idSchema, afterScanId: idSchema.optional(),
  outputPath: z.string(), outputSha256: shaSchema,
  approval: z.enum(['terminal', 'mcp-elicitation']), checks: z.array(checkSchema),
  validationStatus: z.enum(['passed', 'failed', 'not-run']),
  requiresRepackaging: z.boolean(),
}).strict();
export type Applied = z.infer<typeof applySchema>;
export const verifySchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('verify'), createdAt: z.string(),
  applyId: idSchema, outputSha256: shaSchema, checks: z.array(checkSchema),
}).strict();
export const compareSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('compare'), createdAt: z.string(),
  beforeId: idSchema, afterId: idSchema, coverage: coverageSchema,
  resolved: z.array(findingSchema), remaining: z.array(findingSchema), added: z.array(findingSchema),
  limitations: z.array(z.string()),
}).strict();
export type Comparison = z.infer<typeof compareSchema>;

export class DefenceError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'DefenceError'; }
}
export function fail(code: string, message: string): never { throw new DefenceError(code, message); }
