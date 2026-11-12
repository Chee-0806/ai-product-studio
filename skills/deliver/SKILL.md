---
name: deliver
description: 当用户要导出交付包、评审材料、Word/PPT、发给研发/甲方或做汇报时使用；按受众组织产物，内容生成与排版交给 agent，不新增产物生成脚本。
---

# 交付与产物生成

## 什么时候用

- 用户说「发给研发」「导出交付包」「做个评审版」「给甲方/领导看」「做成 Word / PPT」。
- 评审通过、准备交接，或需要把 PRD 转成另一种受众能读的材料。
- 甲方要求固定封面、审批栏、修订记录、汇报格式。

## 输入

- `product/PRD.md`：需求、验收、状态、开放问题、变更记录、依据。
- `STATE.md`：当前阶段、版本、下一步。
- `prototype/`：页面或 SPA；必要时读 `screens.json`。
- `product/decisions/`：需要解释取舍时读相关 ADR。
- `docs/review-checklist.md`、`docs/enterprise.md`。

## 先判断受众

| 受众 | 产物重点 | 不要放 |
| --- | --- | --- |
| 研发 | PRD、验收、原型、未决问题 | 内部工作台、STATE、调研原文 |
| 评审 / 甲方 | 封面、版本、修订记录、审批栏、依据、风险 | 内部脚本、聊天记录 |
| 领导 / 汇报 | 一页结论、范围、进度、风险、下一步 | 大段需求正文 |

同一份 PRD 可以生成多种产物，但不要为了「齐全」把所有内容塞进一份文档。

## 步骤

1. **先跑交付检查**：`npm run check:deliver`（比日常检查多两条：工作台必须最新、承诺类改动必须都已确认）。有错误先修；不要带着红色状态导出。
2. **读源材料**：完整读 PRD；提取 REQ、状态、验收、依据、开放问题、变更记录；读 STATE 与相关 ADR。
3. **选格式**：研发包、评审 Word、汇报 PPT、甲方模板；先确认受众和必须包含的字段，不要套一个万能模板。
4. **研发交付包**：不要调用产物生成脚本，直接由你组装：
   - 建 `dist/<产品>-v<版本>/`；
   - 复制 `product/PRD.md` 为 `PRD.md`；需要可读版时用 `pandoc` 或直接生成 `PRD.html`，没有工具就只交付 Markdown 并说明；
   - 多页原型复制 `prototype/screens/` 与 `prototype/assets/`；SPA 复制入口及其依赖的脚本/样式/数据，排除 `screens.json`、`external.json`、`previews/`、`spikes/`；
   - 把复制后原型里的 `工作台.html` 回链改成指向交付包内的原型目录（多页 `../index.html`，SPA 根入口 `index.html`）；
   - 生成 `prototype/index.html` 作为原型目录（多页列页面，SPA 列路由），根 `index.html` 链接 PRD 与 `prototype/index.html`；
   - 生成 `README.md`：产品、版本、日期、包内文件、需求→页面表、外部资源说明；涉及法规/标准/访谈时写「参考资料原件不随包外发，需要时向产品经理索取」；
   - **引用自检**：扫 PRD 与生成的 HTML/Word，确认没有 `product/`、`docs/`、`skills/`、`scripts/`、`prototype/`、`dist/` 这类工作区路径（「依据」「参考资料」最容易写进去）；命中就改写成文档名 + 章节或条款；
   - 如果对方要求不同目录或字段，按对方模板调整；不要为了一个项目新增脚本；
   - 用下面的 Python 片段打包（自动给中文名写 UTF-8 标志），不要用 macOS 自带的 `zip`：
   - 打包后自检：包内没有 `STATE.md`、`AGENTS.md`、`skills/`、`docs/`、`scripts/`、`discovery/`、`decisions/`、`工作台.html`，且所有条目 `flag_bits & 0x800`；
   - 用 `file://` 抽查 `index.html`、`PRD.html` 或 `PRD.md`、原型入口；
   - 在工位根目录留一份同名 zip 副本，回复里给绝对路径（`dist/` 被工位忽略，用户翻不到）。

   ```bash
   python3 - <<'PY'
   import os, zipfile
   src, out = "dist/<产品>-v<版本>", "dist/<产品>-v<版本>.zip"
   with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
       for root, _, files in os.walk(src):
           for name in files:
               full = os.path.join(root, name)
               z.write(full, os.path.relpath(full, os.path.dirname(src)))
   bad = [i.filename for i in zipfile.ZipFile(out).infolist() if not i.flag_bits & 0x800]
   print("UTF-8 文件名自检：", "通过" if not bad else bad[:5])
   PY
   ```
