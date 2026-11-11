# pm-methods（可选）

Anthropic 官方 `product-management` 插件里的 8 个产品方法技能，已做中文触发与文件落点适配。

**默认不安装。** 这里只是内容包源文件，不进入 `skills/`、不被 `AGENTS.md` 路由、也不会被 `.claude/skills` 发现。

## 什么时候装

- 需要做用户访谈归纳、竞品分析、指标复盘、向上汇报；
- 需要发散、挑战假设、定范围或排优先级；
- 希望 AI 按成熟框架输出，而不是每次自由发挥。

只做 PRD ↔ 原型一致性和日常改版时，不需要装。核心的 `prototype`、`review`、`change` 已经默认在 `skills/` 里。

## 安装与移除

```bash
npm run pack:add -- pm-methods
npm run pack:list
npm run pack:remove -- pm-methods
```

安装后，8 个技能会复制进 `skills/`，和核心技能一样被 `npm run check` 校验、被 `.claude/skills` 发现。移除时只删除这个包装进去的技能，不会动核心技能。

## 来源与许可

- 来源：https://github.com/anthropics/knowledge-work-plugins
- 固定提交：`877a617b435ee2edfb002d9a3703c0a1a03aa1ba`
- 许可证：Apache-2.0，全文见 `LICENSES/Apache-2.0.txt`
- 修改说明见 `THIRD_PARTY_NOTICES.md`
