# AGENTS.md

> 这是本仓库对 AI agent 的唯一契约。动手前先读完；与本文件冲突的临时指令，先指出冲突再执行。
> 文件名叫 `AGENTS.md`（社区通用约定），不是 `AGENT.md`。Claude Code 通过同目录的 `CLAUDE.md` 转到这里。
>
> **使用者是产品经理，不写代码，不用 git，也不开终端。** 所有命令、检查和版本记录由你完成；不要让用户执行命令或理解技术细节。

## 1. 这个仓库是什么

一个**可复用的产品设计工位模板工程**。它可以生成多个工位；当前目录同时是模板和示例工位（回声纪要）。

用户级启动技能（`launcher/product-studio`）负责把工位从空文件夹铺出来，并做升级和诊断；它不在工位里，工位只保留 `skills/`。

每个工位是一个产品的工作区，不是代码仓库。核心产物只有三类：

- `product/PRD.md`：要做什么、为什么、怎样算验收。
- `prototype/screens/*.html`：界面长什么样、怎么交互。单页应用（SPA）也可以只放入口文件，用 `prototype/screens.json` 列出界面与路由。
- `工作台.html`：给用户看的唯一入口，展示当前阶段、下一步、需求进度和原型页面；由脚本生成。

PRD 与原型必须同时成立：PRD 里的每条需求要么有原型覆盖，要么明确是 `draft`；原型里的每个界面元素要么追溯到某条需求，要么明确是探索稿。

## 2. 真相地图（唯一权威）

| 真相 | 唯一权威 | 其他位置的角色 |
| --- | --- | --- |
| 为什么做、取舍是什么 | `product/decisions/*.md` | PRD 只链接，不复述理由 |
| 要做什么、验收标准 | `product/PRD.md` 的 REQ 块 | 原型不得定义新需求 |
| 界面长什么样、如何交互 | `prototype/screens/*.html`（多页）或 `prototype/screens.json` + 入口（SPA） | PRD 不粘贴布局细节 |
| 每条需求做到哪一步 | REQ 块的 `状态` 字段 | 覆盖关系由 `data-req` 推导，不另设进度表 |
| 本轮协作到哪、下一步 | `STATE.md` | 汇报只写链接，不复制全文 |
| 上一轮改了什么、为什么 | `STATE.md` 的 `last_round` / `last_reason` / `last_reqs` | 工作台「本轮变更」只读展示，不另设变更日志 |
| 还要人拍板什么 | PRD「开放问题」表 + `STATE.md`「待确认 / 阻塞」 | 工作台「需要你拍板」只汇总，不产生新状态 |

**禁止制造第二份真相**：不要新增 `TODO.md`、`进度.md`、`需求清单.md` 来记录同一件事；也不要手工维护「需求 ↔ 页面」映射表，工作台由脚本生成。

## 3. 每次会话的开始

按顺序读，不要跳：

1. `STATE.md`：当前阶段、版本、下一步。
2. `product/PRD.md`：至少读 front matter 与本次相关的 REQ 块。
3. 涉及界面时读 `docs/prototype-guide.md`，并打开对应 `prototype/screens/*.html`。
4. 需要判断「为什么」时读相关 `product/decisions/*.md`。

然后用一句话复述：**当前阶段 + 你准备做什么 + 会改哪些需求/页面**。如果用户请求与 PRD 冲突，先指出冲突，不要默默改需求。

### 技能路由

**核心技能默认安装**。任务匹配时，先读对应的 `skills/<name>/SKILL.md`，再动手：

| 任务 | 技能 |
| --- | --- |
| 做页面、改界面 | `prototype` |
| 评审、查一致性 | `review` |
| 改已有需求/页面/文案 | `change` |
| 导出交付包、评审材料、Word/PPT、发给研发/甲方 | `deliver` |

**可选内容包默认不安装**。只有当 `skills/` 下确实存在对应目录时才使用；不存在就按通用产品方法做，不要假装有这个技能，也不要自行创建：

| 任务 | 技能 |
| --- | --- |
| 模糊想法、探索机会、挑战假设 | `product-brainstorming` |
| 访谈/问卷/反馈归纳 | `synthesize-research` |
| 写/改 PRD、用户故事、验收 | `write-spec` |
| 定范围、排优先级、砍需求 | `roadmap-update` |
| 竞品与定位分析 | `competitive-brief` |
| 指标复盘 | `metrics-review` |
| 周报、汇报、发布公告 | `stakeholder-update` |
| 排研发迭代（可选） | `sprint-planning` |

