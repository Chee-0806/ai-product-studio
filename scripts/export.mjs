#!/usr/bin/env node
/**
 * 生成给研发的交付包：只包含 PRD 与可点原型。
 *
 *   npm run export
 *
 * 产物：
 *   dist/<产品>-v<版本>/index.html
 *   dist/<产品>-v<版本>.zip
 *
 * 不包含内部工作台、STATE、脚本、调研与决策原文。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRD_FILE = path.join(ROOT, 'product/PRD.md');
const SCREENS_DIR = path.join(ROOT, 'prototype/screens');
const ASSETS_DIR = path.join(ROOT, 'prototype/assets');
const DIST_DIR = path.join(ROOT, 'dist');

const esc = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const read = (file) => fs.readFileSync(file, 'utf8');
const uniq = (xs) => [...new Set(xs)];

function parseFrontMatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error('product/PRD.md 缺少 YAML front matter');
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf(':');
    if (index === -1) continue;
    data[trimmed.slice(0, index).trim()] = trimmed
      .slice(index + 1)
      .replace(/\s+#.*$/, '')
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return { data, body: text.slice(match[0].length) };
}

const STATUS_LABELS = {
  draft: '待做原型',
  prototyped: '已有原型',
  approved: '已评审',
  delivered: '已交付',
  dropped: '已砍',
};
const STATUS_ALIASES = {
  草稿: 'draft',
  待做原型: 'draft',
  原型: 'prototyped',
  已出原型: 'prototyped',
  已有原型: 'prototyped',
  已评审: 'approved',
  评审通过: 'approved',
  已交付: 'delivered',
  上线: 'delivered',
  已砍: 'dropped',
  不做: 'dropped',
};

function normalizeStatus(value) {
  if (!value) return '';
  const trimmed = value.trim();
  return STATUS_ALIASES[trimmed] || trimmed.toLowerCase();
}

function parseRequirements(body) {
  const reqs = [];
  let cur = null;
  for (const line of body.split(/\r?\n/)) {
    const heading = line.match(/^#{2,4}\s+(REQ-\d{3})\s+(.+?)\s*$/);
    if (heading) {
      if (cur) reqs.push(cur);
      cur = { id: heading[1], title: heading[2], status: '', priority: '' };
      continue;
    }
    if (!cur) continue;
    if (/^#{1,6}\s/.test(line)) {
      reqs.push(cur);
      cur = null;
      continue;
    }
    const field = line.match(/^\s*-\s*(?:\*\*)?([^*:：]+?)(?:\*\*)?\s*[:：]\s*(.*)$/);
    if (!field) continue;
    const key = field[1].trim();
    const value = field[2].trim().replace(/`/g, '');
    if (key === '状态') cur.status = normalizeStatus(value);
    else if (key === '优先级') cur.priority = value.toUpperCase();
  }
  if (cur) reqs.push(cur);
  return reqs;
}

function walkHtml(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkHtml(full));
    else if (entry.isFile() && entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

function parseScreens() {
  return walkHtml(SCREENS_DIR).map((file) => {
    const html = read(file);
    const meta = {};
    for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
      const name = tag[0].match(/\bname=["']([^"']+)["']/i)?.[1];
      const content = tag[0].match(/\bcontent=["']([^"']*)["']/i)?.[1] ?? '';
      if (name && name.toLowerCase().startsWith('screen:')) meta[name.slice(7).toLowerCase()] = content;
    }
    const reqs = uniq([...html.matchAll(/data-req=["'](REQ-\d{3})["']/g)].map((m) => m[1]));
    return {
      file,
      rel: path.relative(SCREENS_DIR, file),
      id: meta.id || path.basename(file, '.html'),
      title: meta.title || meta.id || path.basename(file, '.html'),
      flow: meta.flow || '未分组',
      reqs,
    };
  });
}

/* ---------------- Markdown → HTML（PRD 用到的子集） ---------------- */

