import { createReadStream } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as asar from '@electron/asar';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { Store } from './store.js';
import { scanTarget } from './scan.js';
import { inventory, readEntry, MAX_TEXT_BYTES } from './target.js';
import { parseJavaScript, sourceMapComments } from './rules.js';
import { applySchema, planSchema, scanSchema, verifySchema, commandSchema, fail, type Action, type Plan, type Check, type ValidationCommand } from './model.js';
import { canonical, ensureOutside, exists, hash, now, resolvedFuture, safeRelative } from './util.js';
import { applyMarkdown, planMarkdown, writeReport } from './report.js';

export type ApprovalRequest = { id: string; digest: string; message: string };
/** Internal adapter boundary. Only the terminal / MCP transport supplies this callback; never expose it as tool input. */
export type HumanApprover = (request: ApprovalRequest) => Promise<'terminal' | 'mcp-elicitation' | undefined>;

function eligible(relative: string): boolean { return !/(^|\/)(?:node_modules|vendor|third_party)\//i.test(relative) && !/(?:^|\/)(?:licen[cs]e|copying|notice)(?:\.|$)/i.test(relative); }

export async function preparePlan(store: Store, scanId: string, options: { output: string; remove?: string[]; obfuscate?: string[]; environment?: 'node' | 'browser-no-eval'; commands?: ValidationCommand[] }) {
  const scan = await store.read(scanId, scanSchema);
  await ensureOutside(scan.target, store.root);
  if ((await inventory(scan.target.requestedPath)).sha256 !== scan.target.sha256) fail('TARGET_CHANGED', '输入已变化，请重新体检。');
  if (scan.target.files.some(f => f.kind === 'symlink')) fail('SYMLINK', '首版不重建包含符号链接的产物；可继续查看只读报告。');
  const outputPath = await ensureOutside(scan.target, options.output);
  const storePath = await resolvedFuture(store.root);
  const { inside } = await import('./util.js');
  if (inside(storePath, outputPath) || inside(outputPath, storePath)) fail('OVERLAPPING_PATH', '加固输出不能与报告/证据目录重叠。');
  if (await exists(outputPath)) fail('OUTPUT_EXISTS', '输出位置已存在；请指定新的目录。');
  const actions: Action[] = [];
  const add = (action: Action) => { if (!actions.some(a => a.type === action.type && a.path === action.path)) actions.push(action); };
  for (const finding of scan.findings.filter(f => f.action === 'remove-sourcemap' && eligible(f.path))) {
    add({ type: 'remove-sourcemap', path: finding.path, reason: '移除发布副本的 Source Map v3 或源码映射注释；内部原件保留。' });
  }
  for (const relative of options.remove ?? []) {
    safeRelative(relative);
    if (!eligible(relative) || !scan.findings.some(f => f.path === relative && f.action === 'remove-file')) fail('INVALID_ACTION', `仅允许逐项移除报告中的自有资源候选：${relative}`);
    add({ type: 'remove-file', path: relative, reason: '用户选定的误打包资源候选；删除前须确认运行时不依赖它。' });
  }
  for (const relative of options.obfuscate ?? []) {
    safeRelative(relative);
    if (!eligible(relative) || !/\.[cm]?js$/.test(relative) || /(?:^|[./_-])preload(?:[./_-]|$)/i.test(relative)) fail('INVALID_ACTION', `混淆只支持明确选中的自有 JS，且排除 preload 与依赖：${relative}`);
    const bytes = await readEntry(scan.target, relative);
    if (bytes.length > MAX_TEXT_BYTES) fail('RESOURCE_LIMIT', `混淆文件超过 4 MiB：${relative}`);
    parseJavaScript(bytes.toString('utf8'), relative);
    add({ type: 'obfuscate', path: relative, environment: options.environment ?? 'node', reason: '用户选定的保守混淆；不改属性/全局名，不启用反调试、控制流平坦化或自防御。' });
  }
  for (const action of actions) {
    if (!scan.target.files.some(f => f.path === action.path && f.kind === 'file')) fail('INVALID_ACTION', `文件不在体检清单内：${action.path}`);
    if (actions.some(a => a.path === action.path && a.type === 'remove-file') && action.type === 'obfuscate') fail('CONFLICTING_ACTIONS', '同一文件不能同时删除和混淆。');
  }
  if (!actions.length) fail('NO_ACTIONS', '没有可执行的加固项；可以选定资源或自有 JS 文件后重新生成方案。');
  // Content hashes in HTML require a build-system update rather than a byte-only transform.
  for (const file of scan.target.files.filter(f => f.kind === 'file' && /\.html?$/.test(f.path) && f.size <= MAX_TEXT_BYTES)) {
    if (/\bintegrity\s*=\s*["']/i.test((await readEntry(scan.target, file.path)).toString('utf8'))) fail('INTEGRITY_BOUND', '发现 HTML SRI 完整性绑定；请通过原构建流程加固并更新哈希，首版不直接变更此载荷。');
  }
  const commands = (options.commands ?? []).map(c => commandSchema.parse(c));
  if (commands.some(c => /\.(?:cmd|bat)$/i.test(c.executable))) fail('SHELL_COMMAND', '验证命令不经 shell 执行；请直接指定 node.exe 等可执行文件。');
  const plan: Plan = { schemaVersion: 1, kind: 'plan', createdAt: now(), scanId, target: scan.target, outputPath, actions, commands,
    seed: parseInt(hash(canonical(actions)).slice(0, 7), 16) + 1,
    warnings: ['输入保持原样；输出是新目录内的应用载荷。回滚可直接使用原产物。', '混淆会增加包体和分析成本，但不保证阻止逆向；需要实际功能测试。', '客户端长期秘密和完全本地的权限判断不能靠混淆变安全。', ...(scan.target.format === 'asar' ? ['重建 ASAR 后必须通过原构建流程更新外部完整性哈希、重新打包和签名；本工具不处理这些步骤。'] : []), ...(commands.length ? ['验证命令将以当前用户权限执行；命令及其参数必须由用户审阅，不是沙箱。'] : ['未配置运行时验证命令；功能将标记为未验证。'])] };
  const id = await store.save(planSchema, plan);
  const reports = await writeReport(store, id, planMarkdown(plan, id), '待确认的加固方案');
  return { id, record: plan, reports };
}

async function unchanged(plan: Plan): Promise<void> {
  if ((await inventory(plan.target.requestedPath)).sha256 !== plan.target.sha256) fail('TARGET_CHANGED', '输入已变化；原同意已失效，请重新体检并确认。');
  if ((await resolvedFuture(plan.outputPath)) !== plan.outputPath) fail('OUTPUT_CHANGED', '输出路径解析结果已变化，需要重新生成方案。');
  await ensureOutside(plan.target, plan.outputPath);
}
function stripMap(text: string, file: string): string {
  for (const comment of sourceMapComments(text, file).sort((a, b) => b.start - a.start)) text = text.slice(0, comment.start) + text.slice(comment.start, comment.end).replace(/[^\r\n]/g, '') + text.slice(comment.end);
  return text;
}
export function obfuscate(text: string, plan: Plan, action: Action): string {
  return JavaScriptObfuscator.obfuscate(text, {
    target: action.environment ?? 'node', seed: plan.seed, compact: true, renameGlobals: false, renameProperties: false,
    controlFlowFlattening: false, deadCodeInjection: false, debugProtection: false, selfDefending: false,
    disableConsoleOutput: false, sourceMap: false, stringArray: true, stringArrayThreshold: 0.5,
    stringArrayEncoding: [], transformObjectKeys: false, splitStrings: false,
  }).getObfuscatedCode();
}

async function killTree(pid: number): Promise<void> {
  if (process.platform === 'win32') await new Promise<void>(resolve => { const child = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); child.on('error', () => resolve()); child.on('close', () => resolve()); });
  else { try { process.kill(-pid, 'SIGKILL'); } catch { /* already exited */ } }
}
async function runCommands(commands: ValidationCommand[], payload: string, output: string, signal?: AbortSignal): Promise<Check[]> {
  const checks: Check[] = [];
  for (const [index, command] of commands.entries()) {
    signal?.throwIfAborted();
    const args = command.args.map(arg => arg.replaceAll('{payload}', payload).replaceAll('{output}', output));
    checks.push(await new Promise<Check>((resolve) => {
      let bytes = 0; let timedOut = false; let cancelled = false; let settled = false;
      const child = spawn(command.executable, args, { cwd: payload.endsWith('.asar') ? output : payload, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
      const done = (check: Check) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolve(check); };
      const onAbort = () => { cancelled = true; if (child.pid) void killTree(child.pid); };
      const timer = setTimeout(() => { timedOut = true; if (child.pid) void killTree(child.pid); }, command.timeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      const count = (chunk: Buffer) => { bytes += chunk.length; if (bytes > 1024 * 1024 && child.pid) void killTree(child.pid); };
      child.stdout.on('data', count); child.stderr.on('data', count);
      child.on('error', () => done({ name: `command-${index + 1}`, status: 'failed', details: '命令无法启动。未保存可能含敏感信息的原始输出。' }));
      child.on('close', code => done({ name: `command-${index + 1}`, status: !timedOut && !cancelled && bytes <= 1024 * 1024 && code === 0 ? 'passed' : 'failed', details: `exit=${code}; timeout=${timedOut}; cancelled=${cancelled}; outputBytes=${bytes}。不保存原始输出。` }));
    }));
  }
  return checks.length ? checks : [{ name: 'runtime', status: 'not-run', details: '未配置运行时验证命令，功能未验证。' }];
}

export async function applyPlan(store: Store, planId: string, approve: HumanApprover, options: { rea?: boolean; signal?: AbortSignal } = {}) {
  const plan = await store.read(planId, planSchema);
  await ensureOutside(plan.target, store.root);
  await unchanged(plan);
  if (await exists(plan.outputPath)) fail('OUTPUT_EXISTS', '输出已存在；不会覆盖。');
  const approval = await approve({ id: planId, digest: hash(canonical(plan)), message: planMarkdown(plan, planId) });
  if (!approval) fail('APPROVAL_REQUIRED', '用户未同意；没有执行加固。');
  options.signal?.throwIfAborted();
  await unchanged(plan);
  const parent = path.dirname(plan.outputPath);
  await mkdir(parent, { recursive: true });
  // Exclusive reservation prevents concurrent executions from overwriting an existing output.
  await mkdir(plan.outputPath);
  const staging = await mkdtemp(path.join(plan.outputPath, '.staging-'));
  const payloadName = plan.target.format === 'asar' ? 'app.asar' : 'app';
  const outputPayload = path.join(plan.outputPath, payloadName);
  const source = path.join(staging, 'source');
  await mkdir(source);
  await writeFile(path.join(plan.outputPath, 'INCOMPLETE'), '加固未完成；不能发布此目录。', { flag: 'wx' });
  let published = false;
  try {
    for (const entry of plan.target.files) {
      options.signal?.throwIfAborted();
      const full = path.join(source, safeRelative(entry.path));
      if (entry.kind === 'directory') { await mkdir(full, { recursive: true }); continue; }
      if (entry.kind !== 'file') fail('SYMLINK', '首版不复制符号链接。');
      if (plan.actions.some(a => a.path === entry.path && (a.type === 'remove-file' || a.type === 'remove-sourcemap' && entry.path.endsWith('.map')))) continue;
      let bytes = await readEntry(plan.target, entry.path);
      const edits = plan.actions.filter(a => a.path === entry.path);
      let text = bytes.toString('utf8');
      if (edits.some(a => a.type === 'remove-sourcemap')) text = stripMap(text, entry.path);
      const transform = edits.find(a => a.type === 'obfuscate');
      if (transform) text = obfuscate(text, plan, transform);
      if (edits.length) { parseJavaScript(text, entry.path); bytes = Buffer.from(text); }
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, bytes, { flag: 'wx', mode: entry.executable ? 0o755 : 0o644 });
      if (entry.executable) await chmod(full, 0o755);
    }
    await unchanged(plan);
    if (plan.target.format === 'asar') {
      const streams: Parameters<typeof asar.createPackageFromStreams>[1] = [];
      for (const entry of plan.target.files) {
        const full = path.join(source, entry.path);
        if (!(await exists(full))) continue;
        streams.push({ path: entry.path, type: entry.kind === 'directory' ? 'directory' : 'file', unpacked: entry.unpacked, stat: await lstat(full), streamGenerator: () => createReadStream(full) });
      }
      const archive = path.join(staging, 'app.asar');
      await asar.createPackageFromStreams(archive, streams);
      await inventory(archive);
      await rename(archive, outputPayload);
      if (await exists(`${archive}.unpacked`)) await rename(`${archive}.unpacked`, `${outputPayload}.unpacked`);
    } else await rename(source, outputPayload);
    options.signal?.throwIfAborted();
    const beforeCommands = await inventory(outputPayload);
    const checks: Check[] = [{ name: 'structure-and-syntax', status: 'passed', details: '变更 JS 的语法、输出清单及 ASAR 条目摘要检查通过；不代表运行时等价。' }, ...await runCommands(plan.commands, outputPayload, plan.outputPath, options.signal)];
    const afterCommands = await inventory(outputPayload);
    if (beforeCommands.sha256 !== afterCommands.sha256) checks.push({ name: 'validation-side-effects', status: 'failed', details: '验证命令改变了载荷，不能将结果认定为原加固方案的成功验证。' });
    await unchanged(plan);
    options.signal?.throwIfAborted();
    const after = await scanTarget(store, outputPayload, { rea: options.rea, signal: options.signal });
    const validationStatus = checks.some(c => c.status === 'failed') ? 'failed' as const : checks.some(c => c.status === 'not-run' || c.status === 'unknown') ? 'not-run' as const : 'passed' as const;
    const applied = { schemaVersion: 1 as const, kind: 'apply' as const, createdAt: now(), planId, scanId: plan.scanId, afterScanId: after.id,
      outputPath: outputPayload, outputSha256: after.record.target.sha256, approval, checks, validationStatus, requiresRepackaging: plan.target.format === 'asar' };
    const id = await store.save(applySchema, applied);
    const reports = await writeReport(store, id, applyMarkdown(applied, plan, after.record), '加固与复测报告');
    await writeFile(path.join(plan.outputPath, 'DEFENCEREA.json'), JSON.stringify({ applyId: id, outputSha256: applied.outputSha256, requiresRepackaging: applied.requiresRepackaging, validationStatus, checks }, null, 2), { flag: 'wx' });
    if (validationStatus === 'failed') await writeFile(path.join(plan.outputPath, 'VALIDATION_FAILED'), '验证失败，不应发布此产物。检查 DEFENCEREA.json 和详细报告。', { flag: 'wx' });
    await rm(path.join(plan.outputPath, 'INCOMPLETE'));
    published = true;
    return { id, record: applied, reports };
  } finally {
    // Only delete the staging directory that this invocation created inside its exclusively reserved output.
    await rm(staging, { recursive: true, force: true });
    if (!published) await writeFile(path.join(plan.outputPath, 'INCOMPLETE'), '执行失败或取消；目录保留供检查，不是可发布结果。').catch(() => {});
  }
}

export async function verifyApplied(store: Store, applyId: string, approve: HumanApprover, signal?: AbortSignal) {
  const applied = await store.read(applyId, applySchema);
  const plan = await store.read(applied.planId, planSchema);
  const current = await inventory(applied.outputPath);
  if (current.sha256 !== applied.outputSha256) fail('OUTPUT_CHANGED', '加固副本已变化；需要重新体检并生成验证方案。');
  if (!plan.commands.length) {
    const record = { schemaVersion: 1 as const, kind: 'verify' as const, createdAt: now(), applyId, outputSha256: current.sha256, checks: [{ name: 'runtime', status: 'not-run' as const, details: '未配置运行时命令，功能未验证。' }] };
    return { id: await store.save(verifySchema, record), record };
  }
  const approval = await approve({ id: applyId, digest: hash(canonical({ applyId, sha256: current.sha256, commands: plan.commands })), message: `重新运行验证命令需要新的用户确认。\n\n${planMarkdown(plan, applied.planId)}\n\n当前输出摘要：${current.sha256}` });
  if (!approval) fail('APPROVAL_REQUIRED', '用户未同意运行验证命令。');
  if ((await inventory(applied.outputPath)).sha256 !== current.sha256) fail('OUTPUT_CHANGED', '确认期间输出已变化。');
  const checks = await runCommands(plan.commands, applied.outputPath, plan.outputPath, signal);
  if ((await inventory(applied.outputPath)).sha256 !== current.sha256) checks.push({ name: 'validation-side-effects', status: 'failed', details: '验证命令改变了载荷。' });
  const record = { schemaVersion: 1 as const, kind: 'verify' as const, createdAt: now(), applyId, outputSha256: current.sha256, checks };
  return { id: await store.save(verifySchema, record), record };
}