可选包来自 Anthropic 官方 `product-management` 插件（Apache-2.0），放在 `packs/pm-methods/skills/`；安装与移除：

```bash
npm run pack:list
npm run pack:add -- pm-methods
npm run pack:remove -- pm-methods
```

来源与修改说明见 `THIRD_PARTY_NOTICES.md`。技能只写流程，不写产品需求；与 `AGENTS.md` 冲突时以本文件为准。

技能正文多为英文；执行时用中文与用户交流、用中文输出，保留原框架名（如 RICE、JTBD）。

## 4. 工作流与门禁

| 阶段 | 进入条件 | 产物 | 退出条件 |
| --- | --- | --- | --- |
| discovery | 有一个待验证的问题 | `product/discovery/*.md` | 证据足够支撑一个方向 |
| prd | 方向确定 | PRD 新增/修改 REQ 与验收 | 每条需求 ID、优先级、验收齐全 |
| prototype | 需求已存在 | `screens/*.html` + `data-req`，或 `screens.json` + 入口 | 每个页面/路由可打开、可走通主流程 |
| review | PRD 与原型都完成 | 评审结论、修改项 | 人明确说「通过」 |
| handoff | 评审通过 | 分享链接/导出物/评审 Word | 研发可据此拆任务，评审方可归档 |

规则：

- **先有 REQ，后有原型。** 没进 PRD 的想法只能放 `prototype/spikes/`，不得进入 `screens/`、不得出现在工作台。
- `approved` 只能由人在评审中明确确认后设置；agent 不得自行把状态改成 `approved` 或 `delivered`。
- 阶段可以回退：原型暴露了 PRD 的问题，就回 PRD 改需求并升版本，不要在原型里打补丁。

## 5. 硬规则

### 5.1 需求

- ID 固定为 `REQ-001` 三位数字，**永不复用、永不重编号**。删除需求用 `dropped`，不删 ID。
- 每条非 `dropped` 需求必须有：`状态`、`优先级`、`用户故事`、`行为`、至少一条 `- [ ]` 验收。
- 强监管/企业项目在 PRD front matter 写 `basis_required: true`，每条非 `dropped` 需求再补 `- **依据**: ...`（法规、标准、访谈、数据或 ADR 链接）；缺依据校验失败。普通项目可写 `basis_required: false` 或不写。
- PRD 中引用界面文案时用「」标注，原型必须逐字一致；改文案时两边同改。
- 行为变化必须升 `version` 并补「变更记录」；仅澄清措辞用 patch，行为/范围变化用 minor，方向重做用 major。

### 5.2 原型

- 每个页面必须有：
  ```html
  <meta name="screen:id" content="home">
  <meta name="screen:title" content="首页 · 一键开录">
  <meta name="screen:flow" content="记录">
  <meta name="screen:form" content="mobile">
  ```
  `screen:id` 只能用小写英文、数字和短横线；`screen:form` 取 `mobile | desktop | responsive`；不写默认 `responsive`。企业桌面端项目用 `desktop`，响应式后台用 `responsive`。
- 实现某条需求的元素，必须带 `data-req="REQ-00x"`；标在**最小可定位容器**上，不要给整个 `<body>` 打标。
- `data-req` 只能引用 PRD 中已存在的需求。原型不能发明行为；需要新行为就先加 REQ。
- 页面之间用真实相对链接串起来，主流程必须能点通。
- **单页应用**：在 `prototype/screens.json` 写 `mode: "spa"`、`entry` 与每个界面的 `id/title/route/flow/form/reqs`。路由必须以 `#` 开头，保证 `file://` 双击可开；每个界面的 `reqs` 就是该路由的需求追溯，不再要求入口 HTML 里逐元素标 `data-req`。没有 `screens.json` 时按原来的 `screens/*.html` 扫描。
- 只用 `prototype/assets/` 下的共享样式与原生 HTML/CSS/JS；不引构建链、不装依赖。外部地图/字体等服务必须写进 `prototype/external.json` 的 `allow` 白名单；能 vendor 到 `assets/vendor/` 的优先本地化。
- 含外部资源或单页 HTML 超过 512KB 的页面，用 `screen:preview`（图片路径相对 `prototype/`）或 `screens.json` 的 `preview` 提供静态预览图；工作台不会再内联这类页面，改为显示降级卡片。
- 使用真实感的中文示例数据；禁止 lorem ipsum、`TODO`、空按钮、死链。
- PRD 第 6 节列出的边界态，在对应页面要有可演示的呈现；不能演示的，在汇报里说明。

