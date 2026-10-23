# 架构与接口

## 分层

```text
CLI / MCP → 共享服务 → 目标读取 / REA 适配 / 规则 / 加固 / 验证 / 报告
                    ↓
                 本地 Store
```

单包 TypeScript ESM。`src/index.ts` 导出只读体检、计划生成、比较和记录查询；加固与运行命令必须从 CLI 或 MCP 的用户确认适配层进入。

REA 固定为 6.7.0，通过官方 SDK 以 stdio 子进程启动。分析使用 `analyze_javascript_application` 的 summary 模式，本地导出完整会话证据；不导入 REA 内部模块。应用/语义覆盖来自应用摘要，不能使用“摘要分页已完成”替代源分析完整性。

## MCP 工具

| 工具 | 主要输入 | 返回 |
| --- | --- | --- |
| doctor | 无 | 版本、能力和限制 |
| scan_target | path, rea=true | scan ID、发现数、覆盖、报告路径 |
| get_report | id, offset=0, limit=25 | 发现/动作分页或执行/验证记录 |
| prepare_hardening | scanId, output, remove=[], obfuscate=[], environment=node, commands=[] | plan ID、动作数、方案报告 |
| apply_hardening | planId, rea=true | 用户确认请求，或 apply ID、outputPath、afterScanId、验证结果 |
| verify_hardening | applyId | 必要时重新请求用户确认，再返回 verify ID 和检查结果 |
| compare_reports | beforeId, afterId | compare ID 和对比报告 |

所有输入对象拒绝额外属性。不存在 approved / autoApprove 参数。工具返回目标内容时携带不可信来源标记，错误也携带。MCP stdout 只输出协议数据。

## 记录

记录类型为 scan、plan、apply、verify、compare，均有 `schemaVersion: 1` 和 UTC 创建时间。ID 为 `<kind>_<canonical-record-sha256>`；读取时同时校验摘要和 Zod schema。记录中的输入摘要包含文件名、类型、字节摘要和可执行／unpacked 信息，ASAR 还绑定容器字节摘要。

Scan 分别存储 `ruleCoverage`、REA 覆盖和保守合并的全局 `coverage`。Finding 有规则 ID、严重程度、observed/inferred/unknown、位置、证据、影响、建议和可选动作。没有武断的综合“防逆向分数”。

Plan 固定输入、输出、动作、混淆环境、种子和验证命令。Apply 记录原/后体检、输出摘要、确认渠道、每项检查、`validationStatus` 和是否需重新打包。`not-run` 不会被显示成功能通过。

本地 Store 默认为用户主目录下 `.reafence`。每条记录目录包含 `record.json`，体检/方案/对比还包含离线 HTML 和 Markdown。完整证据单独放在 `evidence-*` 目录并记录摘要。

## 确认与失败

MCP 用 SDK 的 input_required / elicitation，自动兼容旧协议确认请求。requestState 使用进程内随机密钥 HMAC、十分钟有效期、连接上下文绑定；另有一次性 nonce 表。响应必须与操作、记录 ID 和计划摘要匹配。服务器重启后未完成确认失效。

用户确认后重新检查输入与输出解析位置；复制每个文件时再检查内容摘要。输出根目录以排他创建方式保留，所有工作在新目录内完成。结构错误或取消保留 INCOMPLETE，验证失败另标记 VALIDATION_FAILED。

只读体检不运行目标。可选命令只来自计划中的明确配置，不经 shell，并设置超时、进程树清理及输出字节限制。命令改变载荷也判定验证失败。

ASAR 重建保留普通文件和目录、可执行标记及逐文件 unpacked 布局，重新计算包内哈希。外部可执行签名与嵌入哈希由原构建流程处理。HTML SRI 绑定直接拒绝修改。
