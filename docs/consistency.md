# 一致性模型

## 1. 三种漂移

| 漂移 | 例子 | 谁来发现 |
| --- | --- | --- |
| 结构漂移 | 原型加了一个 PRD 没有的功能；页面没标 `data-req` | `npm run check` |
| 进度漂移 | PRD 标 `prototyped` 但没有页面；`dropped` 的需求还有页面 | `npm run check` |
| 语义漂移 | 文案不一致、验收没覆盖边界态、交互与行为不符 | 评审 + agent 契约 |

机器只能保证前两种。**不要把「检查通过」当成「内容正确」。**

## 2. 真相怎么分

| 信息 | 写在哪 | 不写在哪 |
| --- | --- | --- |
| 需求、行为、验收 | `product/PRD.md` | 页面注释、STATE、README |
| 界面结构、交互、视觉 | `prototype/screens/*.html`（多页）或 `screens.json` + 入口（SPA） | PRD 的布局描述 |
| 是否做到 | REQ 的 `状态` | 单独的进度表 |
| 需求 ↔ 页面 | 由 `data-req` 或 SPA 路由 `reqs` 推导 | 手工映射表（工作台由脚本生成） |
| 为什么 | `product/decisions/*.md` | PRD 的长篇理由 |
| 本次协作到哪 | `STATE.md` | 聊天记录 |

## 3. 三个机械不变量

1. **原型不能发明需求**：每个 `data-req` / SPA 路由 `reqs` 必须指向 PRD 中存在的 REQ。
2. **状态不能虚报**：`prototyped` / `approved` / `delivered` 必须有页面覆盖；`dropped` 不得有页面。
3. **版本不能分叉**：`STATE.md` 的 `spec_version` 必须等于 PRD 的 `version`；工作台必须是最新生成物。

## 4. 校验规则

`npm run check` = `node scripts/check-skills.mjs && node scripts/sync.mjs --check --strict`。

### PRD

- front matter 必须有 `product`、`version`、`updated`、`status`；
- `version` 是 `x.y.z`；`updated` 是 `YYYY-MM-DD`；
- `status` ∈ `draft | review | approved`；
- `basis_required` 可选，只能是 `true` / `false`；
- REQ 标题格式 `### REQ-001 标题`（2~4 级标题均可）；
- REQ ID 不重复；
- `状态` ∈ `draft | prototyped | approved | delivered | dropped`，支持中文别名；
- `优先级` ∈ `P0 | P1 | P2`；
- 非 `dropped` 需求至少一条 `- [ ]` 验收；
- `basis_required: true` 时，每条非 `dropped` 需求必须有 `- **依据**: ...`。

### 原型

- 每个页面必须有：
  ```html
  <meta name="screen:id" content="home">
  <meta name="screen:title" content="首页 · 一键开录">
  <meta name="screen:flow" content="记录">
  <meta name="screen:form" content="mobile">
  ```
- 页面 ID 不重复；
- `screen:form` ∈ `mobile | desktop | responsive`，不写默认 `responsive`；
- 每个 `data-req` 能在 PRD 找到；
- 页面没有任何 `data-req` 会告警；
- 没有 `screen:flow` 会告警。
- 有 `prototype/screens.json` 且 `mode: "spa"` 时，改按清单校验：`entry` 存在、界面 `id` 唯一、`route` 以 `#` 开头、`reqs` 在 PRD 中存在。
- 页面加载的外部 `http(s)` 资源（script / img / link / iframe / 字体 / CSS `url()`）必须在 `prototype/external.json` 的 `allow` 里；未声明直接失败。普通 `<a href>` 外链不检查。

### 状态与覆盖

- `prototyped` / `approved` / `delivered`：必须至少被一个页面覆盖；
- `dropped`：不得被任何页面覆盖；
- `draft`：有页面覆盖会告警（要么升状态，要么去掉覆盖）。

### 状态文件与生成物

- `STATE.md` 必须有 `stage`、`spec_version`、`updated`、`next_action`；
- `stage` ∈ `discovery | prd | prototype | review | handoff`；
- `spec_version` === PRD `version`；
- `工作台.html` 必须与脚本生成结果逐字一致。

### 技能

检查两处，分开计算：已安装的 `skills/`，以及可选内容包的 `packs/<name>/skills/`。

