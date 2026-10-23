# ReaFence

[中文](README.md) · [Architecture](docs/architecture.md) · [Evaluation](docs/benchmark.md)

Local exposure checks and human-approved hardening for shipped JavaScript and Electron applications.

**Inspect → explain evidence → prepare a concrete plan → ask the human → write a separate copy → verify.**

The default record directory is now `~/.reafence`. Existing evidence is not rewritten; use `--store` to access a previous record directory. The source checkout's directory name does not need to match the package name.

Requires Node.js 24 LTS (24.11+) or 26+. No model account, telemetry, target upload, or native decompiler is required. The connected agent's model provider has its own data policy.

```sh
git clone https://github.com/flyl1u/ReaFence.git
cd ReaFence
npm ci --ignore-scripts
npm run build
node bin/reafence.mjs doctor
node bin/reafence.mjs scan examples/electron-app
node bin/reafence.mjs report <scan-id>
node bin/reafence.mjs plan <scan-id> --out /absolute/new/output --obfuscate calc.cjs
node bin/reafence.mjs apply <plan-id>
node bin/reafence.mjs compare <before-scan-id> <after-scan-id>
```

The package is not published to npm yet. Run the source checkout or build a local package with `npm pack`.

Scans accept a build directory or ASAR. They never execute target JavaScript, imports, or package scripts. REA 6.7.0 supplies application analysis; complete evidence stays in the local store while reports expose summaries. Rules find source maps, accidental source/test resources, credential candidates, request and Electron boundaries, and local authorization hints. Hints are not vulnerability proofs.

`plan` cleans first-party source maps by default. Other resource removal and obfuscation require individual file selection. Preload, third-party dependencies and license files are excluded from obfuscation. Conservative transforms disable global/property renaming, control-flow flattening, anti-debugging, dead-code injection and self-defending code.

`apply` requires a real interactive terminal and the user typing `APPLY`. MCP supports host-mediated elicitation, with expiring, single-use state bound to the plan and input digest. A host without elicitation must ask the user to run the interactive CLI. There is no `--yes` or model-supplied approval boolean. The host is trusted to present genuine human confirmation; this is not an OS-level boundary against an owner of the process.

Reports and outputs must be outside the input. Outputs must not exist. Directory payloads go to `<out>/app`; ASAR payloads go to `<out>/app.asar` with their unpacked companion. Rebuilt ASARs still need the original packaging, embedded integrity-hash update, and signing pipeline. HTML SRI bindings prevent direct transformation.

Optional JSON command arrays can be passed with `plan --commands <file>`. They are displayed to the human, run without a shell and with a timeout, and reruns require fresh approval. Commands are not sandboxed. Missing runtime tests are reported as `not-run`; failed checks produce exit code 2 and a `VALIDATION_FAILED` marker.

Register the stdio service in your host using `command: "node"` and `args: ["/absolute/checkout/bin/reafence.mjs", "mcp"]`. Seven tools provide environment checks, scanning, paged reports, plans, approved application, verification and comparison. Both legacy and modern MCP confirmation protocols are covered by integration tests.

```sh
npm run check
npm run test:rea
npm run test:mcp
npm run test:package
node node_modules/electron/install.js
npm run test:electron
```

Complete REA evidence may contain sensitive target content. Protect it as source code. Partial coverage, parser failures and tool errors never establish resistance to reverse engineering. The included benchmark command only validates and summarizes externally collected independent-session results; it does not run models or claim measured protection automatically.

MIT licensed. Dependencies retain their own licenses; see [notices](THIRD_PARTY_NOTICES.md). No affiliation with or endorsement by REA is implied.
