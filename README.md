# AI 产品设计工位

一个可复用的产品原型模板工程：**PRD 与 HTML 原型放在同一个仓库里，结构、进度双向可校验**，并附一套给 AI agent 的工作契约。

打开即用，零依赖、零构建。仓库自带一个完整示例「回声纪要」：6 条需求、3 页可交互原型、1 个已砍需求、1 个待原型需求，用来演示所有状态。

```bash
cd ai-product-studio
npm run dev     # http://localhost:4173
npm run check   # 一致性校验（CI 同款）
```

> 文件名用社区通用的 `AGENTS.md`（不是 `AGENT.md`）。Claude Code 通过 `CLAUDE.md` 转过去。

## 它解决什么问题

产品设计用上 AI 之后，产出速度不再是瓶颈，**漂移**才是：

- PRD 说「开始录音」，原型写「立即录音」；
- PRD 标了 4 条已出原型，实际只有 3 页；
- 原型里冒出一个没人评审过的设置项；
- 换个会话继续做，agent 不知道上次停在哪，于是重写一遍。

这个工位用三件事把漂移压住：

| 机制 | 解决什么 |
| --- | --- |
| 需求 ID + 页面 `data-req` 双向追溯 | 每个界面元素能找到需求，每条需求能找到实现 |
| 状态与覆盖的机器校验 | `prototyped` 必须有页面，`dropped` 不得有页面，版本号必须同步 |
| `AGENTS.md` + `STATE.md` | 一次变更同时改 PRD、原型、版本、交接板；下一个会话知道从哪继续 |

## 目录

```text
AGENTS.md                 AI 工作契约（唯一入口）
CLAUDE.md                 Claude Code 入口，指向 AGENTS.md
STATE.md                  当前阶段、版本、下一步（会话交接板）
README.md

product/
  PRD.md                  需求与验收的唯一事实源
  discovery/              问题定义与证据
  decisions/              ADR：一次决策一个文件，只增不改

prototype/
  index.html              自动生成的目录页（勿手改）
  screens/                正式原型，必须带 screen meta 与 data-req
  spikes/                 探索稿，不进入目录页
  assets/                 共享 tokens 与组件样式

scripts/
  sync.mjs                校验 + 生成目录页
  serve.mjs               本地静态服务器

docs/
  workflow.md             阶段、门禁、会话提示词
  consistency.md          一致性模型、校验规则、报错修复
  prototype-guide.md      原型规范
  review-checklist.md     评审清单
```

## 一致性到底校验了什么

`npm run check` 会检查：

- PRD front matter 完整，版本是 SemVer，状态合法；
- REQ ID 不重复，状态/优先级合法，非 `dropped` 需求至少一条验收；
- 每个页面有 `screen:id` / `screen:title`，页面 ID 不重复；
- 每个 `data-req` 都能在 PRD 找到对应 REQ（原型不能发明需求）；
- `prototyped` / `approved` / `delivered` 的需求至少被一个页面覆盖；
- `dropped` 的需求没有任何页面覆盖；
- `STATE.md` 的 `spec_version` 与 PRD 版本一致；
- `prototype/index.html` 是最新生成物，没有手改。

**它不校验语义**：文案是否真的符合验收、边界态是否合理、交互是否走通，仍然靠 `docs/review-checklist.md` 与人的评审。不要把它当成「一致性已完成」的证明——它只证明结构和进度没散。

## 一次迭代长什么样

1. 在 `product/PRD.md` 新增/修改 REQ，写清行为与验收，升版本，补变更记录。
2. 改 `prototype/screens/`，给实现该需求的元素加 `data-req="REQ-00x"`。
3. 更新 `STATE.md`：阶段、版本、下一步。
4. `npm run sync` 重建目录页，`npm run check` 必须通过。
5. 汇报时列出受影响的需求 ID 与页面。