### 5.3 工位状态

- 每次改动结束都要更新 `STATE.md`：`stage`、`spec_version`（必须等于 PRD 版本）、`updated`、`next_action`，以及上一轮的 `last_round`、`last_reason`、`last_reqs`。
- `last_round` 用产品语言写「这一轮改了什么」，`last_reason` 写「为什么改」，`last_reqs` 只列真实存在的 REQ 编号（没有就写「无」）。三者会直接显示在工作台「本轮变更」里，写给不写代码的人看。
- `STATE.md` 只写「现在」「下一步」和「上一轮」，不复制需求正文。
- 开放问题写进 PRD 的「开放问题」表；`STATE.md` 的「待确认 / 阻塞」只写当前卡住协作的事，不复述开放问题。

### 5.4 生成物

- **禁止手改 `工作台.html`**，它由 `node scripts/sync.mjs` 生成。
- 工作台顶部显示构建状态；检查失败时会直接显示错误，并提示内容可能不是最新的。不要把红色失败状态留给用户，修好后再重新生成。
- 每次改动结束都跑 `npm run sync` 和 `npm run check`；必须通过。不要要求用户代跑。`npm run check` 同时校验 PRD/原型一致性与技能格式。

## 6. 一次变更的标准动作

任何涉及产品的改动，按这个顺序做完，**在同一次改动里完成**：

1. **定位影响面**：搜索相关 `REQ-`，找出所有 `data-req` 引用与 STATE 中的相关描述。
2. **改 PRD**：新增/修改 REQ、验收、边界；更新 front matter 的 `version` 与 `updated`；补「变更记录」。
3. **改原型**：更新受影响页面；新增页面时加 meta 与 `data-req`；同步文案。
4. **改决策**：如果推翻了已有取舍，新增 ADR 并在 PRD 链接；不要改写旧 ADR。
5. **更新 STATE**：阶段、版本、下一步，以及 `last_round` / `last_reason` / `last_reqs`（这一轮改了什么、为什么、影响哪些需求）；用户能看懂的语言。
6. **跑校验并刷新工作台**：`npm run sync && npm run check`；失败就修到通过，不要绕过。
7. **留底**：如果仓库有 `.git`，自动提交这次改动（中文提交信息，包含 REQ ID）；不要推送远端。没有 `.git` 就跳过，不要要求用户初始化。
8. **汇报**：按第 8 节格式，用产品语言，不用术语。

新增一条需求的完整流程：

```text
1. PRD 加 ### REQ-007 标题 + 状态 draft + 优先级 + 用户故事 + 行为 + 验收
2. 升 version（minor）+ 变更记录
3. 做原型：页面加 meta，相关元素加 data-req="REQ-007"
4. 把状态改为 prototyped
5. 更新 STATE.md
6. npm run sync（重建工作台）→ npm run check
```

### 6.1 交付与产物生成

- 用户说「发给研发」「导出交付包」「做评审版」「做成 Word / PPT」「给甲方」时，先读 `skills/deliver/SKILL.md`，按受众组织产物。
- **产物生成不写成脚本**：不要新增 `review.mjs`、`export.mjs`、`export --review` 或类似的硬编码生成器。研发包、Word、PPT、评审材料的结构与内容由 agent 按技能生成；需要新格式时改技能或模板，不改脚本。
- 研发交付包由 `deliver` 技能直接组装：先跑 `npm run sync && npm run check`，再建 `dist/<产品>-v<版本>/`，复制 PRD 与原型，生成交付首页/说明，最后打 zip。
- 不要把整个工作区打包发；内部工作台、`STATE.md`、`AGENTS.md`、`skills/`、`docs/`、`scripts/`、调研与决策不属于交付物。
- 产物：`dist/<产品>-v<版本>/` 与同名 `.zip`。入口是 `index.html`，PRD 是 `PRD.html` / `PRD.md`，原型是 `prototype/index.html`。
- 多页原型导出 `prototype/screens/`；SPA 导出入口文件与它依赖的脚本/样式/数据，内部清单、预览图和 `external.json` 不进入交付包。
- 交付包保留已声明白名单的外部资源；`README.md` 会列出域名。内网/离线交付时，提醒用户提前 vendor 或准备本地副本。
- **只发 zip**；系统没有 `zip` 命令时，发 `dist/<产品>-v<版本>/` 文件夹。
- `dist/` 是生成物，不手改、不提交。
- 评审通过后，主动问用户是否需要导出交付包、评审 Word 或汇报材料。