5. **评审 Word**：
   - 先生成结构化 Markdown/HTML 源，放在 `dist/review/<产品>-v<版本>/`；
   - 至少包含：封面（产品、版本、日期、编制/评审人）、修订记录、审批栏、需求表（ID、优先级、状态、依据）、未决问题、变更摘要、风险与依赖；
   - 用可用工具转成真正的 `.docx`：优先 `officecli`，其次 `pandoc`、`python-docx`、LibreOffice；
   - 转换后自检：封面字段、标题层级、表格、页码、审批栏、无占位文本；能读回文本就抽查关键段落。
6. **汇报 PPT**：先出逐页提纲或可打印 HTML deck；只有对方明确要求 `.pptx` 时才生成真 PPT。
7. **保留源材料**：Markdown/HTML 源与最终文件放在一起，下一版才能做差异和修订记录。
8. **汇报**：给出产物路径、包含/不包含什么、未决问题、自检结果。

## 输出

```text
产物：dist/review/<产品>-v<版本>/<文件名>.docx
受众：评审 / 甲方
包含：封面、修订记录、审批栏、需求表、未决问题、变更摘要
未包含：内部工作台、STATE、脚本、调研原文
自检：封面/标题/表格/页码/审批栏已检查；引用里无工作区路径；zip 文件名 UTF-8 标志通过；未决问题 3 条
落地：<工位绝对路径>/<产品>-v<版本>.zip（根目录留了副本）
```

## 多份快照

`product/PRD.md` 是唯一事实源；`PRD.html`、评审 Word、汇报材料、PDF 都只是某一版的快照。

1. 每份快照的封面或页脚写「依据 PRD v<版本>（<updated>）生成」，日期用生成当天。
2. 改完 PRD，旧快照立即作废：重新生成或删掉并说明；**不要逐段手工同步三处**，那只会制造自相矛盾。
3. 先写结构化源（Markdown/HTML），再转 HTML/Word/PDF；源与产物放同一目录，下一版才能做差异与修订记录。
4. 汇报里列出这次生成或作废了哪几份快照，以及各自路径。

## 不要做

- 不要把产物生成写成新的 `scripts/*.mjs`，也不要保留 `export.mjs` / `export --review`；研发包、评审 Word、PPT 都由本技能组装，新格式改技能或模板，不改脚本。
- 不要用 `zip -r` 或 `ditto` 打包中文文件名：macOS 自带的 zip 是 Info-ZIP 3.0，不写 UTF-8 标志（`-UN` 也不支持），Windows 解压乱码；也不要在导出后只丢一个 `dist/` 路径。
- 不要把 `product/...`、`docs/...` 这类工作区路径写进「依据」「参考资料」或交付文档。
- 不要把 HTML 改后缀冒充 `.docx`；必须是真正的 Word 文件。
- 不要虚构需求、依据、审批意见或修订记录。
- 不要把内部工作台、`STATE.md`、脚本、调研原文、ADR 全文打进对外交付物。
- 不要只给一个文件路径；说清受众、包含范围、未决问题和自检结果。
- 不要在检查失败时导出；先把红色状态修掉。
