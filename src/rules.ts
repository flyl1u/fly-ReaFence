import { parse } from '@babel/parser';
import path from 'node:path';
import type { Finding, Target } from './model.js';
import { hash, maskText } from './util.js';
import { MAX_TEXT_BYTES, readEntry } from './target.js';

type Node = { type?: string; [key: string]: unknown };
export function parseJavaScript(text: string, filename: string) {
  return parse(text, { sourceType: 'unambiguous', plugins: /\.[cm]?tsx?$/.test(filename) ? ['typescript', 'jsx'] : ['jsx'], errorRecovery: false });
}
export function sourceMapComments(text: string, filename: string): { start: number; end: number; line: number }[] {
  return (parseJavaScript(text, filename).comments ?? []).filter(c => /[#@]\s*sourceMappingURL\s*=/.test(c.value) && c.start !== undefined && c.end !== undefined).map(c => ({ start: c.start!, end: c.end!, line: c.loc?.start.line ?? 1 }));
}
function name(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as Node;
  if (typeof n.name === 'string') return n.name;
  if (typeof n.value === 'string') return n.value;
  if (n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') return `${name(n.object)}.${name(n.property)}`;
  return '';
}
function line(node: Node): number {
  return ((node.loc as { start?: { line?: number } } | undefined)?.start?.line) ?? 1;
}
function isSourceMap(value: unknown): value is { sourcesContent?: unknown[]; sources?: unknown[] } {
  return Boolean(value && typeof value === 'object' && (value as { version?: unknown }).version === 3 && ('mappings' in value || 'sections' in value));
}
function safeEndpoint(value: string): string {
  try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return value.split(/[?#]/)[0]?.slice(0, 120) ?? '[endpoint]'; }
}

export async function analyzeRules(target: Target): Promise<{ findings: Finding[]; limitations: string[] }> {
  const findings: Finding[] = [];
  const limitations: string[] = [...target.limitations];
  const seen = new Set<string>();
  const add = (input: Omit<Finding, 'id'>) => {
    const key = `${input.rule}:${input.path}:${input.line ?? 0}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ ...input, evidence: maskText(input.evidence).slice(0, 400), id: `f_${hash(key).slice(0, 24)}` });
  };
  for (const file of target.files) {
    if (file.kind !== 'file') continue;
    const base = path.posix.basename(file.path);
    if (/^\.env(?:\.|$)/i.test(base) && base !== '.env.example') {
      add({ rule: 'PACKAGED_ENV', title: '发布产物包含环境文件', severity: 'high', confidence: 'observed', path: file.path,
        evidence: '文件清单包含环境文件；未展示其内容。', impact: '可能泄露服务端配置或凭证，实际敏感性需人工确认。', recommendation: '确认运行时不依赖该文件后，逐项选择移出发布产物；已泄露凭证需要轮换。', action: 'remove-file' });
    }
    if (/(^|\/)(?:test|tests|__tests__|src)\/|\.(?:test|spec)\.[cm]?js$|\.[cm]?tsx?$/.test(file.path) && !file.path.includes('node_modules/')) {
      add({ rule: 'SOURCE_RESOURCE', title: '发布产物包含源码或测试资源候选', severity: 'low', confidence: 'inferred', path: file.path,
        evidence: '文件路径或扩展名符合源码/测试资源模式；未证明运行时不需要它。', impact: '可能提供实现细节和测试输入。', recommendation: '核对构建规则与运行时引用，再逐项选择是否删除。', action: 'remove-file' });
    }
    if (!/\.(?:[cm]?jsx?|[cm]?tsx?|map|json|pem|key|html|css|txt)$/i.test(file.path) && !/^\.env/.test(base)) continue;
    if (file.size > MAX_TEXT_BYTES) { limitations.push(`未分析超过 4 MiB 的文本文件：${file.path}`); continue; }
    const text = (await readEntry(target, file.path)).toString('utf8');
    if (/-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----/.test(text)) {
      add({ rule: 'PRIVATE_KEY', title: '发现私钥格式文本', severity: 'high', confidence: 'observed', path: file.path,
        evidence: '[PRIVATE KEY REDACTED]', impact: '私钥格式内容随产物分发；可能造成身份或签名密钥泄露。', recommendation: '核查用途、移除并轮换真实密钥；不要只做混淆。', action: 'review' });
    }
    if (/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b|(?:password|secret|api[_-]?key|token)\s*[=:]\s*["'][^"'\r\n]{12,}["']/i.test(text)) {
      add({ rule: 'CREDENTIAL_CANDIDATE', title: '发现疑似硬编码凭证', severity: 'high', confidence: 'inferred', path: file.path,
        evidence: '[CREDENTIAL CANDIDATE REDACTED]；仅本地模式匹配，未验证凭证有效性。', impact: '若为真实凭证，发布后可被提取；混淆不能使客户端凭证安全。', recommendation: '人工确认并轮换真实凭证，将长期秘密迁移到服务端。', action: 'review' });
    }
    if (file.path.endsWith('.map')) {
      try {
        const map: unknown = JSON.parse(text);
        if (isSourceMap(map)) {
          const embedded = map.sourcesContent?.some(s => typeof s === 'string' && s.length > 0);
          add({ rule: 'SOURCE_MAP', title: embedded ? '源码映射包含原始源码' : '发布产物包含源码映射', severity: embedded ? 'high' : 'medium', confidence: 'observed', path: file.path,
            evidence: `Source Map v3；${map.sources?.length ?? 0} 个来源；原始源码内容${embedded ? '存在' : '未在该层发现'}。`, impact: '可帮助恢复原始文件名、位置和代码结构。', recommendation: '从公开发布副本中移除，内部错误监控可单独保存。', action: 'remove-sourcemap' });
        }
      } catch { limitations.push(`无法解析映射文件：${file.path}`); }
      continue;
    }
    if (!/\.[cm]?[jt]sx?$/i.test(file.path)) continue;
    try {
      const ast = parseJavaScript(text, file.path);
      for (const comment of ast.comments ?? []) {
        if (/[#@]\s*sourceMappingURL\s*=/.test(comment.value)) {
          add({ rule: 'SOURCE_MAP_REFERENCE', title: '代码包含源码映射引用', severity: 'medium', confidence: 'observed', path: file.path, line: comment.loc?.start.line ?? 1,
            evidence: /data:/.test(comment.value) ? '注释中包含内联 sourceMappingURL。' : '注释中包含外部 sourceMappingURL；未获取远程资源。', impact: '映射引用可能直接提供原始源码，或定位调试资源。', recommendation: '在发布副本中移除映射注释及对应公开映射。', action: 'remove-sourcemap' });
        }
      }
      const stack: { node: unknown; depth: number }[] = [{ node: ast, depth: 0 }];
      let visits = 0;
      while (stack.length) {
        const { node, depth } = stack.pop()!;
        if (!node || typeof node !== 'object') continue;
        if (++visits > 200_000 || depth > 256) { limitations.push(`AST 遍历达到资源边界：${file.path}`); break; }
        if (Array.isArray(node)) { for (const item of node) stack.push({ node: item, depth: depth + 1 }); continue; }
        const n = node as Node;
        if (n.type === 'ObjectProperty' && ((name(n.key) === 'nodeIntegration' && (n.value as Node)?.value === true) || (name(n.key) === 'contextIsolation' && (n.value as Node)?.value === false))) {
          add({ rule: 'ELECTRON_OPTION_CANDIDATE', title: '发现需复核的 Electron 配置候选', severity: 'medium', confidence: 'inferred', path: file.path, line: line(n),
            evidence: `显式属性 ${name(n.key)}；未证明对象用于 BrowserWindow，需结合 REA 关系确认。`, impact: '若用于窗口配置，可能扩大 renderer 到主机能力的访问边界。', recommendation: '人工检查窗口配置、preload 和 IPC 校验；不自动改写。', action: 'review' });
        }
        if (n.type === 'CallExpression') {
          const callee = name(n.callee);
          const args = n.arguments as Node[] | undefined;
          const first = args?.[0];
          if (/^(?:fetch|axios(?:\.(?:get|post|put|delete))?|https?\.(?:get|request))$/.test(callee) && typeof first?.value === 'string') {
            add({ rule: 'ENDPOINT_SURFACE', title: '发现静态请求入口', severity: 'info', confidence: 'observed', path: file.path, line: line(n),
              evidence: `${callee}(${safeEndpoint(first.value)})；未证明调用执行，也未检查服务端权限。`, impact: '提供功能追踪线索；接口地址公开本身不构成漏洞。', recommendation: '确认服务端鉴权与限流；不要把隐藏 URL 当作权限控制。', action: 'review' });
          }
          if (/^(?:ipcMain|ipcRenderer)\.(?:handle|on|send|invoke)$/.test(callee) || callee === 'contextBridge.exposeInMainWorld') {
            add({ rule: 'ELECTRON_BOUNDARY', title: '发现 Electron 跨进程入口', severity: 'info', confidence: 'inferred', path: file.path, line: line(n),
              evidence: `${callee}；名称匹配仅为候选，REA 可提供词法来源和跨层关系。`, impact: '可辅助定位功能实现和进程边界，不代表存在漏洞。', recommendation: '审查调用来源、参数校验和最小暴露 API。', action: 'review' });
          }
        }
        if ((n.type === 'Identifier' || n.type === 'StringLiteral') && /^(?:isPro|isPremium|checkLicense|verifyLicense|licenseValid|subscriptionActive)$/i.test(name(n))) {
          add({ rule: 'LOCAL_AUTH_CANDIDATE', title: '发现本地授权逻辑线索', severity: 'medium', confidence: 'inferred', path: file.path, line: line(n),
            evidence: `标识符/字面量 ${name(n)}；不能据此证明授权完全由客户端控制。`, impact: '可能帮助定位付费或许可分支，需要追踪服务端校验关系。', recommendation: '结合 REA 追踪并人工核实；重要权益应由可信服务端验证。', action: 'review' });
        }
        for (const [key, child] of Object.entries(n)) if (!['loc', 'start', 'end', 'extra', 'comments', 'leadingComments', 'trailingComments', 'innerComments', 'tokens'].includes(key) && child && typeof child === 'object') stack.push({ node: child, depth: depth + 1 });
      }
    } catch { limitations.push(`JavaScript 语法分析失败：${file.path}；该文件的 AST 规则未知。`); }
  }
  return { findings, limitations: [...new Set(limitations)] };
}
