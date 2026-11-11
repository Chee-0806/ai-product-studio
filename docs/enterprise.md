# 企业项目适配

面向电力、政务、能源等 B 端项目：桌面端、单页应用、外部地图/字体服务、强监管依据、Word 评审材料。不是所有项目都需要，按需开启。

## 1. 先判断原型形态

| 项目情况 | 推荐配置 |
| --- | --- |
| 手机端、现场作业 App | `screen:form=mobile`，多页 HTML |
| 桌面后台、大屏、管理平台 | `screen:form=desktop`，多页 HTML 或 SPA |
| 一套界面同时适配手机和桌面 | `screen:form=responsive`，明确写断点 |
| 已有完整 SPA / 单文件后台 | `prototype/screens.json`，不要重写 |
| 地图、三维、视频等重资源页面 | 外部资源白名单 + `previews/` 预览图 |

`screen:form` 影响两件事：工作台缩略图比例，以及评审时检查的宽度。

- `mobile`：360px 不横向滚动；
- `desktop`：1440px 为基准，同时看 1280 / 1024 断点；
- `responsive`：360px 与 1440px 两端都检查。

## 2. 单页应用（SPA）

在 `prototype/screens.json` 写清单，入口文件继续放在 `prototype/`：

```json
{
  "mode": "spa",
  "entry": "app.html",
  "screens": [
    {
      "id": "overview",
      "title": "任务总览",
      "route": "#/overview",
      "flow": "总览",
      "form": "desktop",
      "reqs": ["REQ-001", "REQ-002"],
      "preview": "previews/overview.png"
    }
  ]
}
```

约束：

- `route` 必须以 `#` 开头，`file://` 双击才能打开；
- 每个界面的 `reqs` 是路由级追溯，必须引用 PRD 已有需求；
- 没有 `preview` 时，工作台显示「单页应用」占位卡，不内联入口文件；
- 没有 `screens.json` 时，仍按 `prototype/screens/**/*.html` 扫描。

## 3. 外部资源

`prototype/external.json`：

```json
{
  "allow": ["https://webapi.amap.com", "https://*.example.com"],
  "note": "内网演示时把地图 SDK 放到 assets/vendor/"
}
```

- 未声明的外部加载资源（script / img / link / iframe / 字体 / CSS `url()`）会让 `npm run check` 失败；普通外链不算；
- 已声明只代表允许存在，不代表离线可用；
- 能 vendor 的优先放 `prototype/assets/vendor/`；
- 交付包 README 会列出实际使用的域名，方便甲方内网准备。

## 4. 需求依据

强监管项目在 `product/PRD.md` front matter 开启：

```yaml
basis_required: true
```

每条非 `dropped` 需求补：

```markdown
- **依据**: 《电力监控系统安全防护规定》第 X 条；或访谈 2026-10（样本 5 人）；或 ADR-003
```

依据要能核对：法规条款、标准编号、访谈日期与样本、数据看板链接、ADR 文件。不要写「业务要求」「领导要求」这类无法追溯的话。

## 5. 导出研发交付包

产物生成走 `deliver` 技能，没有 `npm run export` 脚本。agent 在 `dist/<产品>-v<版本>/` 下直接组装：

- 复制 `product/PRD.md` 为 `PRD.md`；需要可读版时生成 `PRD.html` 或 PDF；
- 多页：复制 `prototype/screens/` 与 `prototype/assets/`；
- SPA：复制入口、脚本、数据与样式；`screens.json`、`external.json`、`previews/`、`spikes/` 不进入交付包；
- 生成 `prototype/index.html` 作为原型目录，根 `index.html` 链接 PRD 与原型目录；`README.md` 列出包内文件、需求→页面表、外部资源域名；
- 把原型里的 `工作台.html` 回链改成交付包内的原型目录；
- 内部工作台、`STATE.md`、`AGENTS.md`、`skills/`、`docs/`、`scripts/`、调研与决策不进入交付包；
- `zip -r` 打包后，用 `file://` 抽查入口、PRD 与原型。

## 6. Word / PPT / 评审材料

**产物生成走 `deliver` 技能，不走脚本。** 框架不内置 docx 生成器，也不保留 `export.mjs`，不新增 `review.mjs` / `export --review` 这类硬编码生成器。Word 的排版、目录、页眉页脚、审批栏由 agent 用自己擅长的工具完成；框架只负责 PRD、原型和检查结果这些源材料。

流程：

1. 先跑 `npm run sync && npm run check`，不要把红色状态带进交付物；
2. agent 读 PRD、STATE、相关 ADR，提取需求、依据、开放问题、变更记录；
3. 按受众生成结构化 Markdown/HTML 源，放在 `dist/review/<产品>-v<版本>/`；
4. 用 `officecli` / `pandoc` / `python-docx` / LibreOffice 等可用工具生成真正的 `.docx`；
5. 自检封面字段、标题层级、表格、页码、审批栏、无占位文本；
6. 保留 Markdown 源，下一版才能做差异和修订记录。

Word 至少包含：封面（产品、版本、日期、编制/评审人）、修订记录、审批栏、需求表（ID、优先级、状态、依据）、未决问题、变更摘要、风险与依赖。

硬规则：

- 必须是真正的 `.docx`，不能把 HTML 改后缀冒充；
- 不虚构需求、依据或审批意见；
- 版本号、修订记录、审批人与 PRD / STATE 一致；
- 需要新格式时改 `skills/deliver/SKILL.md` 或模板，不要加产物生成脚本。

## 7. 交付前检查

- [ ] `npm run check` 通过，工作台顶部不是红色；
- [ ] `screen:form` 与实际终端一致；
- [ ] SPA 每个 `route` 能打开；
- [ ] 外部资源已声明，内网/离线方案已说明；
- [ ] `basis_required` 项目的每条需求都有依据；
- [ ] 交付包里没有内部工作台、STATE、脚本、调研原文；
- [ ] 评审 Word 的版本、审批栏、未决问题与 PRD 一致。
