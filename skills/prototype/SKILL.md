---
name: prototype
description: 当需求已存在、需要做成可点击页面或调整现有界面时使用；产出带 screen meta 与 data-req 的静态 HTML 原型。
---

# 原型实现

## 什么时候用

- 用户说「做一个页面」「把这条需求画出来」「改一下首页」。
- PRD 里已有 REQ，但还没有对应页面。
- 现有页面与需求不一致，需要调整。

## 输入

- 目标 REQ 块（行为、验收、边界）。
- `docs/prototype-guide.md`；企业项目加读 `docs/enterprise.md`。
- `prototype/assets/` 的共享样式。
- 现有 `prototype/screens/*.html` 作为骨架；如果项目是 SPA，读 `prototype/screens.json` 与入口文件。

## 步骤

1. 确认 REQ 已存在且不是 `dropped`；没有就先走 `write-spec` 技能。
2. 选一个稳定的 `screen:id`（小写英文/数字/短横线），确定 `screen:title`、`screen:flow` 与 `screen:form`（`mobile | desktop | responsive`）。
3. 复制一个现有页面作为骨架，保留对应终端的外壳、导航与状态栏。
4. 写 meta：

   ```html
   <meta name="screen:id" content="home">
   <meta name="screen:title" content="首页 · 一键开录">
   <meta name="screen:flow" content="记录">
   <meta name="screen:form" content="mobile">
   ```

5. 实现主流程，并给实现需求的**最小容器**加 `data-req="REQ-00x"`。
6. SPA 项目：在 `prototype/screens.json` 增加界面项，填 `route`（以 `#` 开头）与 `reqs`；如果入口是既有 SPA，不要为了工作台重写。
7. 补齐 PRD 第 6 节要求的状态：空、加载、错误、权限、超长；不能演示的写进汇报。
8. 页面之间用真实相对链接串起来；主流程必须点通；SPA 路由刷新后要停在当前界面。
9. 只用原生 HTML/CSS/JS 与 `assets/app.css`；外部地图/字体等服务必须写进 `prototype/external.json`，能 vendor 的放 `assets/vendor/`。
10. 含外部资源或超大页面时，提供 `previews/<id>.png` 并在 meta / `screens.json` 里声明。
11. 刷新 `STATE.md`，跑 `npm run sync && npm run check`。
12. 汇报改了哪些页面/路由、覆盖哪些 REQ。

## 输出

```text
页面：prototype/screens/xxx.html（screen:id=xxx，form=mobile）
或：prototype/app.html#/xxx（SPA route）
覆盖：REQ-00x、REQ-00y
未演示：……（边界态）
检查：工作台已刷新，一致性通过
```

## 不要做

- 不要在原型里发明 PRD 没有的入口、设置项或行为；需要就先加 REQ。
- 不要给整个 `<body>` 或页面容器打 `data-req`。
- 不要使用 lorem ipsum、空按钮、`href="#"`、死链。
- 不要无条件引入外部资源；必须走 `prototype/external.json` 白名单，或 vendor 到 `assets/vendor/`。
- 不要把 SPA 重写成多页，也不要为了缩略图内联 2.4MB 的入口文件；用预览图或占位卡。
- 不要手改 `工作台.html`；它由脚本生成。