function inline(text) {
  let value = esc(text);
  value = value.replace(/`([^`]+)`/g, '<code>$1</code>');
  value = value.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  value = value.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    if (/^https?:\/\//i.test(href)) {
      return `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`;
    }
    return `<span class="ref" title="内部附件未随交付包">${label}</span>`;
  });
  return value;
}

function tableCells(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isTableSeparator(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function renderTable(rows) {
  const parsed = rows.map(tableCells).filter((cells) => cells.length > 0);
  const hasHead = parsed.length > 1 && isTableSeparator(parsed[1]);
  const head = hasHead ? parsed[0] : null;
  const body = parsed.filter((cells, index) => !isTableSeparator(cells) && !(hasHead && index === 0));
  const thead = head ? `<thead><tr>${head.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead>` : '';
  const tbody = `<tbody>${body
    .map((cells) => `<tr>${cells.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
    .join('')}</tbody>`;
  return `<table>${thead}${tbody}</table>`;
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let paragraph = [];
  let list = null;
  let quote = [];
  let index = 0;

  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${inline(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      out.push(`<${list.type}>${list.items.join('')}</${list.type}>`);
      list = null;
    }
  };
  const flushQuote = () => {
    if (quote.length) {
      out.push(`<blockquote><p>${quote.map((line) => inline(line)).join('<br>')}</p></blockquote>`);
      quote = [];
    }
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };
  const ensureList = (type) => {
    if (list && list.type !== type) flushList();
    if (!list) list = { type, items: [] };
  };

  while (index < lines.length) {
    const line = lines[index];

    if (/^```/.test(line)) {
      flushAll();
      const lang = line.replace(/^```/, '').trim();
      const code = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index])) code.push(lines[index++]);
      index += 1;
      const source = esc(code.join('\n'));
      out.push(
        lang === 'mermaid'
          ? `<div class="mermaid"><div class="mermaid__label">流程图（Mermaid 源码）</div><pre><code>${source}</code></pre></div>`
          : `<pre><code>${source}</code></pre>`,
      );
      continue;
    }

    if (/^\s*$/.test(line)) {
      flushAll();
      index += 1;
      continue;
    }

    if (/^#{1,6}\s/.test(line)) {
      flushAll();
      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*\|/.test(line)) {
      flushAll();
      const rows = [];
      while (index < lines.length && /^\s*\|/.test(lines[index])) rows.push(lines[index++]);
      out.push(renderTable(rows));
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushAll();
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ''));
        index += 1;
      }
      flushQuote();
      continue;
    }

    const checkbox = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (checkbox) {
      ensureList('ul');
      list.items.push(
        `<li class="check${checkbox[1].toLowerCase() === 'x' ? ' is-done' : ''}"><span class="box">${
          checkbox[1].toLowerCase() === 'x' ? '☑' : '☐'
        }</span>${inline(checkbox[2])}</li>`,
      );
      index += 1;
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      ensureList('ul');
      list.items.push(`<li>${inline(bullet[1])}</li>`);
      index += 1;
      continue;
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ordered) {
      ensureList('ol');
      list.items.push(`<li>${inline(ordered[1])}</li>`);
      index += 1;
      continue;
    }

    if (/^---+\s*$/.test(line)) {
      flushAll();
      out.push('<hr>');
      index += 1;
      continue;
    }

    paragraph.push(line);
    index += 1;
  }
  flushAll();
  return out.join('\n');
}

/* ---------------- 页面 ---------------- */

const BASE_CSS = `
  :root {
    --ink: #17191f; --muted: #667085; --line: #e4e7f0; --bg: #f5f6fa;
    --brand: #4f46e5; --brand-weak: #eef0ff; --surface: #fff;
    --font: -apple-system, BlinkMacSystemFont, "SF Pro SC", "PingFang SC", "Segoe UI", sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--font); line-height: 1.7; }
  a { color: var(--brand); }
  .shell { max-width: 1060px; margin: 0 auto; padding: 40px 24px 80px; }
  .eyebrow { margin: 0 0 8px; font-size: 12px; font-weight: 700; letter-spacing: .12em; color: var(--brand); }
  .top { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
  h1 { margin: 0; font-size: 38px; line-height: 1.2; letter-spacing: -.02em; }
  .meta { margin: 8px 0 0; color: var(--muted); font-size: 14px; }
  .back { font-size: 13px; text-decoration: none; }
  .card { display: block; padding: 22px 24px; border: 1px solid var(--line); border-radius: 18px; background: var(--surface); text-decoration: none; color: inherit; transition: border-color .15s ease, transform .15s ease; }
  .card:hover { border-color: var(--brand); transform: translateY(-1px); }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; margin-top: 24px; }
  .card strong { display: block; font-size: 18px; }
  .card p { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
  .card .num { display: inline-block; margin-bottom: 10px; color: var(--brand); font: 600 12px var(--mono); }
  h2 { margin: 40px 0 14px; font-size: 18px; letter-spacing: -.01em; }
  table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; font-size: 14px; }
  th, td { text-align: left; padding: 11px 14px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: 12px; color: var(--muted); background: #fafbfe; font-weight: 600; }
  tr:last-child td { border-bottom: 0; }
  .muted { color: var(--muted); }
  footer { margin-top: 44px; padding-top: 16px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
  @media (max-width: 640px) { .shell { padding: 28px 16px 60px; } h1 { font-size: 30px; } }
`;

