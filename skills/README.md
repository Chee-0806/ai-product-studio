# 内置技能

技能（skill）是**可复用的工作流程**，不是需求文档，也不是产品知识库。

- 需要「怎么做」时读技能；
- 需要「做什么」时读 `product/PRD.md`；
- 两者冲突时，以 `AGENTS.md` 和 PRD 为准。

## 来源

- **Anthropic 官方 8 个**：来自 [anthropics/knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins) 的 `product-management` 插件（Apache-2.0），做了中文触发与本地落点适配。修改说明见 [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)。
- **本工位 3 个**：只补 Anthropic 没有覆盖的「PRD ↔ 静态 HTML 原型」一致性流程。

不重复造 PM 方法论；框架、检查清单和输出结构尽量沿用官方版本。

## 清单

### Anthropic 官方（已本地化）

| 技能 | 什么时候用 | 在本工位的落点 |
| --- | --- | --- |
| [`write-spec`](write-spec/SKILL.md) | 把想法/需求写成 PRD、用户故事、验收、范围 | `product/PRD.md` 的 REQ 块 |
| [`roadmap-update`](roadmap-update/SKILL.md) | 定一期范围、排优先级、砍需求、调路线图 | PRD 状态 + `STATE.md` |
| [`synthesize-research`](synthesize-research/SKILL.md) | 访谈、问卷、客服反馈太多，需要归纳 | `product/discovery/NNN-problem-brief.md` |
| [`stakeholder-update`](stakeholder-update/SKILL.md) | 周报/月报、向上汇报、发布公告、风险升级 | 默认对话输出 |
| [`product-brainstorming`](product-brainstorming/SKILL.md) | 探索机会、生成方案、挑战假设 | 对话发散，收敛后交给 `write-spec` |
| [`metrics-review`](metrics-review/SKILL.md) | 周/月/季度指标复盘、解释突增突降 | PRD 第 7 节指标；默认对话输出 |
| [`competitive-brief`](competitive-brief/SKILL.md) | 竞品分析、功能对比、定位、赢单/输单 | 默认对话输出 |
| [`sprint-planning`](sprint-planning/SKILL.md) | 排迭代、估容量、定 P0/stretch | 可选；本工位不管理研发排期 |

### 本工位自有

| 技能 | 什么时候用 | 产物 |
| --- | --- | --- |
| [`prototype`](prototype/SKILL.md) | 把已有 REQ 做成可点页面 | `prototype/screens/*.html` |
| [`review`](review/SKILL.md) | 评审 PRD、原型或两者一致性 | 必改 / 建议 / 未验证 |
| [`change`](change/SKILL.md) | 改已有需求、页面或文案 | 两边同步 + 版本 + 工作台 |

## 怎么被使用

- `AGENTS.md` 有技能路由：任务匹配时，AI 先读对应的 `SKILL.md`。
- 仓库保留 `.claude/skills` 入口（指向本目录），供 Claude Code 读取；其他工具直接读 `skills/<name>/SKILL.md`。
- 产品经理不需要记这些文件；AI 根据任务自行选择。

## 新增技能

1. 先找现成的：优先用 [Anthropic 官方技能](https://github.com/anthropics/knowledge-work-plugins)、[pmprompt](https://github.com/pmprompt/claude-plugin-product-management)（MIT）等成熟仓库，确认许可证。
2. 确实没有，再建 `skills/<name>/SKILL.md`；`name` 必须与目录名一致。
3. front matter：

   ```md
   ---
   name: <name>
   description: 当……时使用；一句话说明它解决什么问题。
   ---
   ```

4. 正文固定包含「什么时候用 / 输入 / 步骤 / 输出 / 不要做」。
5. 只写流程，不写具体产品需求；不要复制 `AGENTS.md` 的规则。
6. 一个技能只解决一类任务；正文控制在 120 行内。
7. 跑 `npm run check:skills`。

## 引入外部技能

- 记录来源仓库、固定 commit、许可证和修改点，写进 `THIRD_PARTY_NOTICES.md`。
- Apache-2.0 / MIT 可以引入；CC BY-NC-SA 等限制商用的许可证不要直接放进模板。
- 删除上游的连接器、斜杠命令依赖，补上本工位的文件落点。
- 在文件顶部保留来源与「已修改」声明。

## 不要

- 不要建「万能技能」；技能越具体，触发越稳定。
- 不要把 PRD 模板、竞品资料、会议记录塞进技能目录。
- 不要让技能定义新的需求状态或文件格式；这些以 `AGENTS.md` 为准。
- 不要抄一个技能却不记来源和许可证。
