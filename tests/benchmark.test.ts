import { expect, test } from 'vitest';
import { summarizeBenchmark } from '../src/benchmark.js';

function records() {
  return { schemaVersion: 1, task: 'owned test algorithm', taskSha256: 'a'.repeat(64), model: 'fixed-model', modelSettings: 'same-settings', toolsVersion: 'REA 6.7.0', timeBudgetMs: 60000, tokenBudget: 4000,
    runs: ['original', 'hardened'].flatMap((variant, v) => [1, 2, 3].map(repetition => ({ variant, repetition, payloadSha256: String(v + 1).repeat(64), elapsedMs: 1000, tokens: null, passedCases: 2, totalCases: 4, outcome: 'completed', freshSession: true, transcriptReference: `${variant}-${repetition}`, grading: 'externally-verified' }))) };
}
test('benchmark preserves unavailable token counts without inventing measurements', () => {
  const report = summarizeBenchmark(records());
  expect(report.hardened.meanTokens).toBeNull();
  expect(report.original.meanCasePassRate).toBe(0.5);
});
test('benchmark refuses reused sessions and incomplete repeats', () => {
  const data = records(); data.runs[0]!.transcriptReference = data.runs[1]!.transcriptReference;
  expect(() => summarizeBenchmark(data)).toThrow('独立会话');
  expect(() => summarizeBenchmark({ ...records(), runs: [] })).toThrow();
});
