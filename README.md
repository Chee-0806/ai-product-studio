# 产品设计工位

给**不写代码、不用 git、不开终端**的产品经理用的 AI 协作工位。

打开方式只有一个：**双击根目录的 `工作台.html`**。

## 她只需要做三件事

1. **双击 `工作台.html`**：看到当前阶段、下一步、需求进度和原型页面。
2. **把想法直接说给 AI**：不用先写文档，AI 会先问关键问题，再改 PRD 和原型。
3. **点开页面看原型**：把不满意的地方告诉 AI；改完让 AI「刷新工作台」。

不需要 git，不需要命令行，不需要知道文件放在哪。所有检查、版本记录、刷新工作台都由 AI 完成。

## 给 AI 的第一句话

把文件夹用 **Claude Code / Cursor / Codex** 等能读写本地文件的 AI 打开，然后粘贴：

```text
你是我的产品搭档。先读 AGENTS.md、STATE.md 和 product/PRD.md，用一句话告诉我现在做到哪、下一步做什么。
然后按我说的改。改完自己运行 npm run sync 和 npm run check，刷新工作台，再告诉我：改了哪些需求、哪些页面、还有什么没定。
不要要求我运行命令，也不要让我碰 git。
```

之后正常说需求即可，例如：

- 「我想做一个给宝妈记录宝宝喂养的工具，先别写方案，先问我 10 个关键问题。」
- 「首页太满了，只保留开始记录和最近三条。」
- 「这个流程还缺一个空状态，帮我补上。」
- 「检查一下 PRD 和原型是不是一致，刷新工作台。」

## 工作台长什么样

`工作台.html` 是唯一入口，由脚本生成，包含四块：

- **下一步**：当前阶段和下一件具体要做的事（来自 `STATE.md`）。
- **需求进度**：每条需求的状态，以及它在哪个原型页面。
- **原型页面**：每个页面的实时缩略图，点开是可交互原型。
- **怎么用**：三步说明和给 AI 的开场白。

缩略图是把页面样式内联后渲染的，所以**双击 HTML 就能看**，不需要启动本地服务。

## 目录

```text
工作台.html               唯一入口，自动生成，禁止手改
AGENTS.md                 AI 的工作契约
CLAUDE.md                 Claude Code 入口，指向 AGENTS.md
STATE.md                  当前阶段、版本、下一步
README.md                 本文件

product/
  PRD.md                  需求与验收的唯一事实源
  discovery/              问题定义与证据
  decisions/              ADR：一次决策一个文件，只增不改

prototype/
  screens/                正式原型，进入工作台
  spikes/                 探索稿，不进入工作台
  assets/                 共享视觉样式

scripts/
  sync.mjs                一致性检查 + 生成工作台
  serve.mjs               可选的本地预览服务

docs/                     工作流、一致性模型、原型规范、评审清单
```

## 一致性是怎么保证的

不是靠 AI「记得」同步，而是靠三个约束：

1. **需求有固定 ID**：`REQ-001`，永不复用；原型里实现某条需求的元素带 `data-req="REQ-001"`。
2. **状态和页面必须对得上**：标了「已完成原型」就必须有页面；标了「已砍」就不能还有页面。
3. **版本只有一个来源**：PRD 的版本必须等于 `STATE.md` 的版本；工作台必须是最新生成物。

`npm run check` 会检查这些规则。AI 每次改完都会自己跑；失败就自己修，不会让用户处理。

**它不检查语义**：文案是否真的符合验收、边界态是否合理，仍然需要人看一眼。评审清单在 `docs/review-checklist.md`。

## 维护者：第一次设置

1. **复制整个文件夹**给她，或者放到她的工作目录。
2. 确保电脑上有 **Node.js ≥ 18**（只用于 AI 运行检查；单纯看工作台不需要）。没有的话让 AI 帮你装，或从 [nodejs.org](https://nodejs.org) 安装 LTS。
3. 用能读写本地文件的 AI 打开文件夹，粘贴上面的开场白。
4. 让她先双击 `工作台.html` 熟悉一下，再开始改示例。
5. **git 是可选的**：如果文件夹里有 `.git`，AI 可以在检查通过后自动提交留底，不需要她操作；没有 `.git` 也完全不影响使用。不要教她 git。

常用命令（只给维护者/AI）：

| 命令 | 作用 |
| --- | --- |
| `npm run sync` | 检查并重建 `工作台.html` |
| `npm run check` | 严格检查，失败即退出 |
| `npm run dev` | 可选：本地预览，默认 http://localhost:4173 |

不需要 `npm install`，没有运行时依赖。

## 换成她自己的产品

1. 改 `product/PRD.md` 的 front matter：产品名、`version: 0.1.0`、日期、负责人。
2. 清空示例需求与变更记录，留一条她自己的需求（或全部删掉，空 PRD 也能通过检查）。
3. 改 `STATE.md`：`stage: discovery`、`spec_version` 与 PRD 一致、写清 `next_action`。
4. 删除或替换 `prototype/screens/*.html`，保留 `assets/` 的样式；运行 `npm run sync`。
5. 双击 `工作台.html`，应该看到她的产品名和「下一步」。

示例内容建议先留着跑通一遍，再删。它演示了「待做原型 / 原型已完成 / 已砍」三种状态。

## 设计取舍

- **工作台是唯一入口**：产品经理不需要记目录、命令或文件格式。
- **PRD 与原型各管一种真相**：PRD 管要做什么和验收，原型管界面与交互；覆盖关系自动推导。
- **原型用静态 HTML**：双击可开、可 diff、AI 能直接改；代价是复杂交互验证不了。
- **不做第二份进度表**：进度只写在需求状态里，工作台由脚本生成。
- **不要求 git**：git 只作为 AI 的隐形留底，不作为使用门槛。

## 社区参考

- [cursor-pm-template](https://github.com/olehmell/cursor-pm-template)：按文件夹拆分 `AGENTS.md`，共享产品上下文与产物目录。
- [ai-prototyping-workflow](https://github.com/jitu5/ai-prototyping-workflow)：阶段化规格 + `PROGRESS.md` 活状态 + spec-drift 检查。
- [github/spec-kit](https://github.com/github/spec-kit)：spec → plan → tasks → implement 的规格驱动流程。
- [pm-ai-toolkit](https://github.com/xuqiang97/pm-ai-toolkit)：面向中文产品经理的 AI 工作流与 HTML 高保真原型。
- [Prodstack: single source of truth](https://www.prod-stack.ai/blog/single-source-of-truth-ai-product-teams) 与 [agentappbuilder: prototype/code sync](https://agentappbuilder.com/blog/keep-prototype-and-code-in-sync)：每种真相一个权威源、双向追溯、变更找下游而不是靠记忆。

这个工位的差异：把「一致性」从口头约定做成 AI 每次必须执行的检查，并给非技术用户一个双击即用的入口。

## 已知限制

- 语义一致性（文案、边界、交互是否符合验收）无法全自动判断，需人工评审。
- 工作台缩略图只内联 `assets/app.css` 与页面自身；外部图片/字体会在缩略图里缺失，但打开页面正常。
- 需要 AI 能读写本地文件夹；纯网页版聊天工具改不了文件。
