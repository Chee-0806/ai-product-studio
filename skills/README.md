# 技能

技能（skill）是**可复用的工作流程**，不是需求文档，也不是产品知识库。

- 需要「怎么做」时读技能；
- 需要「做什么」时读 `product/PRD.md`；
- 两者冲突时，以 `AGENTS.md` 和 PRD 为准。

## 两层：核心技能 + 可选内容包

- **核心技能**默认安装，在 `skills/` 里，只有 3 个，负责本工位的 PRD ↔ 原型一致性流程。
- **可选内容包**放在 `packs/`，默认不安装，不参与路由，也不会被 `.claude/skills` 发现。需要时再装进 `skills/`。

```bash
npm run pack:list
npm run pack:add -- pm-methods
npm run pack:remove -- pm-methods
```

## 核心技能（默认安装）

| 技能 | 什么时候用 | 产物 |
| --- | --- | --- |
| [`prototype`](prototype/SKILL.md) | 把已有 REQ 做成可点页面 | `prototype/screens/*.html` 或 `screens.json` + SPA 入口 |
| [`review`](review/SKILL.md) | 评审 PRD、原型或两者一致性 | 必改 / 建议 / 未验证 |
| [`change`](change/SKILL.md) | 改已有需求、页面或文案 | 两边同步 + 版本 + 工作台 |

## 可选内容包：pm-methods

8 个 Anthropic 官方产品方法技能，来自 [anthropics/knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins) 的 `product-management` 插件（Apache-2.0），做了中文触发与本地落点适配。

| 技能 | 什么时候用 | 在本工位的落点 |
| --- | --- | --- |
| `write-spec` | 把想法/需求写成 PRD、用户故事、验收、范围 | `product/PRD.md` 的 REQ 块 |
| `roadmap-update` | 定一期范围、排优先级、砍需求、调路线图 | PRD 状态 + `STATE.md` |
| `synthesize-research` | 访谈、问卷、客服反馈太多，需要归纳 | `product/discovery/NNN-problem-brief.md` |
| `stakeholder-update` | 周报/月报、向上汇报、发布公告、风险升级 | 默认对话输出 |
| `product-brainstorming` | 探索机会、生成方案、挑战假设 | 对话发散，收敛后交给 `write-spec` |
| `metrics-review` | 周/月/季度指标复盘、解释突增突降 | PRD 指标节；默认对话输出 |
| `competitive-brief` | 竞品分析、功能对比、定位、赢单/输单 | 默认对话输出 |
| `sprint-planning` | 排迭代、估容量、定 P0/stretch | 可选；本工位不管理研发排期 |

安装后，它们和核心技能一样被 `npm run check` 校验、被 `.claude/skills` 发现。来源、固定 commit、修改说明见 [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)，内容包说明见 [`../packs/pm-methods/README.md`](../packs/pm-methods/README.md)。

## 怎么被使用

- `AGENTS.md` 有技能路由：核心技能直接路由；可选包只在 `skills/` 下存在对应目录时才路由。
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

如果是一组可选的成熟方法，不要直接塞进核心 `skills/`，新建 `packs/<name>/` 内容包。

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
- 不要默认安装一整套方法包；先保证核心 3 个技能稳定。