const PRD_CSS = `
  ${BASE_CSS}
  .doc { background: var(--surface); border: 1px solid var(--line); border-radius: 20px; padding: 36px 40px; margin-top: 24px; }
  .doc h1 { font-size: 30px; }
  .doc h2 { margin: 34px 0 10px; padding-top: 18px; border-top: 1px solid var(--line); font-size: 20px; }
  .doc h3 { margin: 24px 0 8px; font-size: 16px; }
  .doc h4 { margin: 18px 0 6px; font-size: 15px; }
  .doc p { margin: 8px 0; }
  .doc ul, .doc ol { margin: 8px 0; padding-left: 24px; }
  .doc li { margin: 4px 0; }
  .doc li.check { list-style: none; margin-left: -20px; }
  .doc .box { display: inline-block; width: 1.2em; color: var(--brand); }
  .doc li.is-done { color: var(--muted); }
  .doc table { margin: 14px 0; }
  .doc blockquote { margin: 14px 0; padding: 10px 16px; border-left: 3px solid var(--brand); background: var(--brand-weak); color: #3f3a8f; border-radius: 0 10px 10px 0; }
  .doc blockquote p { margin: 0; }
  .doc code { font-family: var(--mono); font-size: 12px; background: #f2f3f8; border-radius: 5px; padding: 2px 6px; }
  .doc pre { overflow: auto; padding: 14px 16px; border-radius: 12px; background: #16181d; color: #e8eaf2; }
  .doc pre code { background: transparent; padding: 0; color: inherit; }
  .doc .mermaid { margin: 14px 0; }
  .doc .mermaid__label { margin-bottom: 6px; font-size: 12px; color: var(--muted); }
  .doc .ref { color: var(--muted); border-bottom: 1px dotted var(--line); }
  .doc hr { border: 0; border-top: 1px solid var(--line); margin: 24px 0; }
  @media (max-width: 640px) { .doc { padding: 22px 18px; } }
  @media print { body { background: #fff; } .shell { max-width: none; padding: 0; } .doc { border: 0; padding: 0; } .back { display: none; } }
`;