细节见 [`docs/workflow.md`](docs/workflow.md)，agent 的硬性规则见 [`AGENTS.md`](AGENTS.md)。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动本地预览（默认 4173，`PORT` 可改） |
| `npm run check` | 严格校验，CI 同款；目录页过期也失败 |
| `npm run sync` | 校验并重建 `prototype/index.html` |
| `npm run hooks` | 启用 `.githooks/pre-commit`，提交前自动校验 |

不需要 `npm install`，没有运行时依赖，Node ≥ 18。

## 用这个模板开一个新项目

1. 复制整个目录，改成你的项目名。
2. 改 `product/PRD.md` 的 front matter（产品名、`version: 0.1.0`、日期、owner）与正文。
3. 清空示例需求与变更记录，只留一条你自己的 REQ，或全部删除（空 PRD 也能通过校验）。
4. 改 `STATE.md`：`stage: discovery`、`spec_version` 与 PRD 一致、写清 `next_action`。
5. 删除或替换 `prototype/screens/*.html`，保留 `assets/` 的 tokens 与组件样式；跑 `npm run sync`。
6. `git init && git add -A && git commit -m "init product studio" && npm run hooks`。

示例内容建议先留着跑通一遍，再删。它能演示 `draft`、`prototyped`、`dropped` 三种状态和完整的覆盖关系。

## 设计取舍

- **不做 ticket / 代码 / 测试**：这是产品设计工位，交付物是「可评审的 PRD + 可点的原型」。研发任务从 PRD 导出，不在这个仓库维护第二份需求。
- **原型用静态 HTML**：双击可开、可 diff、agent 可直接改；代价是复杂交互验证不了。
- **不引入设计工具同步**：Figma 之类的视觉工具可以作为探索补充，但进入 `screens/` 的必须是可追溯的 HTML。
- **允许 `draft` 和 `dropped`**：没做的需求不逼你标成「已完成」；如实记录比看起来完整重要。
- **生成物只有一个**：目录页由脚本生成；不维护「需求 ↔ 页面」映射表，避免第三份真相。

## 社区参考与差异

这个仓库不是凭空设计的，主要借鉴了四类做法：

- [olehmell/cursor-pm-template](https://github.com/olehmell/cursor-pm-template)：按文件夹拆分 `AGENTS.md`，用 `company-context/` 提供共享上下文，产出落到 `artifacts/`。本仓库保留了「上下文与产物分离」，但把上下文收敛到 PRD/决策，避免每个用例各写一份。
- [jitu5/ai-prototyping-workflow](https://github.com/jitu5/ai-prototyping-workflow)：`constitution` + `spec/plan/phases` + `PROGRESS.md` 的活状态文件，以及 reviewer 做 spec-drift 检查。本仓库借用了「活状态文件」和「阶段门禁」，但把规则压缩到 `AGENTS.md`，不引入多角色 subagent。
- [github/spec-kit](https://github.com/github/spec-kit)：spec → plan → tasks → implement 的规格驱动流程。本仓库只取「先写可验收的规格」，不做到代码任务层。
- [xuqiang97/pm-ai-toolkit](https://github.com/xuqiang97/pm-ai-toolkit)：面向中文产品经理的 AI 工作流，强调先澄清、再收敛、再 HTML 高保真原型、再做变更影响分析。本仓库把「变更影响」落成了 REQ 搜索 + 校验脚本。
- [agentappbuilder: prototype/code sync](https://agentappbuilder.com/blog/keep-prototype-and-code-in-sync) 与 [Prodstack: single source of truth](https://www.prod-stack.ai/blog/single-source-of-truth-ai-product-teams)：每个时刻只允许一个真相、双向追溯、变更时找下游而不是靠记忆。本仓库把这两条原则做成了可执行的检查。

差异点：社区模板大多解决「怎么写」，这个仓库额外解决「**怎么证明两边没散**」——用稳定的需求 ID、页面追溯属性和一个零依赖校验器，把一致性从口头约定变成提交门槛。
