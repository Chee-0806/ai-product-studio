# 原型规范

## 1. 技术边界

- 原生 HTML/CSS/JS；多页原型一个页面一个文件，SPA 一个入口文件 + 多个 hash 路由；
- 不引框架、不装依赖、不加构建；
- 外部地图/字体等服务必须写进 `prototype/external.json` 的 `allow` 白名单；能 vendor 到 `assets/vendor/` 的优先本地化；
- 共享样式只从 `../assets/app.css` 引入（它已 `@import` tokens）；
- 页面必须能通过 `file://` 直接打开，也能在 `npm run dev` 下打开。

## 2. 页面元信息

每个 `screens/**/*.html` 必须有：

```html
<meta name="screen:id" content="home">
<meta name="screen:title" content="首页 · 一键开录">
<meta name="screen:flow" content="记录">
<meta name="screen:form" content="mobile">
```

- `screen:id`：稳定标识，小写英文/数字/短横线，永不复用；
- `screen:title`：给人看的中文标题，会出现在工作台；
- `screen:flow`：所属流程，工作台按它分组，例如「记录」「纪要」「设置」；
- `screen:form`：`mobile`（手机）、`desktop`（桌面）、`responsive`（自适应）；不写默认 `responsive`。工作台按它选缩略图比例，评审按它选检查宽度。
- `screen:preview`（可选）：静态预览图路径，相对 `prototype/`，例如 `previews/home.png`。用于地图、大屏或外部资源页面，工作台不再内联 iframe。

## 3. 需求追溯

实现某条需求的元素加 `data-req`：

```html
<a class="record-cta" href="recording.html" data-req="REQ-001">开始录音</a>
```

规则：

- 标在**最小可定位容器**上：一个按钮、一个区块、一个表单，不要标在 `<body>` 或整个页面容器；
- 一个元素只标一条需求；一个页面可以有多条；
- 标了就必须在 PRD 存在，否则校验失败；
- 只做展示、不属于任何需求的装饰元素不标；
- 同一需求的多个独立入口可以分别标，工作台会自动去重。

SPA 可以只在 `screens.json` 的每个界面写 `reqs`，不必在入口 HTML 的每个元素上标 `data-req`；追溯粒度从「元素」变成「路由」。如果入口里有稳定的区块，仍建议标 `data-req`，方便人工核对。

## 4. 页面与导航

- 主流程必须能点通：首页 → 录音 → 纪要 → 分享。
- 使用真实相对链接，例如 `href="note.html"`，不要 `href="#"`。
- 未纳入本期范围的功能（底部导航的其他 tab、未实现的设置）用 `<span>` 静态呈现，不要做成点了没反应的链接或按钮。
- 返回按钮指向明确的上一级页面。
- 每个页面右下角保留：

  ```html
  <a class="proto-link" href="../../工作台.html">← 工作台</a>
  ```

## 4.1 单页应用（SPA）

已经有一个完整 SPA（例如 2.4MB 的单文件后台、React/Vue 打包产物）时，不要为了适配工作台重写成多页。把入口和界面清单交给工作台：

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

规则：

- `entry` 相对 `prototype/`，必须是 HTML；SPA 的脚本、样式、数据可以继续放在 `prototype/` 下；
- `route` 必须以 `#` 开头，保证 `file://` 双击能打开；没有写时默认 `#/<id>`；
- `id` 稳定、唯一；`title`、`flow` 会进入工作台；`reqs` 必须引用 PRD 中已有需求；
- `form` 同上；`preview` 可选，相对 `prototype/`；
- 没有 `screens.json` 时，按原来的 `screens/**/*.html` 扫描，行为不变；
- 工作台对没有 `preview` 的 SPA 界面显示「单页应用」降级卡片，不内联 2.4MB 的入口。

## 4.2 外部资源与预览图

企业项目经常必须用地图、字体或组件 CDN。模板工程不无条件放开，也不要求你把整个 SPA 改成本地依赖：

```json
// prototype/external.json
{
  "allow": ["https://webapi.amap.com", "https://*.example.com"],
  "note": "内网演示时把地图 SDK 放到 assets/vendor/"
}
```

