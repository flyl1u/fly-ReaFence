import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, expect, test } from 'vitest';
import path from 'node:path';
import { fixture } from './helpers.js';
import { createMcpServer } from '../src/mcp.js';
import { Store } from '../src/store.js';
import { exists } from '../src/util.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); });

async function session(confirmation?: boolean) {
  const f = await fixture({ 'main.js': 'module.exports = 42;\n//# sourceMappingURL=main.js.map', 'main.js.map': '{"version":3,"sources":["main.ts"],"mappings":""}' });
  cleanups.push(f.cleanup);
  const server = createMcpServer(new Store(f.store));
  const client = new Client({ name: 'defencerea-tests', version: '0.1.0' }, { capabilities: confirmation === undefined ? {} : { elicitation: { form: {} } } });
  if (confirmation !== undefined) client.setRequestHandler('elicitation/create', async () => ({ action: 'accept', content: { confirm: confirmation } }));
  const [left, right] = InMemoryTransport.createLinkedPair();
  await server.connect(right); await client.connect(left);
  cleanups.push(async () => { await client.close(); await server.close(); });
  const scan = await client.callTool({ name: 'scan_target', arguments: { path: f.input, rea: false } });
  const scanId = (scan.structuredContent as { id: string }).id;
  const output = path.join(f.root, 'hardened');
  const plan = await client.callTool({ name: 'prepare_hardening', arguments: { scanId, output } });
  return { ...f, client, output, planId: (plan.structuredContent as { id: string }).id };
}

test('MCP refuses hosts without user elicitation and never trusts approved=true', async () => {
  const f = await session();
  const unsupported = await f.client.callTool({ name: 'apply_hardening', arguments: { planId: f.planId, rea: false } });
  expect(unsupported.isError).toBe(true);
  expect(JSON.stringify(unsupported)).toContain('HUMAN_APPROVAL_REQUIRED');
  const forged = await f.client.callTool({ name: 'apply_hardening', arguments: { planId: f.planId, rea: false, approved: true } });
  expect(forged.isError).toBe(true);
  expect(await exists(f.output)).toBe(false);
});

test('MCP user decline leaves no output', async () => {
  const f = await session(false);
  const declined = await f.client.callTool({ name: 'apply_hardening', arguments: { planId: f.planId, rea: false } });
  expect(declined.isError).toBe(true);
  expect(await exists(f.output)).toBe(false);
});

test('MCP routes human confirmation through elicitation before applying', async () => {
  const f = await session(true);
  const applied = await f.client.callTool({ name: 'apply_hardening', arguments: { planId: f.planId, rea: false } });
  expect(applied.isError, JSON.stringify(applied)).not.toBe(true);
  expect((applied.structuredContent as { outputPath: string } | undefined)?.outputPath).toBe(path.join(f.output, 'app'));
  expect(await exists(path.join(f.output, 'app', 'main.js'))).toBe(true);
  expect(await exists(path.join(f.output, 'app', 'main.js.map'))).toBe(false);
});
