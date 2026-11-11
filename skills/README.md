# 内置技能

技能（skill）是**可复用的工作流程**，不是需求文档，也不是产品知识库。

- 需要「怎么做」时读技能；
- 需要「做什么」时读 `product/PRD.md`；
- 两者冲突时，以 `AGENTS.md` 和 PRD 为准。

## 怎么被使用

- `AGENTS.md` 里有技能路由：任务匹配时，AI 先读对应的 `SKILL.md`。
- 仓库保留 `.claude/skills` 入口（指向本目录），供 Claude Code 读取；其他工具直接读 `skills/<name>/SKILL.md`。

产品经理不需要记这些文件；AI 根据任务自行选择。

## 清单

| 技能 | 什么时候用 | 产物 |
| --- | --- | --- |
| [`discovery`](discovery/SKILL.md) | 只有模糊想法、访谈记录或一句需求 | 问题定义与证据 |
| [`scope`](scope/SKILL.md) | 范围太大、要定一期做什么 | MVP 取舍表 |
| [`prd`](prd/SKILL.md) | 新增或修改一条需求 | PRD 的 REQ 块 |
| [`prototype`](prototype/SKILL.md) | 把需求做成可点的页面 | `prototype/screens/*.html` |
| [`review`](review/SKILL.md) | 评审 PRD、原型或两者的一致性 | 必改 / 建议 / 未验证 |
| [`change`](change/SKILL.md) | 改已有需求、页面或文案 | 两边同步 + 版本 + 工作台 |

## 新增技能

1. 建目录 `skills/<name>/`，文件名必须是 `SKILL.md`。
2. 开头写 front matter：

   ```md
   ---
   name: <name>
   description: 当……时使用；一句话说明它解决什么问题。
   ---
   ```

3. `name` 必须与目录名一致，小写英文/数字/短横线。
4. 正文固定包含「什么时候用 / 输入 / 步骤 / 输出 / 不要做」。
5. 只写流程，不写具体产品需求；不要复制 `AGENTS.md` 的规则。
6. 一个技能只解决一类任务；超过 100 行就拆分或删减。
7. 跑 `npm run check:skills`。

## 不要

- 不要建「万能技能」；技能越具体，触发越稳定。
- 不要把 PRD 模板、竞品资料、会议记录塞进技能目录。
- 不要让技能定义新的需求状态或文件格式；这些以 `AGENTS.md` 为准。
