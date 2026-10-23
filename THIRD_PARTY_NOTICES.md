# Third-party notices

ReaFence's original code is MIT licensed. Dependencies are installed as separate npm packages; they are not bundled into the published JavaScript. Keep their original license and notice files when redistributing an installation.

| Component | Pinned version | License | Source |
| --- | --- | --- | --- |
| @babel/parser | 8.0.7 | MIT | https://github.com/babel/babel |
| @electron/asar | 4.3.1 | MIT | https://github.com/electron/asar |
| @modelcontextprotocol/client | 2.3.1 | Apache-2.0 | https://github.com/modelcontextprotocol/typescript-sdk |
| @modelcontextprotocol/server | 2.3.1 | Apache-2.0 | https://github.com/modelcontextprotocol/typescript-sdk |
| commander | 15.0.0 | MIT | https://github.com/tj/commander.js |
| javascript-obfuscator | 5.9.0 | BSD-2-Clause | https://github.com/javascript-obfuscator/javascript-obfuscator |
| rea-agents | 6.7.0 | MIT for REA-authored code | https://github.com/morluto/rea |
| zod | 4.6.7 | MIT | https://github.com/colinhacks/zod |

The lockfile identifies transitive dependencies. Each installed package retains its own notices. REA contains additional third-party notices and license texts under its own `THIRD_PARTY_NOTICES.md` and `licenses/`; its MIT license does not relicense those materials or grant access to commercial reverse engineering tools. This project does not require those commercial tools for the static JavaScript lane.

Development tools include TypeScript, Vitest, Node.js type declarations and Electron 45.0.0. Electron ships Chromium and other third-party software with their original notices. Electron is used only for tests and is not a runtime dependency of ReaFence.

All files under `examples/electron-app` were authored for ReaFence and are provided under this repository's MIT license. No third-party application is used as a shipped test target. No affiliation with REA or dependency authors is implied.
