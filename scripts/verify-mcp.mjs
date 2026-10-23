import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const root = await mkdtemp(path.join(os.tmpdir(), 'defencerea-mcp-'));
const cli = fileURLToPath(new URL('../bin/defencerea.mjs', import.meta.url));
try {
  const input = path.join(root, 'owned-fixture');
  await mkdir(input);
  await writeFile(path.join(input, 'main.js'), 'module.exports = 42;\n//# sourceMappingURL=main.js.map');
  await writeFile(path.join(input, 'main.js.map'), '{"version":3,"sources":["original.js"],"mappings":""}');
  for (const mode of ['legacy', 'auto']) {
    const transport = new StdioClientTransport({ command: process.execPath, args: [cli, '--store', path.join(root, `store-${mode}`), 'mcp'], stderr: 'pipe' });
    transport.stderr?.on('data', () => {});
    const client = new Client({ name: 'defencerea-integration-tests', version: '0.1.0' }, { capabilities: { elicitation: { form: {} } }, versionNegotiation: { mode } });
    let confirmations = 0;
    // This is a protocol test against a fixture authored here, not approval for a user's application.
    client.setRequestHandler('elicitation/create', async () => { confirmations++; return { action: 'accept', content: { confirm: true } }; });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert.equal(tools.tools.length, 7);
      const scan = await client.callTool({ name: 'scan_target', arguments: { path: input, rea: false } });
      assert.ok(!scan.isError, JSON.stringify(scan));
      const plan = await client.callTool({ name: 'prepare_hardening', arguments: { scanId: scan.structuredContent.id, output: path.join(root, `output-${mode}`) } });
      assert.ok(!plan.isError, JSON.stringify(plan));
      const result = await client.callTool({ name: 'apply_hardening', arguments: { planId: plan.structuredContent.id, rea: false } });
      assert.ok(!result.isError, JSON.stringify(result));
      assert.equal(confirmations, 1);
      console.log(JSON.stringify({ protocol: mode, result: 'passed', userConfirmationExchanges: confirmations }));
    } finally { await client.close(); }
  }
} finally { await rm(root, { recursive: true, force: true }); }