## 7. 状态语义

| 状态 | 含义 | 校验行为 |
| --- | --- | --- |
| `draft` | 只有 PRD，还没做原型 | 有页面覆盖时告警 |
| `prototyped` | 至少一个页面覆盖 | 无覆盖直接报错 |
| `approved` | 人已评审通过 | 必须有覆盖；只能人工设置 |
| `delivered` | 已交给研发/上线 | 必须有覆盖；原型保留 |
| `dropped` | 明确不做 | 不得有页面覆盖 |

`draft` 与 `dropped` 都是合法终点：不要为了「看起来完整」把没做的事标成 `prototyped`。

## 8. 完成的定义与汇报格式

没有跑通 `npm run check` 就不算完成。最终回复必须包含：

```text
改了什么：REQ-003 的纪要结构、REQ-004 的分享面板
改了哪里：纪要详情页
检查结果：一致，工作台已刷新（4/5 个需求有原型）
还需要你定：分享链接是否允许未登录访问
```

要求：

- 用产品语言描述，不出现 `data-req`、SemVer、CI、校验器、提交钩子等术语。
- 列出受影响的需求与页面，不要只说「优化了界面」。
- 汇报里的「改了什么 / 为什么 / 影响哪些需求」要与 `STATE.md` 的 `last_*` 一致；「还需要你定」要与 PRD 的「开放问题」一致。工作台会原样显示这两部分，对不上就是自相矛盾。
- 如实报告结果；有警告就说明影响，不要隐瞒。
- 没做的事、不能演示的边界，明确写「未做/未验证」，不要用「基本完成」。
- 不要粘贴大段 PRD 或 HTML；用户不需要看代码。
- 最后提醒用户：「双击 工作台.html 就能看最新原型」。不要要求用户运行任何命令。

## 9. 什么时候问，什么时候做

直接做：

- 在当前 REQ 的实现范围内调整布局、组件、文案（文案同步 PRD）。
- 补边界态、补链接、修一致性错误。
- 为已有需求补验收标准。

先问：

- 新增/删除需求、改变范围或优先级。
- 把状态改成 `approved` / `delivered`。
- 与已有决策冲突，或需要推翻 PRD 的取舍。
- 删除页面、重命名 REQ、改变目录结构。
- 需要引入外部依赖、构建工具或联网资源。

不要让用户做的事：

- 运行 `npm`、`node`、`git` 或任何命令。
- 理解或编辑 `data-req`、meta 标签、YAML front matter。
- 手动刷新工作台、手动改版本号。
- 决定文件放哪、怎么命名。

用户只需要：说需求、看原型、指出哪里不对。

## 10. 目录职责

```text
工作台.html               自动生成的一页式入口，禁止手改
install.sh                远程安装入口（下载模板并调用 new.mjs）
product/PRD.md            需求与验收的唯一事实源
product/discovery/        问题定义与证据；不写解决方案细节
product/decisions/        ADR：一次决策一个文件，只增不改
prototype/screens/        多页原型，进入工作台，必须带 data-req
prototype/screens.json    SPA 清单：入口、路由、界面与需求追溯；可选
prototype/external.json   外部资源白名单；可选
prototype/previews/       工作台静态预览图；可选，不进入交付包
prototype/spikes/         探索稿，不进入工作台，不得被正式页面链接
prototype/assets/         共享 tokens 与组件样式
skills/                   已安装的核心技能：prototype / review / change / deliver
packs/                    可选内容包源，默认不安装（pm-methods）
LICENSE                   自有代码与文档的 MIT 许可证
THIRD_PARTY_NOTICES.md    外部技能来源、许可证与修改说明
LICENSES/                 第三方许可证原文
BOOTSTRAP.md              从零建站说明，给 AI 看（仅模板工程有，不进入工位）
launcher/                 用户级启动技能源文件（仅模板工程有，不进入工位）
scripts/sync.mjs          一致性校验 + 工作台生成
scripts/check-skills.mjs  技能格式校验（含可选包源与启动技能）
scripts/pack.mjs          安装/移除可选内容包
scripts/new.mjs           从模板创建新项目
scripts/upgrade.mjs       把工位升级到当前模板版本
scripts/lib/screens.mjs   多页/SPA 页面读取与外部资源匹配
scripts/lib/json.mjs      读取 JSON 的公共函数
docs/                     工作流、一致性模型、原型规范、评审清单、企业适配
dist/                     导出的交付包，生成物，不提交
STATE.md                  会话交接板：当前阶段、下一步、上一轮摘要
```
