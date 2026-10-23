# 如何评测逆向成本

体检发现减少不等同于逆向成本增加。项目提供结果校验和汇总脚本，不在后台调用模型、创建账号、开启付费任务或执行未知重建代码。

## 实验流程

1. 选择自有样例，固定原版和加固版载荷 SHA256。使用工具生成的应用载荷，保存 plan、apply 和两份 scan 记录。
2. 编写固定任务，例如：“仅分析指定目录，恢复 `total(price, count)` 的输入校验与计算行为，提交独立实现及证据。”固定模型版本、参数、REA 版本、时间和 Token 预算。
3. 每种载荷运行三次，每次创建全新会话。分析会话只能访问当次载荷；不能访问另一版、源仓库、方案、历史聊天或验收答案。
4. 在另行准备的隔离环境中，用相同的未公开测试输入验收恢复实现。记录通过用例数，不用“Agent 说自己理解了”作为成功标准。
5. 保存独立会话引用、耗时、宿主提供的 Token 数和工具错误。无法取得 Token 时填 null，不估算。保留预算耗尽和错误尝试，不选择性丢弃。

仓库的 Electron 示例用于功能回归，验收答案公开，不适合作为有说服力的保密算法评测。真实评测应使用新的自有样例与独立留出用例。

## 记录格式

创建 JSON，包含下面的实验信息及六个 run（两种 variant 各 repetition 1、2、3）：

```json
{
  "schemaVersion": 1,
  "task": "恢复自有样例的 total 行为",
  "taskSha256": "<64 位任务文本摘要>",
  "model": "<固定模型版本>",
  "modelSettings": "<固定参数>",
  "toolsVersion": "REA 6.7.0 / ReaFence 0.1.0",
  "timeBudgetMs": 600000,
  "tokenBudget": 20000,
  "runs": [
    {
      "variant": "original",
      "repetition": 1,
      "payloadSha256": "<64 位载荷摘要>",
      "elapsedMs": 120000,
      "tokens": null,
      "passedCases": 0,
      "totalCases": 100,
      "outcome": "completed",
      "freshSession": true,
      "transcriptReference": "<独立会话记录引用>",
      "grading": "externally-verified"
    }
  ]
}
```

占位符和单条 run 仅说明格式，不能直接作为有效实验记录。`variant` 为 original 或 hardened；outcome 为 completed、budget-exhausted 或 error。timeBudgetMs、modelSettings 和任务摘要用于审阅，汇总器无法证明它们在外部会话被实际遵守。

```powershell
npm run build
npm run benchmark -- D:\evaluations\records.json
```

脚本验证重复数、独立记录引用、每组载荷一致性、验收数量与可用 Token 预算，再输出两组平均耗时、Token、通过比例及错误数。它不会执行会话引用或代码，也不能替代对原始记录的审查。结果不自动进入“防护成功”判断。

## 发布实测结论

同时展示功能与性能回归、原始实验条件、全部六次结果、工具错误和覆盖缺口。三次重复只能给出小样本观察。没有真实外部实验前，只能声称“具备体检、加固与评测记录能力”，不能声称已提高某个百分比的逆向成本。
