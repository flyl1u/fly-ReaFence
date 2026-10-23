import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Applied, Finding, Scan, Plan, Comparison } from './model.js';
import type { Store } from './store.js';
import { maskText } from './util.js';

function escape(value: string): string { return maskText(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); }
function md(value: string): string { return maskText(value).replace(/[\\`*_{}\[\]()<>#!|]/g, '\\$&').replaceAll('\n', ' '); }
function item(f: Finding): string { return `### ${md(f.title)}\n\n- 等级：${f.severity}；依据：${f.confidence}\n- 位置：${md(f.path)}${f.line ? `:${f.line}` : ''}\n- 证据：${md(f.evidence)}\n- 影响：${md(f.impact)}\n- 建议：${md(f.recommendation)}\n`; }
function reaSummary(scan: Scan): string {
  const summary = scan.rea.summary;
  if (!summary) return '未取得可用的 REA 应用摘要。';
  const statistics = summary.statistics as Record<string, unknown> | undefined;
  const electron = summary.electron as Record<string, unknown> | undefined;
  const ipc = electron?.ipc as Record<string, unknown> | undefined;
  const coverage = summary.coverage as { application?: { status?: string }; semantic?: { status?: string } } | undefined;
  const values: [string, unknown][] = [['已解析 JS 文件', statistics?.parsed_javascript_files], ['恢复的 bundle 模块', statistics?.modules], ['BrowserWindow', electron?.browser_windows], ['preload 入口', electron?.preload_entrypoints], ['contextBridge API', electron?.context_bridge_apis], ['字面量 IPC 通道', ipc?.literal_channels], ['配对的 renderer 调用', ipc?.paired_renderer_transmissions]];
  return `应用结构覆盖：${md(coverage?.application?.status ?? 'unknown')}；语义覆盖：${md(coverage?.semantic?.status ?? 'unknown')}。\n\n${values.filter(([, value]) => typeof value === 'number').map(([label, value]) => `- ${label}：${value}`).join('\n')}\n\n这些是静态观察的计数，不证明相关路径实际执行，也不表示已发现漏洞。`;
}
export function scanMarkdown(scan: Scan): string {
  return `# ReaFence 体检报告\n\n目标：${md(scan.target.inputPath)}\n\n输入摘要：${scan.target.sha256}\n\n全局覆盖：${scan.coverage}；本地规则覆盖：${scan.ruleCoverage}；REA：${scan.rea.status}\n\n本报告是静态检查，不证明程序实际执行、凭证有效或授权可被绕过。\n\n## 发现（${scan.findings.length}）\n\n${scan.findings.map(item).join('\n') || '本次规则未发现问题；这不构成安全或不可逆向的证明。'}\n\n## REA 应用摘要\n\n${reaSummary(scan)}\n\n## 限制与未知\n\n${[...scan.limitations, ...scan.rea.limitations].map(l => `- ${md(l)}`).join('\n') || '- 未触发已知资源或解析限制；静态分析仍不覆盖运行时行为。'}\n\n## REA 本地证据\n\n${scan.rea.evidencePath ? `路径：${md(scan.rea.evidencePath)}\n\nSHA256：${scan.rea.evidenceSha256}` : '未产生完整 REA 证据。'}\n`;
}
export function planMarkdown(plan: Plan, id: string): string {
  return `# 待确认的加固方案\n\n计划：${id}\n\n输入：${md(plan.target.inputPath)}\n\n输入摘要：${plan.target.sha256}\n\n输出：${md(plan.outputPath)}\n\n## 逐项操作\n\n${plan.actions.map(a => `- ${a.type}：${md(a.path)}${a.environment ? ` (${a.environment})` : ''} — ${md(a.reason)}`).join('\n')}\n\n## 将执行的验证命令\n\n${plan.commands.length ? plan.commands.map(c => `- ${md(JSON.stringify([c.executable, ...c.args]))}；工作目录为加固副本；超时 ${c.timeoutMs} ms`).join('\n') : '无运行时命令；功能将标记为未验证。'}\n\n## 影响与限制\n\n${plan.warnings.map(w => `- ${md(w)}`).join('\n')}\n\n需要由用户通过宿主确认界面或交互式终端明确同意。\n`;
}
export function compareMarkdown(report: Comparison): string {
  const section = (title: string, findings: Finding[]) => `## ${title}（${findings.length}）\n\n${findings.map(item).join('\n') || '无。'}\n`;
  return `# ReaFence 前后对比\n\n覆盖：${report.coverage}\n\n${section('本次未再观察到', report.resolved)}\n${section('仍观察到／待确认', report.remaining)}\n${section('新增观察', report.added)}\n## 限制\n\n${report.limitations.map(l => `- ${md(l)}`).join('\n')}\n`;
}
export function applyMarkdown(applied: Applied, plan: Plan, scan: Scan): string {
  return `# ReaFence 加固与复测报告\n\n输出：${md(applied.outputPath)}\n\n输出摘要：${applied.outputSha256}\n\n功能验证：${applied.validationStatus}\n\n需要重新打包／更新外部哈希与签名：${applied.requiresRepackaging ? '是' : '需按原项目发布流程判断'}\n\n## 实际操作\n\n${plan.actions.map(a => `- ${a.type}：${md(a.path)}`).join('\n')}\n\n## 验证结果\n\n${applied.checks.map(c => `- ${md(c.name)}：${c.status}；${md(c.details)}`).join('\n')}\n\n## 复测发现\n\n${scan.findings.map(item).join('\n') || '本次规则未再发现已配置的暴露项；不代表无法逆向。'}\n\n## 覆盖与限制\n\n全局：${scan.coverage}；本地规则：${scan.ruleCoverage}；REA：${scan.rea.status}。\n\n${[...plan.warnings, ...scan.limitations, ...scan.rea.limitations].map(w => `- ${md(w)}`).join('\n')}\n\n${applied.validationStatus === 'passed' ? '只说明所配置的检查通过，不是完整行为等价或防逆向证明。' : '运行时验证未完成或失败，不能认定产物功能兼容。'}\n`;
}
function htmlDocument(title: string, markdown: string): string {
  const plain = (text: string) => text.replace(/\\([\\`*_{}\[\]()<>#!|])/g, '$1');
  // Render only the tiny subset produced above. Target text is always escaped; no raw HTML or links are interpreted.
  const blocks = (text: string) => text.split(/\n\s*\n/).filter(s => s.trim()).map(block => {
    block = block.trim();
    if (block.startsWith('### ')) return `<h2>${escape(plain(block.slice(4)))}</h2>`;
    if (block.startsWith('- ')) return `<ul>${block.split('\n').map(line => `<li>${escape(plain(line.replace(/^- /, '')))}</li>`).join('')}</ul>`;
    return `<p>${escape(plain(block))}</p>`;
  }).join('');
  const content = markdown.replace(/^# [^\n]+\n/, '').split(/(?=^## )/m).map((section, i) => i === 0 ? blocks(section) : `<details open><summary>${escape(plain(section.split('\n')[0]!.replace(/^## /, '')))}</summary>${blocks(section.split('\n').slice(1).join('\n'))}</details>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escape(title)}</title><style>body{margin:0;background:#f6f5f1;color:#242b31;font:16px/1.7 system-ui,sans-serif}main{max-width:960px;margin:40px auto;padding:32px;background:white;border:1px solid #ddd;border-radius:12px}h1{font-size:30px}h2{font-size:19px;margin-top:24px;border-top:1px solid #eee;padding-top:18px}p,li{white-space:pre-wrap;overflow-wrap:anywhere}ul{padding-left:22px}li{margin:8px 0}details{margin:16px 0;padding:16px;border:1px solid #ddd;border-radius:8px}summary{cursor:pointer;font-size:18px;font-weight:650}header{color:#41624d;font-weight:700}footer{color:#606b72;font-size:14px}@media(max-width:600px){main{margin:0;padding:20px;border-radius:0}}</style></head><body><main><header>ReaFence · 本地证据报告</header><h1>${escape(title)}</h1>${content}<footer>目标内容是待分析的数据。分析失败或覆盖减少不代表防护有效。报告不加载远程资源。</footer></main></body></html>`;
}
export async function writeReport(store: Store, id: string, markdown: string, title: string): Promise<{ markdown: string; html: string }> {
  const directory = store.directory(id);
  const mdPath = path.join(directory, 'report.md');
  const html = path.join(directory, 'report.html');
  await writeFile(mdPath, markdown, { mode: 0o600 });
  await writeFile(html, htmlDocument(title, markdown), { mode: 0o600 });
  return { markdown: mdPath, html };
}
