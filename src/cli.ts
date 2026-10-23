import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { Store } from './store.js';
import { scanTarget } from './scan.js';
import { preparePlan, applyPlan, verifyApplied } from './harden.js';
import { compareScans } from './compare.js';
import { doctor, getReport, compact, commandsFileSchema } from './api.js';
import { terminalApprover } from './approval.js';
import { startMcp } from './mcp.js';
import { VERSION, DefenceError } from './model.js';
import { maskText } from './util.js';

export async function main(argv = process.argv) {
  const program = new Command().name('defencerea').description('JS / Electron 静态逆向体检与用户确认后加固').version(VERSION)
    .option('--store <directory>', '报告和记录目录（必须与输入、输出分离）').option('--json', '输出结构化 JSON');
  const store = () => new Store(program.opts().store);
  const output = (data: unknown) => { process.stdout.write(`${maskText(JSON.stringify(data, null, 2))}\n`); };
  const collect = (value: string, values: string[]) => [...values, value];
  program.command('doctor').description('检查运行环境与依赖').action(async () => { output(await doctor()); });
  program.command('scan <target>').description('只读静态体检并生成详细报告').option('--no-rea', '显式跳过 REA，跨层分析标记为未知').action(async (target: string, options: { rea: boolean }) => { output(compact(await scanTarget(store(), target, options))); });
  program.command('report <id>').description('分页查看记录').option('--offset <n>', '起始位置', '0').option('--limit <n>', '条数，最多 100', '25').action(async (id: string, options: { offset: string; limit: string }) => { output(await getReport(store(), id, Number(options.offset), Number(options.limit))); });
  program.command('plan <scanId>').description('生成具体方案，不执行加固').requiredOption('--out <directory>', '新的输出目录，内含 app 或 app.asar')
    .option('--remove <file>', '逐项选定报告中的资源删除候选，可重复', collect, [])
    .option('--obfuscate <file>', '逐项选定自有 JS 文件，可重复', collect, [])
    .option('--environment <target>', '混淆环境 node 或 browser-no-eval', 'node')
    .option('--commands <json-file>', '待用户确认的验证命令数组文件')
    .action(async (scanId: string, options: { out: string; remove: string[]; obfuscate: string[]; environment: string; commands?: string }) => {
      if (!['node', 'browser-no-eval'].includes(options.environment)) throw new DefenceError('INVALID_ENVIRONMENT', 'environment 必须为 node 或 browser-no-eval。');
      const commands = options.commands ? commandsFileSchema.parse(JSON.parse(await readFile(options.commands, 'utf8'))) : [];
      output(compact(await preparePlan(store(), scanId, { output: options.out, remove: options.remove, obfuscate: options.obfuscate, environment: options.environment as 'node' | 'browser-no-eval', commands })));
    });
  program.command('apply <planId>').description('在交互式终端预览、确认后执行加固').option('--no-rea', '复测跳过 REA，覆盖标记为未知').action(async (id: string, options: { rea: boolean }) => { output(compact(await applyPlan(store(), id, terminalApprover, options))); });
  program.command('verify <applyId>').description('重新运行验证；需要用户再次确认运行时命令').action(async (id: string) => { const result = await verifyApplied(store(), id, terminalApprover); output({ id: result.id, ...result.record }); });
  program.command('compare <beforeId> <afterId>').description('生成体检前后对比报告').action(async (before: string, after: string) => { output(compact(await compareScans(store(), before, after))); });
  program.command('mcp').description('启动本地 stdio MCP 服务').action(() => {
    const server = startMcp(store());
    const close = () => { void server.close().finally(() => { process.exitCode = 0; }); };
    process.once('SIGINT', close); process.once('SIGTERM', close);
  });
  try { await program.parseAsync(argv); }
  catch (error) {
    process.stderr.write(`${maskText(JSON.stringify({ code: error instanceof DefenceError ? error.code : 'OPERATION_FAILED', message: error instanceof Error ? error.message : String(error) }))}\n`);
    process.exitCode = 1;
  }
}
