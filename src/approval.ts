import { createInterface } from 'node:readline/promises';
import { stdin, stderr } from 'node:process';
import { fail } from './model.js';
import { maskText } from './util.js';
import type { HumanApprover } from './harden.js';

export const terminalApprover: HumanApprover = async request => {
  if (!stdin.isTTY || !stderr.isTTY) fail('HUMAN_APPROVAL_REQUIRED', '需要真实交互式终端确认；管道、重定向和 --yes 均不能代替用户同意。');
  stderr.write(`${maskText(request.message)}\n计划摘要：${request.digest}\n`);
  const prompt = createInterface({ input: stdin, output: stderr });
  try {
    const answer = await prompt.question('同意以上准确的操作及验证命令？请输入 APPLY，其他输入均取消：');
    return answer.trim() === 'APPLY' ? 'terminal' : undefined;
  } finally { prompt.close(); }
};
