import { readFile } from 'node:fs/promises';
import { summarizeBenchmark } from '../dist/benchmark.js';
import { sanitizeData } from '../dist/util.js';

if (!process.argv[2]) {
  console.error('Usage: npm run benchmark -- <records.json>');
  process.exitCode = 1;
} else {
  try {
    const result = summarizeBenchmark(JSON.parse(await readFile(process.argv[2], 'utf8')));
    console.log(JSON.stringify(sanitizeData(result), null, 2));
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
