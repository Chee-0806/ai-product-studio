# 第三方与来源说明

本仓库自有代码与文档采用 **MIT**（见根目录 [`LICENSE`](LICENSE)）。`packs/pm-methods/skills/` 中有 8 个可选技能来自 Anthropic 官方开源仓库，采用 **Apache-2.0**，做了本地化适配；其余技能为本工位自有。内容包默认不安装。

## Anthropic knowledge-work-plugins

- 来源：https://github.com/anthropics/knowledge-work-plugins
- 路径：`product-management/skills/`
- 版本：`product-management` plugin `1.2.0`
- 固定提交：`877a617b435ee2edfb002d9a3703c0a1a03aa1ba`
- 许可证：Apache License 2.0（全文见 [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt)）
- 上游没有 `NOTICE` 文件（已确认 404）。

### 被引入的文件

| 本仓库文件 | 上游路径 |
| --- | --- |
| `packs/pm-methods/skills/write-spec/SKILL.md` | `product-management/skills/write-spec/SKILL.md` |
| `packs/pm-methods/skills/roadmap-update/SKILL.md` | `product-management/skills/roadmap-update/SKILL.md` |
| `packs/pm-methods/skills/synthesize-research/SKILL.md` | `product-management/skills/synthesize-research/SKILL.md` |
| `packs/pm-methods/skills/stakeholder-update/SKILL.md` | `product-management/skills/stakeholder-update/SKILL.md` |
| `packs/pm-methods/skills/product-brainstorming/SKILL.md` | `product-management/skills/product-brainstorming/SKILL.md` |
| `packs/pm-methods/skills/metrics-review/SKILL.md` | `product-management/skills/metrics-review/SKILL.md` |
| `packs/pm-methods/skills/competitive-brief/SKILL.md` | `product-management/skills/competitive-brief/SKILL.md` |
| `packs/pm-methods/skills/sprint-planning/SKILL.md` | `product-management/skills/sprint-planning/SKILL.md` |

### 修改说明

每个被引入的文件都做了以下修改，并已在文件顶部用「来源 + 本工位适配」标注：

1. 将 `description` 改为中英双语的触发描述，便于中文任务匹配。
2. 删除连接器（`CONNECTORS.md`）提示，改为「本工位没有连接器，不要要求用户连接工具」。
3. 增加「本工位适配」：把技能输出映射到 `product/PRD.md`、`product/discovery/`、`STATE.md` 或对话输出。
4. 增加「## 什么时候用」小节，便于中文任务触发与人工浏览。
5. 去掉与本工位无关的斜杠命令依赖说明；保留原始工作流、框架与检查清单。

原始版权归 Anthropic 所有；修改部分归本仓库。Apache-2.0 允许商用与再分发，但要求保留许可证与修改声明。

## 本工位自有内容

- `skills/prototype/SKILL.md`
- `skills/review/SKILL.md`
- `skills/change/SKILL.md`
- `skills/deliver/SKILL.md`
- `scripts/`、`prototype/assets/`、`docs/` 与模板文档

这些内容采用 MIT，只封装本工位的「PRD ↔ 静态 HTML 原型」一致性流程，不复制上面的 PM 方法论。
