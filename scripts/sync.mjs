#!/usr/bin/env node
/**
 * 校验 PRD 与原型的一致性，并生成根目录的「工作台.html」。
 *
 *   node scripts/sync.mjs           校验 + 重建工作台
 *   node scripts/sync.mjs --check   只校验（工作台过期即失败）
 *   node scripts/sync.mjs --strict  把警告也视为失败（npm run check 默认开启）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');
const STRICT = process.argv.includes('--strict');

const PRD = path.join(ROOT, 'product/PRD.md');
const STATE = path.join(ROOT, 'STATE.md');
const SCREENS_DIR = path.join(ROOT, 'prototype/screens');
const GALLERY = path.join(ROOT, '工作台.html');

const errors = [];
const warnings = [];

const rel = (p) => path.relative(ROOT, p);
const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);
const uniq = (xs) => [...new Set(xs)];
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STATUS = {
  draft: { label: '待做原型', cls: 'draft' },
  prototyped: { label: '原型已完成', cls: 'prototyped' },
  approved: { label: '已评审', cls: 'approved' },
  delivered: { label: '已交付', cls: 'delivered' },
  dropped: { label: '已砍', cls: 'dropped' },
};
const STATUS_ALIASES = {
  草稿: 'draft',
  原型: 'prototyped',
  已出原型: 'prototyped',
  已评审: 'approved',
  评审通过: 'approved',
  已交付: 'delivered',
  上线: 'delivered',
  已砍: 'dropped',
  不做: 'dropped',
};
const STAGES = ['discovery', 'prd', 'prototype', 'review', 'handoff'];
const STAGE_LABELS = {
  discovery: '调研问题',
  prd: '写需求',
  prototype: '做原型',
  review: '评审',
  handoff: '交接研发',
};

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    fail(`缺少必需文件：${rel(file)}`);
    return null;
  }
}

/** 解析极简 YAML front matter：只支持 key: value 与 # 注释。 */
function parseFrontMatter(text, file) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    fail(`${rel(file)}：缺少 YAML front matter（--- 开头）`);
    return {};
  }
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) {
      warn(`${rel(file)}：无法解析 front matter 行「${trimmed}」`);
      continue;
    }
    const key = trimmed.slice(0, colon).trim();
    const value = trimmed
      .slice(colon + 1)
      .replace(/\s+#.*$/, '')
      .trim()
      .replace(/^["']|["']$/g, '');
    data[key] = value;
  }
  return data;
}

/** 解析 ### REQ-001 标题 及其元数据。 */
function parseRequirements(body, file) {
  const reqs = [];
  let cur = null;
  let inAcceptance = false;

  const flush = () => {
    if (cur) reqs.push(cur);
    cur = null;
    inAcceptance = false;
  };

  body.split(/\r?\n/).forEach((line, index) => {
    const heading = line.match(/^#{2,4}\s+(REQ-\d{3})\s+(.+?)\s*$/);
    if (heading) {
      flush();
      cur = {
        id: heading[1],
        title: heading[2],
        file,
        line: index + 1,
        status: '',
        priority: '',
        acceptance: 0,
        story: '',
      };
      return;
    }
    if (!cur) return;
    if (/^#{1,6}\s/.test(line)) {
      flush();
      return;
    }
    if (inAcceptance && /^\s*-\s*\[[ xX]\]/.test(line)) {
      cur.acceptance += 1;
      return;
    }
    const field = line.match(/^\s*-\s*(?:\*\*)?([^*:：]+?)(?:\*\*)?\s*[:：]\s*(.*)$/);
    if (!field) return;
    const key = field[1].trim();
    const value = field[2].trim().replace(/`/g, '');
    inAcceptance = false;
    if (key === '状态') cur.status = value;
    else if (key === '优先级') cur.priority = value.toUpperCase();
    else if (key === '用户故事') cur.story = value;
    else if (key === '验收') inAcceptance = true;
  });
  flush();
  return reqs;
}

function normalizeStatus(raw) {
  if (!raw) return '';
  const value = raw.trim();
  if (STATUS[value]) return value;
  if (STATUS_ALIASES[value]) return STATUS_ALIASES[value];
  return value.toLowerCase();
}

function walkHtml(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => cmp(a.name, b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkHtml(full));
    else if (entry.isFile() && entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

function parseScreen(file) {
  const html = fs.readFileSync(file, 'utf8');
  const meta = {};
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const name = tag[0].match(/\bname=["']([^"']+)["']/i)?.[1];
    const content = tag[0].match(/\bcontent=["']([^"']*)["']/i)?.[1] ?? '';
    if (name && name.toLowerCase().startsWith('screen:')) {
      meta[name.slice(7).toLowerCase()] = content;
    }
  }
  const reqs = uniq([...html.matchAll(/data-req=["'](REQ-\d{3})["']/g)].map((m) => m[1]));
  return {
    file,
    relFile: path.relative(ROOT, file),
    id: (meta.id || '').trim(),
    title: (meta.title || '').trim(),
    flow: (meta.flow || '').trim(),
    reqs,
  };
}

function validatePrd(prd) {
  const required = ['product', 'version', 'updated', 'status'];
  for (const key of required) {
    if (!prd[key]) fail(`product/PRD.md：front matter 缺少 ${key}`);
  }
  if (prd.version && !/^\d+\.\d+\.\d+$/.test(prd.version)) {
    fail(`product/PRD.md：version 必须是 SemVer，如 0.2.0（当前「${prd.version}」）`);
  }
  if (prd.updated && !/^\d{4}-\d{2}-\d{2}$/.test(prd.updated)) {
    fail(`product/PRD.md：updated 必须是 YYYY-MM-DD（当前「${prd.updated}」）`);
  }
  if (prd.status && !['draft', 'review', 'approved'].includes(prd.status)) {
    fail(`product/PRD.md：status 只能是 draft | review | approved（当前「${prd.status}」）`);
  }
}

function validateRequirements(reqs) {
  const seen = new Map();
  for (const req of reqs) {
    if (seen.has(req.id)) {
      fail(`需求 ID 重复：${req.id}（${rel(req.file)}:${req.line} 与 ${rel(seen.get(req.id).file)}:${seen.get(req.id).line}）`);
    } else {
      seen.set(req.id, req);
    }

    const status = normalizeStatus(req.status);
    req.status = status;
    if (!req.status) {
      fail(`${req.id}：缺少「- **状态**: ...」`);
    } else if (!STATUS[req.status]) {
      fail(`${req.id}：状态「${req.status}」不合法，只能是 ${Object.keys(STATUS).join(' | ')}`);
    }

    if (!req.priority) {
      fail(`${req.id}：缺少「- **优先级**: P0/P1/P2」`);
    } else if (!['P0', 'P1', 'P2'].includes(req.priority)) {
      fail(`${req.id}：优先级「${req.priority}」不合法，只能是 P0 | P1 | P2`);
    }

    if (req.status !== 'dropped' && req.acceptance === 0) {
      fail(`${req.id}：至少需要一条「- [ ]」验收标准`);
    }
  }
  return seen;
}

function validateState(state, prd) {
  if (!state) return;
  if (!state.stage) fail('STATE.md：front matter 缺少 stage');
  else if (!STAGES.includes(state.stage)) {
    fail(`STATE.md：stage 只能是 ${STAGES.join(' | ')}（当前「${state.stage}」）`);
  }
  if (!state.spec_version) fail('STATE.md：front matter 缺少 spec_version');
  else if (state.spec_version !== prd.version) {
    fail(`版本不一致：PRD 是 ${prd.version}，STATE.md 是 ${state.spec_version}。改 PRD 必须同步 STATE.md`);
  }
  if (!state.updated) fail('STATE.md：front matter 缺少 updated');
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(state.updated)) {
    fail(`STATE.md：updated 必须是 YYYY-MM-DD（当前「${state.updated}」）`);
  }
  if (!state.next_action) fail('STATE.md：front matter 缺少 next_action（下一件具体要做的事）');
}

function validateScreens(screens, reqMap) {
  const ids = new Map();
  const covered = new Map();
  for (const screen of screens) {
    if (!screen.id) fail(`${screen.relFile}：缺少 <meta name="screen:id">`);
    if (!screen.title) fail(`${screen.relFile}：缺少 <meta name="screen:title">`);
    if (!screen.flow) warn(`${screen.relFile}：缺少 <meta name="screen:flow">，工作台会归入「未分组」`);
    if (screen.id) {
      if (ids.has(screen.id)) fail(`页面 ID 重复：${screen.id}（${screen.relFile} 与 ${ids.get(screen.id)}）`);
      else ids.set(screen.id, screen.relFile);
    }
    if (screen.reqs.length === 0) warn(`${screen.relFile}：没有任何 data-req，无法追溯到需求`);
    for (const reqId of screen.reqs) {
      if (!reqMap.has(reqId)) {
        fail(`${screen.relFile}：data-req="${reqId}" 在 PRD 中不存在（原型不能定义新需求）`);
        continue;
      }
      if (!covered.has(reqId)) covered.set(reqId, []);
      covered.get(reqId).push(screen);
    }
  }
  return covered;
}

function validateCoverage(reqMap, covered) {
  for (const req of reqMap.values()) {
    const screens = covered.get(req.id) || [];
    if (req.status === 'dropped') {
      if (screens.length > 0) {
        fail(`${req.id} 已标记 dropped，但 ${screens.map((s) => s.relFile).join('、')} 仍在覆盖它`);
      }
      continue;
    }
    if (req.status === 'draft' && screens.length > 0) {
      warn(`${req.id} 状态是 draft，但已有页面覆盖。要么把状态改成 prototyped，要么移除覆盖`);
    }
    if (['prototyped', 'approved', 'delivered'].includes(req.status) && screens.length === 0) {
      fail(`${req.id} 状态是 ${req.status}，但没有页面带 data-req="${req.id}"`);
    }
  }
}

function screenPreviewHtml(file, tokens, appCss) {
  let html = fs.readFileSync(file, 'utf8');
  const css = `${tokens}\n${appCss.replace(/@import url\("\.\/tokens\.css"\);\s*/, '')}`;
  html = html.replace(/<link[^>]+href=["']\.\.\/assets\/app\.css["'][^>]*>/i, `<style>\n${css}\n</style>`);
  html = html.replace(/\s*<a class="proto-link"[\s\S]*?<\/a>/, '');
  return html;
}

function renderGallery(prd, state, reqs, screens, covered) {
  const tokens = fs.readFileSync(path.join(ROOT, 'prototype/assets/tokens.css'), 'utf8');
  const appCss = fs.readFileSync(path.join(ROOT, 'prototype/assets/app.css'), 'utf8');
  const stageLabel = STAGE_LABELS[state.stage] || state.stage || '未设置';
  const nextAction = state.next_action || '先读一遍 PRD，确定下一步要做什么';
  const sortedReqs = [...reqs].sort((a, b) => cmp(a.id, b.id));
  const reqOrder = (screen) =>
    screen.reqs.length ? Math.min(...screen.reqs.map((id) => Number(id.slice(4)))) : 9999;
  const sortedScreens = [...screens].sort(
    (a, b) => reqOrder(a) - reqOrder(b) || cmp(a.flow || '未分组', b.flow || '未分组') || cmp(a.id, b.id),
  );
  const active = sortedReqs.filter((r) => r.status !== 'dropped');
  const done = active.filter((r) => (covered.get(r.id) || []).length > 0);

  const groups = new Map();
  for (const screen of sortedScreens) {
    const key = screen.flow || '未分组';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(screen);
  }

  const pills = (status) => {
    const meta = STATUS[status] || { label: status || '未知', cls: 'draft' };
    return `<span class="pill pill--${meta.cls}">${esc(meta.label)}</span>`;
  };

  const reqRows = sortedReqs
    .map((req) => {
      const screensForReq = covered.get(req.id) || [];
      const links = screensForReq.length
        ? screensForReq
            .map((s) => `<a href="${esc(s.relFile)}">${esc(s.title || s.id)}</a>`)
            .join('、')
        : '<span class="muted">—</span>';
      return `<tr class="${req.status === 'dropped' ? 'is-dropped' : ''}">
        <td><code>${esc(req.id)}</code></td>
        <td>${esc(req.title)}</td>
        <td>${esc(req.priority || '—')}</td>
        <td>${pills(req.status)}</td>
        <td>${links}</td>
      </tr>`;
    })
    .join('\n');

  const cardsByFlow = [...groups.entries()]
    .map(
      ([flow, list]) => `<section class="flow-group">
      <h3 class="flow-title">${esc(flow)} <span class="muted">${list.length}</span></h3>
      <div class="grid">
        ${list
          .map(
            (screen) => `<article class="card">
          <a class="card__frame" href="${esc(screen.relFile)}" aria-label="打开 ${esc(screen.title)}">
            <iframe srcdoc="${esc(screenPreviewHtml(screen.file, tokens, appCss))}" title="${esc(screen.title)}" loading="lazy" tabindex="-1"></iframe>
          </a>
          <div class="card__body">
            <div class="card__head">
              <h3>${esc(screen.title || screen.id)}</h3>
              <span class="flow">${esc(screen.flow || '未分组')}</span>
            </div>
            <p class="card__hint">点击打开可交互原型 →</p>
            <div class="tags">${
              screen.reqs.length
                ? screen.reqs.map((r) => `<code>${esc(r)}</code>`).join('')
                : '<span class="muted">未标注 data-req</span>'
            }</div>
          </div>
        </article>`,
          )
          .join('\n')}
      </div>
    </section>`,
    )
    .join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(prd.product || '产品')} · 工作台</title>
<style>
  :root {
    --bg: #f4f5f9; --surface: #fff; --text: #16181d; --muted: #6b7280;
    --line: #e4e6ef; --brand: #4f46e5; --brand-weak: #eef0ff;
    --green: #0f7b5f; --green-weak: #e7f7f1; --amber: #9a6700; --amber-weak: #fff6e0;
    --red: #b42318; --red-weak: #fdecea; --gray-weak: #eef0f4;
    --radius: 18px; --shadow: 0 1px 2px rgba(16,24,40,.04), 0 12px 32px rgba(16,24,40,.06);
    --font: -apple-system, BlinkMacSystemFont, "SF Pro SC", "PingFang SC", "Segoe UI", sans-serif;
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font); line-height: 1.55; }
  .wrap { max-width: 1320px; margin: 0 auto; padding: 48px 28px 80px; }
  .eyebrow { margin: 0 0 8px; font-size: 12px; font-weight: 700; letter-spacing: .12em; color: var(--brand); }
  h1 { margin: 0; font-size: 40px; line-height: 1.15; letter-spacing: -.02em; }
  .sub { margin: 10px 0 0; color: var(--muted); font-size: 15px; }
  .generated { margin: 18px 0 0; font-size: 12px; color: var(--muted); }
  .generated code { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 1px 6px; }
  .next { margin: 26px 0 0; padding: 20px 22px; border-radius: 18px; background: linear-gradient(135deg, #4f46e5, #4338ca); color: #fff; display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; box-shadow: 0 14px 34px rgba(79,70,229,.24); }
  .next__label { margin: 0; font-size: 11px; font-weight: 700; letter-spacing: .14em; color: rgba(255,255,255,.7); }
  .next h2 { margin: 7px 0 0; font-size: 20px; line-height: 1.45; letter-spacing: -.01em; color: #fff; font-weight: 650; }
  .next__version { flex: none; padding: 3px 10px; border-radius: 999px; background: rgba(255,255,255,.16); font-size: 12px; font-weight: 600; white-space: nowrap; }
  .howto { margin: 16px 0 0; padding: 18px 20px; border: 1px solid var(--line); border-radius: 18px; background: var(--surface); }
  .howto h2 { margin: 0 0 8px; font-size: 15px; }
  .howto ol { margin: 0; padding-left: 20px; display: grid; gap: 4px; font-size: 13.5px; color: var(--text); }
  .howto__note { margin: 10px 0 0; font-size: 12px; color: var(--muted); }
  .handoff { margin: 16px 0 0; padding: 18px 20px; border: 1px solid var(--brand-weak); border-radius: 18px; background: linear-gradient(135deg, #eef0ff, #f8f9fd); }
  .handoff h2 { margin: 0 0 6px; font-size: 15px; }
  .handoff p { margin: 0; font-size: 13px; color: var(--text); }
  .handoff .handoff__note { margin-top: 8px; font-size: 12px; color: var(--muted); }
  .prompt { margin-top: 12px; }
  .prompt summary { cursor: pointer; font-size: 12px; font-weight: 600; color: var(--brand); }
  .prompt pre { margin: 10px 0 0; padding: 12px 14px; border-radius: 12px; background: #f7f8fc; border: 1px solid var(--line); white-space: pre-wrap; word-break: break-word; font-family: var(--font); font-size: 12.5px; line-height: 1.6; color: var(--text); }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 28px 0 36px; }
  .stat { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; }
  .stat b { display: block; font-size: 26px; letter-spacing: -.02em; }
  .stat span { font-size: 12px; color: var(--muted); }
  h2 { margin: 40px 0 14px; font-size: 18px; letter-spacing: -.01em; }
  table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; font-size: 14px; }
  th, td { text-align: left; padding: 11px 14px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: 12px; color: var(--muted); font-weight: 600; background: #fafbfe; }
  tr:last-child td { border-bottom: 0; }
  tr.is-dropped td { color: var(--muted); text-decoration: line-through; }
  tr.is-dropped td:last-child { text-decoration: none; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: var(--gray-weak); border-radius: 5px; padding: 2px 6px; }
  td a { color: var(--brand); text-decoration: none; }
  td a:hover { text-decoration: underline; }
  .pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
  .pill--draft { background: var(--gray-weak); color: var(--muted); }
  .pill--prototyped { background: var(--brand-weak); color: var(--brand); }
  .pill--approved { background: var(--green-weak); color: var(--green); }
  .pill--delivered { background: var(--green-weak); color: var(--green); }
  .pill--dropped { background: var(--red-weak); color: var(--red); }
  .flow-group { margin-top: 28px; }
  .flow-title { margin: 0 0 12px; font-size: 14px; color: var(--muted); font-weight: 600; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
  .card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
  .card__frame { display: block; aspect-ratio: 390 / 760; background: #e9eaf2; overflow: hidden; }
  .card__frame iframe { width: 100%; height: 100%; border: 0; display: block; pointer-events: none; }
  .card__body { padding: 14px 16px 16px; }
  .card__head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .card__head h3 { margin: 0; font-size: 15px; }
  .flow { font-size: 11px; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 1px 8px; white-space: nowrap; }
  .card__hint { margin: 4px 0 10px; font-size: 12px; color: var(--brand); font-weight: 600; }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; }
  .muted { color: var(--muted); }
  .empty { padding: 28px; text-align: center; color: var(--muted); background: var(--surface); border: 1px dashed var(--line); border-radius: var(--radius); }
  footer { margin-top: 48px; padding-top: 18px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
  @media (max-width: 640px) {
    .wrap { padding: 32px 16px 60px; }
    h1 { font-size: 30px; }
    .next { flex-direction: column; gap: 10px; }
    .next__version { align-self: flex-start; }
    table { font-size: 12px; }
    th, td { padding: 9px 10px; }
    th:nth-child(1), td:nth-child(1), th:nth-child(3), td:nth-child(3) { display: none; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <p class="eyebrow">产品工作台</p>
    <h1>${esc(prd.product || '未命名产品')}</h1>
    <p class="sub">当前阶段：${esc(stageLabel)} · 规格 v${esc(prd.version || '0.0.0')} · 更新于 ${esc(prd.updated || '—')} · ${
      active.length ? `${done.length}/${active.length} 个需求已有原型` : '还没有需求'
    }</p>
    <p class="generated">这个页面由 AI 自动生成，不用手改。</p>
  </header>

  <section class="next">
    <div>
      <p class="next__label">下一步</p>
      <h2>${esc(nextAction)}</h2>
    </div>
    <span class="next__version">v${esc(prd.version || '0.0.0')}</span>
  </section>

  <section class="howto">
    <h2>怎么用这个工位</h2>
    <ol>
      <li>把想要的功能直接说给 AI，不用先写文档。</li>
      <li>点下面的页面看原型，把不满意的地方告诉 AI。</li>
      <li>每次改完让 AI「刷新工作台」，它会自己检查两边是否一致。</li>
    </ol>
    <p class="howto__note">不需要 git，不需要命令行，也不需要懂代码。不要自己改这个页面。</p>
    <p class="howto__note">常用说法：「我有个想法……先问我几个关键问题」「把首页改简单点」「帮我评审，看看哪里不一致」。</p>
    <details class="prompt">
      <summary>给 AI 的开场白（点开）</summary>
      <pre>你是我的产品搭档。先读 AGENTS.md、STATE.md 和 product/PRD.md，用一句话告诉我现在做到哪、下一步做什么。
然后按我说的改。改完自己运行 npm run sync 和 npm run check，刷新工作台，再告诉我：改了哪些需求、哪些页面、还有什么没定。
不要要求我运行命令，也不要让我碰 git。</pre>
    </details>
  </section>

  <section class="handoff">
    <h2>要发给研发？</h2>
    <p>不要发整个工作区。对 AI 说「导出交付包」，它会生成只含 PRD 和原型的 zip。</p>
    <p class="handoff__note">产物在 dist/ 下：同名文件夹 + 同名 .zip。</p>
  </section>

  <section class="stats">
    <div class="stat"><b>${sortedReqs.length}</b><span>需求总数</span></div>
    <div class="stat"><b>${done.length}</b><span>已有原型（不含已砍）</span></div>
    <div class="stat"><b>${sortedScreens.length}</b><span>原型页面</span></div>
    <div class="stat"><b>${sortedReqs.filter((r) => r.status === 'draft').length}</b><span>待做原型</span></div>
  </section>

  <section>
    <h2>需求进度</h2>
    ${
      sortedReqs.length
        ? `<table>
      <thead><tr><th>ID</th><th>需求</th><th>优先级</th><th>状态</th><th>在哪个页面</th></tr></thead>
      <tbody>${reqRows}</tbody>
    </table>`
        : '<p class="empty">还没有需求。把想法告诉 AI，它会先帮你写第一条。</p>'
    }
  </section>

  <section>
    <h2>原型页面</h2>
    ${sortedScreens.length ? cardsByFlow : '<p class="empty">还没有原型页面。让 AI 先做一个首页。</p>'}
  </section>

  <footer>${esc(prd.product || '')} · ${sortedScreens.length} 个页面 · 规格版本 ${esc(prd.version || '—')} · 由 AI 自动生成</footer>
</div>
</body>
</html>
`;
}

function main() {
  const prdText = readText(PRD);
  if (!prdText) return report();

  const prd = parseFrontMatter(prdText, PRD);
  validatePrd(prd);

  const body = prdText.replace(/^---\r?\n[\s\S]*?\r?\n---/, '');
  const reqs = parseRequirements(body, PRD);
  const reqMap = validateRequirements(reqs);

  const stateText = readText(STATE);
  const state = stateText ? parseFrontMatter(stateText, STATE) : {};
  validateState(state, prd);

  const screens = walkHtml(SCREENS_DIR).map(parseScreen);
  if (screens.length === 0 && [...reqMap.values()].some((r) => ['prototyped', 'approved', 'delivered'].includes(r.status))) {
    fail('没有任何原型页面，但存在 prototyped/approved/delivered 的需求');
  }
  const covered = validateScreens(screens, reqMap);
  validateCoverage(reqMap, covered);

  if (errors.length === 0) {
    const html = renderGallery(prd, state, reqs, screens, covered);
    let current = null;
    try {
      current = fs.readFileSync(GALLERY, 'utf8');
    } catch {
      current = null;
    }
    if (current !== html) {
      if (CHECK_ONLY) {
        fail('工作台.html 已过期：运行 npm run sync 重新生成');
      } else {
        fs.writeFileSync(GALLERY, html);
      }
    }
  }

  const active = reqs.filter((r) => r.status !== 'dropped');
  const done = active.filter((r) => (covered.get(r.id) || []).length > 0);
  console.log(`PRD v${prd.version || '?'} · ${reqs.length} 个需求 · ${screens.length} 个页面`);
  console.log(active.length ? `覆盖：${done.length}/${active.length} 个有效需求已出原型` : '覆盖：还没有需求');
  report();
}

function report() {
  const yellow = (s) => (process.stdout.isTTY ? `\x1b[33m${s}\x1b[0m` : s);
  const red = (s) => (process.stdout.isTTY ? `\x1b[31m${s}\x1b[0m` : s);
  const green = (s) => (process.stdout.isTTY ? `\x1b[32m${s}\x1b[0m` : s);

  if (warnings.length) {
    console.log(`\n${yellow('⚠ 警告')} (${warnings.length})`);
    for (const msg of warnings) console.log(`  - ${msg}`);
  }
  if (errors.length) {
    console.log(`\n${red('✖ 错误')} (${errors.length})`);
    for (const msg of errors) console.log(`  - ${msg}`);
  }
  if (errors.length || (STRICT && warnings.length)) {
    console.log(`\n${red('✖ 一致性校验未通过')}${STRICT && warnings.length && !errors.length ? '（strict：警告即失败）' : ''}`);
    process.exitCode = 1;
  } else {
    console.log(`\n${green('✔ 一致性校验通过')}${warnings.length ? '（有警告）' : ''}`);
  }
}

main();