function renderPrdPage(product, prd, markdown) {
  const body = markdown.replace(/^\s*#\s+.*(?:\r?\n|$)/, '');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(product)} · PRD v${esc(prd.version)}</title>
<style>${PRD_CSS}</style>
</head>
<body>
<div class="shell">
  <div class="top">
    <div>
      <p class="eyebrow">PRODUCT REQUIREMENTS</p>
      <h1>${esc(product)}</h1>
      <p class="meta">PRD v${esc(prd.version)} · 更新于 ${esc(prd.updated)}</p>
    </div>
    <a class="back" href="index.html">← 交付首页</a>
  </div>
  <article class="doc">${renderMarkdown(body)}</article>
</div>
</body>
</html>
`;
}

function renderHandoffIndex(product, prd, reqs, screens, covered) {
  const active = reqs.filter((req) => req.status !== 'dropped');
  const done = active.filter((req) => (covered.get(req.id) || []).length > 0);
  const rows = active
    .map((req) => {
      const pages = covered.get(req.id) || [];
      const pageLinks = pages.length
        ? pages
            .map((screen) => `<a href="prototype/screens/${esc(screen.rel)}">${esc(screen.title)}</a>`)
            .join('、')
        : '<span class="muted">—</span>';
      return `<tr><td><code>${esc(req.id)}</code></td><td>${esc(req.title)}</td><td>${esc(
        req.priority || '—',
      )}</td><td>${esc(STATUS_LABELS[req.status] || req.status || '—')}</td><td>${pageLinks}</td></tr>`;
    })
    .join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(product)} · 交付包 v${esc(prd.version)}</title>
<style>${BASE_CSS}
  .hero { margin-top: 24px; padding: 26px 28px; border-radius: 20px; color: #fff; background: linear-gradient(135deg, #4f46e5, #4338ca); box-shadow: 0 14px 34px rgba(79,70,229,.24); }
  .hero h2 { margin: 0 0 6px; font-size: 21px; }
  .hero p { margin: 0; color: rgba(255,255,255,.78); font-size: 13px; }
  .hero .stats { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 16px; font-size: 13px; }
  .hero .stats strong { font-size: 22px; }
  .files { margin-top: 18px; padding: 16px 18px; background: var(--surface); border: 1px solid var(--line); border-radius: 16px; font-size: 13px; }
  .files code { font-family: var(--mono); font-size: 12px; background: #f2f3f8; padding: 2px 6px; border-radius: 5px; }
  .files ul { margin: 8px 0 0; padding-left: 20px; }
</style>
</head>
<body>
<div class="shell">
  <div class="top">
    <div>
      <p class="eyebrow">HANDOFF PACKAGE</p>
      <h1>${esc(product)}</h1>
      <p class="meta">PRD v${esc(prd.version)} · 更新于 ${esc(prd.updated)} · 导出于 ${esc(new Date().toISOString().slice(0, 10))}</p>
    </div>
  </div>

  <section class="hero">
    <h2>需求与原型交付包</h2>
    <p>给对方只需要这一个文件夹；内部工作台、状态和脚本不在这里。</p>
    <div class="stats">
      <span><strong>${active.length}</strong> 条有效需求</span>
      <span><strong>${done.length}</strong> 条已有原型</span>
      <span><strong>${screens.length}</strong> 个原型页面</span>
    </div>
  </section>

  <div class="grid">
    <a class="card" href="PRD.html">
      <span class="num">01 / PRD</span>
      <strong>产品需求文档</strong>
      <p>问题、范围、需求、验收、状态与指标</p>
    </a>
    <a class="card" href="prototype/index.html">
      <span class="num">02 / PROTOTYPE</span>
      <strong>可点原型</strong>
      <p>${screens.length} 个静态页面，直接双击打开</p>
    </a>
  </div>

  <h2>需求 → 原型页面</h2>
  ${
    active.length
      ? `<table>
    <thead><tr><th>ID</th><th>需求</th><th>优先级</th><th>状态</th><th>页面</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`
      : '<p class="muted">PRD 中没有有效需求。</p>'
  }

  <div class="files">
    <strong>包内文件</strong>
    <ul>
      <li><code>index.html</code>：这个首页</li>
      <li><code>PRD.html</code>：可阅读的 PRD；<code>PRD.md</code>：原始 Markdown</li>
      <li><code>prototype/index.html</code>：原型目录；<code>prototype/screens/</code>：页面</li>
      <li><code>README.md</code>：交付说明</li>
    </ul>
  </div>

  <footer>由产品设计工位导出 · ${esc(product)} · v${esc(prd.version)}</footer>
</div>
</body>
</html>
`;
}

function renderPrototypeIndex(product, prd, screens) {
  const cards = screens
    .map(
      (screen) => `<a class="screen" href="screens/${esc(screen.rel)}">
      <span class="screen__flow">${esc(screen.flow)}</span>
      <strong>${esc(screen.title)}</strong>
      <span class="screen__id">${esc(screen.id)}</span>
      <span class="screen__reqs">${
        screen.reqs.length ? screen.reqs.map((id) => `<code>${esc(id)}</code>`).join('') : '<span class="muted">未标注需求</span>'
      }</span>
    </a>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(product)} · 原型目录</title>
<style>${BASE_CSS}
  .screens { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; margin-top: 22px; }
  .screen { display: flex; flex-direction: column; gap: 4px; padding: 20px; border: 1px solid var(--line); border-radius: 18px; background: var(--surface); color: inherit; text-decoration: none; transition: border-color .15s ease, transform .15s ease; }
  .screen:hover { border-color: var(--brand); transform: translateY(-1px); }
  .screen__flow { font-size: 11px; font-weight: 600; color: var(--brand); }
  .screen strong { font-size: 17px; }
  .screen__id { font: 12px var(--mono); color: var(--muted); }
  .screen__reqs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .screen__reqs code { font: 11px var(--mono); background: var(--brand-weak); color: #3730a3; padding: 2px 6px; border-radius: 5px; }
</style>
</head>
<body>
<div class="shell">
  <div class="top">
    <div>
      <p class="eyebrow">INTERACTIVE PROTOTYPE</p>
      <h1>${esc(product)} · 原型</h1>
      <p class="meta">${screens.length} 个页面 · 对应 PRD v${esc(prd.version)}</p>
    </div>
    <div>
      <a class="back" href="../index.html">← 交付首页</a>
      &nbsp;·&nbsp;
      <a class="back" href="../PRD.html">PRD</a>
    </div>
  </div>
  <div class="screens">${cards || '<p class="muted">还没有原型页面。</p>'}</div>
  <footer>静态 HTML 原型，仅用于需求与交互确认，不含后端逻辑。</footer>
</div>
</body>
</html>
`;
}

function renderPackageReadme(product, prd, reqs, screens) {
  return `# ${product} · 交付包

- 版本：v${prd.version}
- PRD 更新：${prd.updated}
- 导出日期：${new Date().toISOString().slice(0, 10)}
- 有效需求：${reqs.filter((req) => req.status !== 'dropped').length}
- 原型页面：${screens.length}

## 打开方式

1. 双击根目录的 \`index.html\`。
2. 看需求：\`PRD.html\`；需要原始 Markdown 时看 \`PRD.md\`。
3. 看原型：\`prototype/index.html\`，再点具体页面。

## 包含

- \`PRD.html\` / \`PRD.md\`
- \`prototype/\`：静态 HTML 页面与共享样式
- \`index.html\`：交付首页

## 不包含

- 内部工作台、\`STATE.md\`、脚本与检查工具
- 调研原始材料、决策记录（如需请单独提供）
- 后端、真实数据、登录与权限实现

## 说明

原型是静态 HTML，用于确认流程、界面和边界态，不是生产代码。需求中的验收标准以 \`PRD.html\` 为准。
`;
}

/* ---------------- 构建 ---------------- */

function build() {
  const prdText = read(PRD_FILE);
  const { data: prd, body } = parseFrontMatter(prdText);
  const reqs = parseRequirements(body);
  const screens = parseScreens();
  const covered = new Map();
  for (const screen of screens) {
    for (const id of screen.reqs) {
      if (!covered.has(id)) covered.set(id, []);
      covered.get(id).push(screen);
    }
  }

  const product = (prd.product || '产品').trim();
  const version = prd.version || '0.0.0';
  const safeName = product.replace(/[\\/:*?"<>|]/g, '-').trim() || 'product';
  const baseName = `${safeName}-v${version}`;
  const outDir = path.join(DIST_DIR, baseName);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'prototype', 'screens'), { recursive: true });
  fs.cpSync(SCREENS_DIR, path.join(outDir, 'prototype', 'screens'), { recursive: true });
  fs.cpSync(ASSETS_DIR, path.join(outDir, 'prototype', 'assets'), { recursive: true });

  for (const file of walkHtml(path.join(outDir, 'prototype', 'screens'))) {
    const html = read(file)
      .replace(/href="\.\.\/\.\.\/工作台\.html"/g, 'href="../index.html"')
      .replace(/>← 工作台</g, '>← 原型目录<');
    fs.writeFileSync(file, html);
  }

  fs.writeFileSync(path.join(outDir, 'PRD.md'), prdText);
  fs.writeFileSync(path.join(outDir, 'PRD.html'), renderPrdPage(product, prd, body));
  fs.mkdirSync(path.join(outDir, 'prototype'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'prototype', 'index.html'), renderPrototypeIndex(product, prd, screens));
  fs.writeFileSync(path.join(outDir, 'index.html'), renderHandoffIndex(product, prd, reqs, screens, covered));
  fs.writeFileSync(path.join(outDir, 'README.md'), renderPackageReadme(product, prd, reqs, screens));

  const zipName = `${baseName}.zip`;
  const zipPath = path.join(DIST_DIR, zipName);
  fs.rmSync(zipPath, { force: true });
  const zipped = spawnSync('zip', ['-r', '-q', zipName, baseName, '-x', '*.DS_Store'], {
    cwd: DIST_DIR,
    encoding: 'utf8',
  });

  console.log(`交付包：${path.relative(ROOT, outDir)}/`);
  console.log(`入口：  ${path.relative(ROOT, path.join(outDir, 'index.html'))}`);
  console.log(`PRD：   ${path.relative(ROOT, path.join(outDir, 'PRD.html'))}`);
  console.log(`原型：  ${path.relative(ROOT, path.join(outDir, 'prototype', 'index.html'))}`);
  if (zipped.status === 0) console.log(`压缩包：${path.relative(ROOT, zipPath)}`);
  else console.log('压缩失败：系统没有 zip 命令，直接发送上面的文件夹即可。');
}

build();