- 页面加载了未在白名单的 `http(s)` 资源（script / img / link / iframe / 字体 / CSS `url()`），`npm run check` 直接失败；普通 `<a href>` 外链不算；
- 白名单只表示「允许存在」，不表示「离线可用」；交付包 README 会列出实际使用的域名；
- 能 vendor 的资源优先放 `prototype/assets/vendor/`，用相对路径引用；
- 外部资源页面、大屏页面、超大 SPA 建议提供 `previews/<id>.png`，工作台用静态图代替 iframe；没有预览图时显示「外部资源 / 缩略图已降级」占位卡。

## 5. 内容

- 用真实感的中文示例数据，禁止 lorem ipsum、`TODO`、空白占位；
- 金额、日期、人数等数字在同一需求内保持一致；
- PRD 中用「」标注的文案，页面必须逐字一致；
- 页面内不写实现说明、需求编号说明或设计注释；追溯靠 `data-req`，说明写进 PRD；
- 涉及隐私/权限的界面，给出明确提示；
- 不在原型里承诺 PRD 没写的功能。

## 6. 状态与边界

PRD 第 6 节列出的状态，在对应页面要有可演示的呈现：

- 空状态：说明为什么空 + 下一步动作；
- 加载/生成中：告诉用户还要等多久；
- 错误：原因 + 可执行的恢复动作；
- 权限拒绝：说明路径，不进入死胡同；
- 超长内容：用省略、折叠或滚动，不撑破布局。

如果某个状态无法在静态原型里演示，在汇报中写「未验证」，不要假装覆盖。

## 7. 视觉

- 只使用 `assets/tokens.css` 里的颜色、圆角、阴影、字体变量；
- 新组件先加进 `app.css`，不要在页面里写大段重复内联样式；
- 按 `screen:form` 选基准：`mobile` 移动端优先，`desktop` 以 1440px 设计，`responsive` 同时覆盖 360px 与 1440px；
- 交互反馈要可见：hover、active、选中、禁用；
- 尊重 `prefers-reduced-motion`（共享样式已处理动画）。

## 8. 交互

- 原型只需要演示「流程与关键反馈」，不实现真实业务逻辑；
- 必须可用的交互：页面跳转、主按钮、弹层打开/关闭、tab/折叠；
- 可以模拟：复制、导出、保存、权限（用 toast 或状态变化表示结果）；
- 不要写真实网络请求、真实鉴权、真实上传；
- 脚本写在页面底部，保持简短；不要引入共享 JS 框架。

## 9. 新增一个页面

1. 确认要实现的需求 ID 已存在于 PRD，且状态不是 `dropped`。
2. 复制一个现有页面作为骨架，或从空 HTML 开始。
3. 写 meta 四件套（id / title / flow / form）。
4. 用共享样式搭结构；新组件补进 `app.css`。
5. 在实现需求的元素上加 `data-req`。
6. 从相关页面链过来；主流程要能到达。
7. `npm run sync` 重建工作台，`npm run check` 通过。
8. 在 `STATE.md` 的「上次会话」里记一句。

## 10. 工作台预览

`工作台.html` 会把每个多页原型和 `assets/app.css` 内联成缩略图，因此**双击文件就能看**，不需要启动服务。

- 页面必须继续引用 `../assets/app.css`，否则缩略图没有样式；
- 有 `screen:preview` / `screens.json` 的 `preview` 时，工作台显示预览图，不再内联 HTML；
- 含外部资源的页面自动降级为占位卡；SPA 没有预览图时也显示占位卡；
- 缩略图里的按钮不可点击，点卡片会打开完整页面；
- 因为要内联，单个页面的 HTML/CSS 不要引入巨大的 base64 资源。

## 11. 评审前自检

- [ ] 所有页面双击能打开，无 404 资源；
- [ ] 主流程能完整点通；
- [ ] 每个页面至少一个 `data-req`；
- [ ] 没有 `href="#"`、空 `onclick`、点了没反应的按钮；
- [ ] 文案与 PRD 的「」引用一致；
- [ ] `mobile` 在 360px 下不横向滚动；`desktop` 在 1440px 与 1280/1024 断点不溢出；`responsive` 两端都检查；
- [ ] SPA 每个 `route` 能打开，刷新后仍停在当前界面；
- [ ] 外部资源已写入 `prototype/external.json`，并准备了预览图或离线副本；
- [ ] 工作台缩略图 / 占位卡正常渲染；
- [ ] `npm run check` 通过。
