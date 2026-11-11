#!/usr/bin/env node
/**
 * 从模板创建一个新的产品工位。
 *
 *   npm run new -- ../宝宝喂养 --name "宝宝喂养"
 *   npm run new                 # 交互式
 *
 * 只复制工位骨架，不带示例 PRD、示例原型和 git 历史。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline/promises';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const today = new Date().toISOString().slice(0, 10);

const args = process.argv.slice(2);
const opts = parseArgs(args);
if (opts.help) {
  console.log(`用法：
  npm run new -- <目录> [--name "产品名"] [--git] [--with-pack pm-methods]

不传参数时进入交互模式。
目标目录必须在模板目录之外；推荐放在 ../项目名。
--with-pack 会在新工位里安装可选内容包；默认不安装。`);
  process.exit(0);
}

function parseArgs(argv) {
  const parsed = { target: '', name: '', git: false, help: false, withPack: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--git') parsed.git = true;
    else if (arg === '--name') parsed.name = argv[++index] || '';
    else if (arg === '--with-pack') parsed.withPack = argv[++index] || '';
    else if (!arg.startsWith('--') && !parsed.target) parsed.target = arg;
  }
  return parsed;
}

function slugify(value) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'product-studio';
}

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

async function ask(question, fallback) {
  if (!process.stdin.isTTY) return fallback;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(question)).trim();
  rl.close();
  return answer || fallback;
}

async function main() {
  const dirArg = opts.target || (await ask('新项目目录（例如 ../宝宝喂养）：', ''));
  if (!dirArg) fail('缺少目标目录。用法：npm run new -- ../项目名 --name "产品名"');

  const target = path.resolve(process.cwd(), dirArg);
  const relativeToRoot = path.relative(ROOT, target);
  if (!relativeToRoot.startsWith('..') && !path.isAbsolute(relativeToRoot)) {
    fail('目标目录不能放在模板目录里面。请用 ../项目名 放到外面。');
  }

  if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
    fail(`目标目录已存在且不为空：${target}`);
  }

  const product = (await ask('产品名：', opts.name || path.basename(target))).trim();
  if (!product) fail('产品名不能为空。');

  fs.mkdirSync(target, { recursive: true });

  const copyFile = (file) => {
    const source = path.join(ROOT, file);
    if (!fs.existsSync(source)) return;
    const destination = path.join(target, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  };
  const copyDir = (dir) => {
    const source = path.join(ROOT, dir);
    if (!fs.existsSync(source)) return;
    fs.cpSync(source, path.join(target, dir), { recursive: true });
  };

  // 工位骨架：规则、技能、脚本、样式、文档
  for (const file of ['AGENTS.md', 'CLAUDE.md', '.gitignore', 'package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    copyFile(file);
  }
  for (const dir of ['skills', 'packs', 'scripts', 'docs', 'LICENSES', 'prototype/assets', 'prototype/spikes']) {
    copyDir(dir);
  }

  // 新项目从空开始，不复制示例需求、原型和决策
  fs.mkdirSync(path.join(target, 'prototype', 'screens'), { recursive: true });
  fs.writeFileSync(path.join(target, 'prototype', 'screens', '.gitkeep'), '');
  fs.mkdirSync(path.join(target, 'prototype', 'previews'), { recursive: true });
  fs.writeFileSync(path.join(target, 'prototype', 'previews', '.gitkeep'), '');
  fs.mkdirSync(path.join(target, 'product', 'discovery'), { recursive: true });
  fs.mkdirSync(path.join(target, 'product', 'decisions'), { recursive: true });
  copyFile('product/decisions/README.md');
  fs.writeFileSync(
    path.join(target, 'product', 'discovery', 'README.md'),
    `# 问题定义\n\n把用户访谈、问题定义、证据和假设放在这里。\n\n让 AI 用 \`synthesize-research\` 归纳材料，或直接写 \`NNN-problem-brief.md\`。\n`,
  );

  // Claude Code 的技能入口
  fs.mkdirSync(path.join(target, '.claude'), { recursive: true });
  try {
    fs.symlinkSync('../skills', path.join(target, '.claude', 'skills'), 'dir');
  } catch {
    // 不支持符号链接时仍可通过 AGENTS.md 路由使用技能
  }

  const prd = `---
product: ${product}
version: 0.1.0
updated: ${today}
owner: 产品经理
status: draft
# 强监管/企业项目改成 true；开启后每条非 dropped 需求必须有「- **依据**: ...」
basis_required: false
---

# ${product} · PRD

> 一句话说明这个产品为谁解决什么问题。

## 0. 一页摘要

| 项目 | 内容 |
| --- | --- |
| 问题 | 待补充 |
| 目标用户 | 待补充 |
| 方案 | 待补充 |
| 本期目标 | 待补充 |
| 北极星指标 | 待补充 |
| 不做什么 | 待补充 |

## 1. 背景与证据

待补充。把访谈、数据、竞品观察放在 \`product/discovery/\`，这里只写结论。

## 2. 用户与场景

待补充。

## 3. 范围

### 3.1 本期做

待补充。

### 3.2 明确不做

待补充。

## 4. 需求

还没有需求。把想法告诉 AI，先澄清问题，再写入这里。

## 5. 全局状态与边界

待补充。

## 6. 指标

待补充。

## 7. 风险与依赖

待补充。

## 8. 开放问题

待补充。

## 9. 变更记录

| 版本 | 日期 | 变更 | 影响需求 |
| --- | --- | --- | --- |
| 0.1.0 | ${today} | 初始化 | — |
`;
  fs.writeFileSync(path.join(target, 'product', 'PRD.md'), prd);

  const state = `---
stage: discovery
spec_version: 0.1.0
updated: ${today}
next_action: 先找 3 位目标用户聊一聊，把问题定义写清楚
---

# 工位状态

## 当前目标

待补充。

## 已完成

- 从模板初始化。

## 进行中

- 问题定义与用户访谈。

## 待确认 / 阻塞

- 暂无。

## 上次会话

- ${today}：从模板初始化。
`;
  fs.writeFileSync(path.join(target, 'STATE.md'), state);

  const packageJsonPath = path.join(target, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  packageJson.name = slugify(product);
  packageJson.description = `${product} 产品设计工位`;
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

  const readme = `# ${product}

这是 ${product} 的产品设计工位：PRD 与可点原型放在一起，AI 负责保持两边一致。

## 打开

双击 \`工作台.html\`。上面有当前阶段、下一步、需求进度和原型页面。

## 开始

1. 用 Claude Code / Cursor / Codex 打开这个文件夹。
2. 粘贴：

   \`\`\`text
   你是我的产品搭档。先读 AGENTS.md、STATE.md 和 product/PRD.md，用一句话告诉我现在做到哪、下一步做什么。
   然后按我说的改。改完自己运行 npm run sync 和 npm run check，刷新工作台，再告诉我：改了哪些需求、哪些页面、还有什么没定。
   不要要求我运行命令，也不要让我碰 git。
   \`\`\`

3. 直接说需求，例如：「我有个想法……先别写方案，先问我几个关键问题。」

## 常用说法

- 「我有个想法 / 帮我发散」
- 「这是我访谈的记录，帮我归纳」
- 「把需求写成 PRD / 加一条需求」
- 「一期做什么 / 砍哪些」
- 「做个新页面 / 补空状态」
- 「帮我评审，看看 PRD 和原型哪里不一致」
- 「改现有页面 / 改文案」

## 可选方法包

默认只装 3 个核心技能：\`prototype\`、\`review\`、\`change\`。需要访谈归纳、竞品、指标、汇报、发散、排期等官方方法时：

\`\`\`bash
npm run pack:list
npm run pack:add -- pm-methods
npm run pack:remove -- pm-methods
\`\`\`

\`packs/\` 是内容包源文件，不安装时不参与路由；不需要可以整个删除。

## 命令（给维护者/AI）

- \`npm run check\`：检查 PRD、原型、技能格式
- \`npm run sync\`：刷新工作台
- \`npm run export\`：生成给研发的交付包（\`dist/\` 下的文件夹和 zip）
- \`npm run pack:add -- <包名>\`：安装可选方法包
- \`npm run dev\`：可选，本地预览

完整规则见 \`AGENTS.md\`，工作流见 \`docs/workflow.md\`。企业项目的桌面/SPA/外部资源/需求依据，见 \`docs/enterprise.md\`。

## 许可证

自有代码与文档采用 MIT（见 \`LICENSE\`）；\`packs/pm-methods/\` 中的 Anthropic 技能采用 Apache-2.0（见 \`THIRD_PARTY_NOTICES.md\` 与 \`LICENSES/\`）。
`;
  fs.writeFileSync(path.join(target, 'README.md'), readme);

  if (opts.withPack) {
    const pack = spawnSync(process.execPath, ['scripts/pack.mjs', 'add', opts.withPack], {
      cwd: target,
      encoding: 'utf8',
    });
    if (pack.status !== 0) {
      console.error(pack.stdout);
      console.error(pack.stderr);
      fail(`内容包安装失败：${opts.withPack}`);
    }
    console.log(pack.stdout.trim());
  }

  const sync = spawnSync(process.execPath, ['scripts/sync.mjs'], { cwd: target, encoding: 'utf8' });
  if (sync.status !== 0) {
    console.error(sync.stdout);
    console.error(sync.stderr);
    fail(`工作台生成失败，项目已创建但需要手动检查：${target}`);
  }
  const check = spawnSync(process.execPath, ['scripts/sync.mjs', '--check', '--strict'], {
    cwd: target,
    encoding: 'utf8',
  });
  const skills = spawnSync(process.execPath, ['scripts/check-skills.mjs'], { cwd: target, encoding: 'utf8' });
  if (check.status !== 0 || skills.status !== 0) {
    console.error(check.stdout || skills.stdout);
    fail(`一致性检查未通过：${target}`);
  }

  if (opts.git) {
    const git = spawnSync('git', ['init', '-b', 'main'], { cwd: target, encoding: 'utf8' });
    if (git.status !== 0) console.warn('git 初始化失败，跳过；不影响使用。');
  }

  console.log(`\n✔ 新工位已创建：${target}`);
  console.log(`产品：${product}`);
  console.log(`入口：${path.join(target, '工作台.html')}`);
  console.log(`下一步：用 AI 打开这个文件夹，粘贴 README 里的开场白。`);
  if (!opts.git) console.log('需要 git 留底时，加 --git 重新创建，或在新目录里运行 git init。');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