- `SKILL.md` 必须有 `name`、`description`；
- `name` 必须与目录名一致，且只含小写英文/数字/短横线；
- 必须有「## 什么时候用」；
- 不能留 `TODO` / `FIXME`；
- 自有技能正文超过 120 行会告警；带「来源：Anthropic」的引入技能豁免；
- `packs/<name>/pack.json` 的 `name` 必须与目录名一致，`skills` 列表里的技能必须有 `SKILL.md`。

## 5. 报错怎么修

### `REQ-003 状态是 prototyped，但没有页面带 data-req="REQ-003"`

二选一，不要含糊：

- 确实做了：在对应页面最小容器上加 `data-req="REQ-003"`；
- 还没做：把状态改回 `draft`。

### `data-req="REQ-007" 在 PRD 中不存在（原型不能定义新需求）`

先在 PRD 新增 REQ-007 与验收，再保留标注；否则删掉标注或删掉该界面。**不要**为了通过检查随手建一条空需求。

### `版本不一致：PRD 是 0.2.1，STATE.md 是 0.2.0`

改 PRD 后同步 `STATE.md`。版本只存在于 PRD，STATE 是镜像。

### `工作台.html 已过期`

```bash
npm run sync
```

不要手改生成物。检查由 AI 在每次改动后自动运行，用户不需要执行命令。

### `需求 ID 重复` / `页面 ID 重复`

ID 永不复用。删除需求用 `dropped`；页面改名时同时改 `screen:id` 与所有链接。

### `引用了未声明的外部资源 https://...`

二选一：

- 把域名加入 `prototype/external.json` 的 `allow`，例如 `https://webapi.amap.com` 或 `https://*.example.com`；
- 把资源下载到 `prototype/assets/vendor/`，改用相对路径。

白名单不是离线保证。内网/断网演示时，仍需提前 vendor，或提供 `previews/` 预览图。

### `PRD 开启了 basis_required，必须补「- **依据**: ...」`

给对应需求补一条依据，写清来源：法规条款、标准编号、访谈日期与样本、数据看板或 ADR 链接。不要写「业务要求」这种无法核对的空话。确实没有依据的需求，要么补调研，要么标 `dropped`。

### `REQ-005 状态是 draft，但已有页面覆盖`

要么把状态改为 `prototyped`（说明它已经进入正式原型），要么把页面移回 `spikes/` 或移除 `data-req`。

### `PRD 里还没有需求`

空 PRD 是合法初始状态，不报错。新增第一条 REQ 后工作台会更新。

## 6. 为什么不做自动修复

脚本只自动生成工作台，不自动改状态或补 `data-req`。这些动作包含判断：

- 页面到底实现了哪条需求；
- 需求到底做没做；
- 文案以哪边为准。

自动猜会让错误变得「看起来已修复」。脚本负责**让矛盾可见**，判断留给人。

## 7. 谁负责运行检查

- **AI**：每次改动结束都运行 `npm run sync && npm run check`，失败自己修；不要把命令推给用户。
- **用户**：不需要运行任何命令，只需要双击 `工作台.html` 看结果。
- **维护者（可选）**：如果仓库放在 git 里，agent 可以在检查通过后自动提交留底；不要求用户理解或操作 git，也不配置 CI / 提交钩子。

## 8. 已知限制

- 无法判断 `data-req` 是否标在了「正确的元素」上；
- 无法判断页面文案与 PRD 中「」引用是否逐字一致；
- 无法判断验收标准是否真的覆盖了所有边界态；
- 无法判断原型交互是否符合真实业务规则；
- 页面嵌套目录只校验文件，不校验链接是否可达；
- SPA 的 `reqs` 是路由级追溯，无法判断某个按钮是否属于某条需求；
- 工作台缩略图只内联 `assets/app.css` 与页面自身；外部资源页面会降级为占位卡，有 `preview` 时显示预览图；
- 外部资源白名单只校验「有没有声明」，不校验资源是否可访问、是否被篡改；
- 工作台顶部的构建状态来自最近一次 `sync`；AI 没有运行刷新时，页面不会自己更新。

这些由 `docs/review-checklist.md` 覆盖。评审时明确写出「无法验证」的项，不要默认通过。
