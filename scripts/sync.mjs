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
import {
  FORMS,
  FORM_LABELS,
  MAX_INLINE_BYTES,
  isExternalAllowed,
  loadExternalPolicy,
  loadScreens,
} from './lib/screens.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');
const STRICT = process.argv.includes('--strict');

const PRD = path.join(ROOT, 'product/PRD.md');
const STATE = path.join(ROOT, 'STATE.md');
const PROTOTYPE_DIR = path.join(ROOT, 'prototype');
const SCREENS_DIR = path.join(PROTOTYPE_DIR, 'screens');
const SCREEN_MANIFEST = path.join(PROTOTYPE_DIR, 'screens.json');
const WORKBENCH = path.join(ROOT, '工作台.html');

const errors = [];
const warnings = [];
const hints = [];

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

/** 样式缺失时仍要能生成失败页，不让工作台生成本身崩掉。 */
function readAsset(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/**
 * 解析极简 YAML front matter：只支持 key: value，整行 # 是注释。
 *
 * 值里的「#」不再被当成注释剥掉：以前那样会把
 * `last_round: 按 issue #1 修了交付链路` 静默截成「按 issue」，
 * 而这正是工作台要显示的内容。现在换成两条明确规则：
 * - 整个值用引号包起来，引号内原样取用（可以含 #）；
 * - 没包引号又出现「 #」的，报错让人加引号，不猜、不截断。
 */
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
    data[key] = parseFrontMatterValue(trimmed.slice(colon + 1), key, file);
  }
  return data;
}

/** 解析单个 front matter 值，见 parseFrontMatter 的两条规则。 */
function parseFrontMatterValue(raw, key, file) {
  const text = raw.trim();
  const quote = text[0];
  if (quote === '"' || quote === "'") {
    const end = text.indexOf(quote, 1);
    if (end === -1) {
      fail(`${rel(file)}：${key} 的引号没有闭合`);
      return '';
    }
    const trailing = text.slice(end + 1).trim();
    if (trailing && !trailing.startsWith('#')) {
      warn(`${rel(file)}：${key} 的引号后面还有内容「${trailing}」，已忽略`);
    }
    return text.slice(1, end).trim();
  }
  if (/\s#/.test(text)) {
    fail(
      `${rel(file)}：${key} 里有空格外加「#」，直接写会被当成注释截断。` +
        `请把整个值用引号包起来（${key}: "这里写完整内容"）`,
    );
    return '';
  }
  return text;
}

/** 解析 ### REQ-001 标题 及其元数据。 */
function parseRequirements(body, file) {
  const reqs = [];
  let cur = null;
  let inAcceptance = false;
  let inBehavior = false;

  const flush = () => {
    if (cur) reqs.push(cur);
    cur = null;
    inAcceptance = false;
    inBehavior = false;
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
        behavior: '',
        basis: '',
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
    if (inBehavior) {
      const item = line.match(/^\s+(?:\d+[.、)]|[-*])\s+(.+?)\s*$/);
      if (item) {
        cur.behavior = cur.behavior ? `${cur.behavior}\n${item[1]}` : item[1];
        return;
      }
    }
    const field = line.match(/^\s*-\s*(?:\*\*)?([^*:：]+?)(?:\*\*)?\s*[:：]\s*(.*)$/);
    if (!field) return;
    const key = field[1].trim();
    const value = field[2].trim().replace(/`/g, '');
    inAcceptance = false;
    inBehavior = false;
    if (key === '状态') cur.status = value;
    else if (key === '优先级') cur.priority = value.toUpperCase();
    else if (key === '用户故事') cur.story = value;
    else if (key === '行为') {
      inBehavior = true;
      if (value) cur.behavior = value;
    } else if (key === '依据') cur.basis = value;
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

function screenLabel(screen) {
  if (screen.source === 'manifest') return `prototype/screens.json（${screen.id || '未命名界面'}）`;
  return screen.relFile;
}

function validateScreens(screens, reqMap) {
  const ids = new Map();
  const covered = new Map();
  for (const screen of screens) {
    const label = screenLabel(screen);
    if (screen.source !== 'manifest') {
      if (!screen.id) fail(`${label}：缺少 <meta name="screen:id">`);
      else if (!/^[a-z0-9][a-z0-9-]*$/.test(screen.id)) {
        fail(`${label}：screen:id 只能用小写英文、数字和短横线（当前「${screen.id}」）`);
      }
      if (!screen.title) fail(`${label}：缺少 <meta name="screen:title">`);
      if (!FORMS.includes(screen.form)) {
        fail(`${label}：screen:form 只能是 ${FORMS.join(' | ')}（当前「${screen.form}」）`);
      }
    }
    if (!screen.flow) warn(`${label}：缺少 flow，工作台会归入「未分组」`);
    if (screen.source !== 'manifest' && screen.id) {
      if (ids.has(screen.id)) fail(`页面 ID 重复：${screen.id}（${label} 与 ${ids.get(screen.id)}）`);
      else ids.set(screen.id, label);
    }
    if (screen.reqs.length === 0) {
      warn(`${label}：没有关联任何需求，无法追溯到 PRD`);
    }
    for (const reqId of screen.reqs) {
      if (!reqMap.has(reqId)) {
        fail(`${label}：需求 ${reqId} 在 PRD 中不存在（原型不能定义新需求）`);
        continue;
      }
      if (!covered.has(reqId)) covered.set(reqId, []);
      covered.get(reqId).push(screen);
    }
  }
  return covered;
}

function validateExternal(screens, loaded, policy) {
  for (const message of policy.errors) fail(message);

  const check = (label, urls) => {
    const uniqueUrls = uniq(urls);
    const blocked = uniqueUrls.filter((url) => !isExternalAllowed(url, policy.allow));
    if (blocked.length) {
      fail(
        `${label}：引用了未声明的外部资源 ${blocked.join('、')}。` +
          '把域名加入 prototype/external.json 的 allow，或把资源放到 assets/vendor/',
      );
    }
    // 已声明的不再告警：企业项目可能必须用地图/字体服务，工作台卡片会显示「缩略图已降级」。
  };

  for (const screen of screens) {
    if (screen.mode === 'multi' && screen.externalUrls.length) check(screen.relFile, screen.externalUrls);
  }
  if (loaded.mode === 'spa' && loaded.entryExternal.length) {
    check(`prototype/${loaded.entry}`, loaded.entryExternal);
  }
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
  if (prd.basis_required !== undefined) {
    const value = String(prd.basis_required).trim().toLowerCase();
    if (!['true', 'false'].includes(value)) {
      fail(`product/PRD.md：basis_required 只能是 true 或 false（当前「${prd.basis_required}」）`);
    } else {
      prd.basis_required = value === 'true';
    }
  } else {
    prd.basis_required = false;
  }
}

function validateRequirements(reqs, prd) {
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

    if (req.status !== 'dropped' && !req.story) {
      fail(`${req.id}：缺少「- **用户故事**: ...」`);
    }

    if (req.status !== 'dropped' && !req.behavior) {
      fail(`${req.id}：缺少「- **行为**: ...」`);
    }

    if (req.status !== 'dropped' && req.acceptance === 0) {
      fail(`${req.id}：至少需要一条「- [ ]」验收标准`);
    }

    if (prd.basis_required && req.status !== 'dropped' && !req.basis) {
      fail(`${req.id}：PRD 开启了 basis_required，必须补「- **依据**: ...」（访谈、法规、数据或决策链接）`);
    }
  }
  return seen;
}

function validateState(state, prd, reqMap) {
  if (!state) return;
  if (!state.stage) fail('STATE.md：front matter 缺少 stage');
  else if (!STAGES.includes(state.stage)) {
    fail(`STATE.md：stage 只能是 ${STAGES.join(' | ')}（当前「${state.stage}」）`);
  }
  if (!state.spec_version) fail('STATE.md：front matter 缺少 spec_version');
  else if (prd.version && state.spec_version !== prd.version) {
    fail(`版本不一致：PRD 是 ${prd.version}，STATE.md 是 ${state.spec_version}。改 PRD 必须同步 STATE.md`);
  }
  if (!state.updated) fail('STATE.md：front matter 缺少 updated');
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(state.updated)) {
    fail(`STATE.md：updated 必须是 YYYY-MM-DD（当前「${state.updated}」）`);
  }
  if (!state.next_action) fail('STATE.md：front matter 缺少 next_action（下一件具体要做的事）');
  for (const key of ['last_round', 'last_reason', 'last_reqs']) {
    if (!state[key]) {
      fail(`STATE.md：front matter 缺少 ${key}（这一轮改了什么、为什么、影响哪些需求）`);
    }
  }
  if (state.last_reqs) {
    for (const id of reqIdsIn(state.last_reqs)) {
      if (reqMap && !reqMap.has(id)) {
        fail(`STATE.md：last_reqs 引用了 PRD 中不存在的需求 ${id}`);
      }
    }
  }
}

/** 把 last_reqs 这类字段里的需求编号抽出来。 */
function reqIdsIn(value) {
  return [...new Set(String(value || '').match(/REQ-\d{3}/g) || [])];
}

/**
 * 对外文档（依据、参考资料）里不能出现工作区内部路径：
 * 交付包不带 product/、docs/ 这些目录，写了就是一条打不开的引用。
 */
const INTERNAL_PATH = /(^|[\s，,；;：:（(「『"'])((?:product|docs|skills|scripts|prototype|packs|dist)\/[^\s，,；;：:）)」』"']*)/;

function internalPathsIn(text) {
  return [...String(text || '').matchAll(new RegExp(INTERNAL_PATH.source, 'gm'))].map((match) => match[2]);
}

function validateReferences({ prdBody, reqs, prd }) {
  for (const req of reqs) {
    const bad = internalPathsIn(req.basis);
    if (bad.length) {
      fail(
        `${req.id}：「依据」里写了工作区路径 ${bad[0]}，导出后打不开；只写文档名 + 章节或条款，如《XX 条例》第 12 条、访谈 2026-11（5 人）、《XX 说明文档》第 3.2 节`,
      );
    }
  }
  const section = sectionOf(prdBody, /^##\s*(?:\d+[.、]\s*)?(?:参考资料|参考来源)/);
  if (prd.basis_required && !section) {
    fail('product/PRD.md：开启了 basis_required，必须有「## 参考资料」一节，集中列出法规、标准、访谈与原始文档');
  }
  for (const bad of internalPathsIn(section)) {
    fail(`product/PRD.md：「参考资料」里不能写工作区路径 ${bad}；写文档名、版本与章节，并注明原件不随交付包外发`);
  }
}

/** 工作台里只能显示占位卡、又没预览图的界面，提示去批量生成。 */
function collectPreviewHints(screens) {
  const missing = screens.filter(
    (screen) => !screen.previewRel && (screen.mode === 'spa' || screen.externalUrls.length > 0 || screen.bytes > MAX_INLINE_BYTES),
  );
  if (missing.length) {
    hints.push(
      `${missing.length} 个界面在工作台里只能显示占位卡：运行 npm run previews 批量生成预览图（或手动提供 prototype/previews/<界面 ID>.png）`,
    );
  }
}

/** 取某个二级标题下的正文；没有该标题时返回空串。 */
function sectionOf(markdown, headingPattern) {
  const lines = String(markdown || '').split(/\r?\n/);
  const out = [];
  let inside = false;
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      if (inside) break;
      if (headingPattern.test(line)) inside = true;
      continue;
    }
    if (inside) out.push(line);
  }
  return inside ? out.join('\n') : '';
}

/** 取段落里的列表项，忽略「暂无」占位。 */
function bulletsOf(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*[-*]\s+(.+?)\s*$/))
    .filter(Boolean)
    .map((match) => match[1].replace(/^\[[ xX]\]\s*/, '').trim())
    .filter((item) => item && !/^暂无/.test(item));
}

const RESOLVED_QUESTION = /已定|已决|已解决|已关闭|关闭|已确认|不做|resolved|closed|done/i;

/** 解析 PRD「开放问题」表格：只保留还没定论的。 */
function parseOpenQuestions(prdBody) {
  const section = sectionOf(prdBody, /^##\s*(?:\d+[.、]\s*)?开放问题/);
  const questions = [];
  for (const line of section.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    if (/^\|[\s:|-]+\|$/.test(trimmed)) continue;
    const cells = trimmed.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
    if (cells.length < 2) continue;
    if (/^(问题|事项|issue|question)$/i.test(cells[0])) continue;
    const question = cells[0].replace(/\*\*/g, '').trim();
    const status = cells[cells.length - 1];
    if (!question || RESOLVED_QUESTION.test(status)) continue;
    questions.push({ question, owner: cells.length >= 3 ? cells[1] : '' });
  }
  return questions;
}

const MAX_DECISIONS = 8;

/** 工作台「需要你拍板」：交接板阻塞 + PRD 开放问题 + 待评审需求。 */
function collectDecisions(stateBody, prdBody, reqs) {
  const items = [];
  for (const text of bulletsOf(sectionOf(stateBody, /^##\s*待确认/))) {
    if (/^(见|详见)\s*PRD/.test(text)) continue;
    items.push({ text, from: '交接板' });
  }
  for (const row of parseOpenQuestions(prdBody)) {
    items.push({ text: row.question, from: row.owner ? `PRD 开放问题 · ${row.owner}` : 'PRD 开放问题' });
  }
  const waiting = reqs.filter((req) => req.status === 'prototyped');
  if (waiting.length) {
    items.push({
      text: `${waiting.length} 条需求已有原型，等评审确认是否通过`,
      from: '需求评审',
    });
  }
  return items;
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

function readAssets() {
  return {
    tokens: readAsset(path.join(ROOT, 'prototype/assets/tokens.css')),
    appCss: readAsset(path.join(ROOT, 'prototype/assets/app.css')),
    workbenchCss: readAsset(path.join(ROOT, 'prototype/assets/workbench.css')),
  };
}

/** 有需求的页面按最小 REQ 编号排在前面，其余按流程与 ID。 */
function sortScreensForWorkbench(screens) {
  const reqOrder = (screen) =>
    screen.reqs.length ? Math.min(...screen.reqs.map((id) => Number(id.slice(4)))) : 9999;
  return [...screens].sort(
    (a, b) => reqOrder(a) - reqOrder(b) || cmp(a.flow || '未分组', b.flow || '未分组') || cmp(a.id, b.id),
  );
}

function coverageOf(reqs, covered) {
  const active = reqs.filter((req) => req.status !== 'dropped');
  return { active, done: active.filter((req) => (covered.get(req.id) || []).length > 0) };
}

function renderBuildSection(build) {
  const failed = build.errors.length > 0;
  const warned = !failed && build.warnings.length > 0;
  const cls = failed ? 'fail' : warned ? 'warn' : 'ok';
  const icon = failed
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/></svg>'
    : warned
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 21 20H3L12 3.5Z"/><path d="M12 9v5"/><path d="M12 17h.01"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/></svg>';
  const title = failed
    ? `检查没通过（${build.errors.length} 个问题），工作台可能不是最新的`
    : warned
      ? `检查通过，有 ${build.warnings.length} 条提醒`
      : '检查通过，PRD 和原型对得上';
  const note = failed
    ? '把这句话发给 AI：「检查没通过，请修好再刷新工作台」。修好前，下面的内容可能不完整。'
    : warned
      ? '不影响查看，建议让 AI 处理这些提醒。'
      : '需求状态、页面覆盖和版本都一致。';
  const messages = [
    ...build.errors.map((message) => `错误：${message}`),
    ...build.warnings.map((message) => `提醒：${message}`),
    ...(build.hints || []).map((message) => `提示：${message}`),
  ];
  const detail = messages.length
    ? `<details class="build__detail">
        <summary>给 AI 看的技术细节（${messages.length}）</summary>
        <ul>${messages.map((message) => `<li>${esc(message)}</li>`).join('')}</ul>
      </details>`
    : '';
  const noteHtml = failed || warned ? `<p class="build__note">${esc(note)}</p>` : '';
  return `  <section class="build build--${cls}" aria-label="检查状态">
    <p class="build__title"><span class="build__icon" aria-hidden="true">${icon}</span>${esc(title)}</p>${noteHtml}${detail}
  </section>`;
}

function renderRound(state) {
  const round = {
    change: String(state.last_round || '').trim(),
    reason: String(state.last_reason || '').trim(),
    reqs: reqIdsIn(state.last_reqs),
  };
  return round.change
    ? `<section class="round" aria-label="本轮变更">
    <p class="round__label">本轮变更</p>
    <p class="round__change">${esc(round.change)}</p>
    ${
      round.reason
        ? `<p class="round__meta">为什么：${esc(round.reason)}</p>`
        : ''
    }
    ${
      round.reqs.length
        ? `<p class="round__meta">影响需求：${round.reqs
            .map((id) => `<a href="#req-${esc(id)}">${esc(id)}</a>`)
            .join('、')}</p>`
        : ''
    }
  </section>`
    : `<section class="round" aria-label="本轮变更">
    <p class="round__label">本轮变更</p>
    <p class="round__meta">这一轮还没有变更记录。</p>
  </section>`;
}

function renderDecisionList(decisions) {
  const shown = decisions.slice(0, MAX_DECISIONS);
  return shown.length
    ? `<ol class="decisions">
      ${shown
        .map(
          (item) => `<li><span>${esc(item.text)}</span><span class="decisions__from">${esc(item.from)}</span></li>`,
        )
        .join('\n      ')}
    </ol>${
      decisions.length > shown.length
        ? `<p class="note">还有 ${decisions.length - shown.length} 条在 PRD 的「开放问题」里。</p>`
        : ''
    }`
    : '<p class="empty">目前没有需要你决定的事。</p>';
}

function renderRequirementRows(sortedReqs, covered, showBasis) {
  const pills = (status) => {
    const meta = STATUS[status] || { label: status || '未知', cls: 'draft' };
    return `<span class="pill pill--${meta.cls}">${esc(meta.label)}</span>`;
  };
  return sortedReqs
    .map((req) => {
      const screensForReq = covered.get(req.id) || [];
      const links = screensForReq.length
        ? screensForReq
            .map((s) => `<a href="${esc(s.relFile)}">${esc(s.title || s.id)}</a>`)
            .join('、')
        : '<span class="muted">—</span>';
      const basisCell = showBasis
        ? `<td class="basis" title="${esc(req.basis || '')}">${esc(req.basis || '—')}</td>`
        : '';
      return `<tr id="req-${esc(req.id)}" class="${req.status === 'dropped' ? 'is-dropped' : ''}">
        <td><code>${esc(req.id)}</code></td>
        <td>${esc(req.title)}</td>
        <td>${esc(req.priority || '—')}</td>
        <td>${pills(req.status)}</td>${basisCell}
        <td>${links}</td>
      </tr>`;
    })
    .join('\n');
}

function renderScreenCards(sortedScreens, { tokens, appCss }) {
  const groups = new Map();
  for (const screen of sortedScreens) {
    const key = screen.flow || '未分组';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(screen);
  }
  const placeholderIcon =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/></svg>';
  const frameOf = (screen) => {
    if (screen.previewRel) {
      return `<img src="${esc(screen.previewRel)}" alt="${esc(screen.title)} 预览" loading="lazy">`;
    }
    if (screen.mode === 'spa') {
      return `<span class="proto__placeholder">${placeholderIcon}<span>单页应用</span><small>点开查看</small></span>`;
    }
    if (screen.externalUrls.length) {
      return `<span class="proto__placeholder">${placeholderIcon}<span>外部资源</span><small>缩略图已降级</small></span>`;
    }
    if (screen.bytes > MAX_INLINE_BYTES) {
      return `<span class="proto__placeholder">${placeholderIcon}<span>页面较大</span><small>缩略图已降级</small></span>`;
    }
    return `<iframe srcdoc="${esc(screenPreviewHtml(screen.file, tokens, appCss))}" title="${esc(screen.title)}" loading="lazy" tabindex="-1"></iframe>`;
  };
  return [...groups.entries()]
    .map(
      ([flow, list]) => `<section class="flow-group">
      <h3 class="flow-title">${esc(flow)} <span class="count">${list.length}</span></h3>
      <div class="index">
        ${list
          .map((screen) => {
            const form = FORMS.includes(screen.form) ? screen.form : 'responsive';
            const formLabel = FORM_LABELS[form] || form;
            return `<article class="proto proto--${form}">
          <a class="proto__link" href="${esc(screen.relFile)}" aria-label="打开 ${esc(screen.title)}">
            <span class="proto__frame">
              ${frameOf(screen)}
            </span>
            <span class="proto__body">
              <span class="proto__title">${esc(screen.title || screen.id)}</span>
              <span class="proto__meta"><span class="proto__form">${esc(formLabel)}</span>${
                screen.reqs.length ? ` · ${screen.reqs.map((r) => esc(r)).join(' · ')}` : ' · 未标注需求'
              }</span>
              <span class="proto__hint">打开${screen.mode === 'spa' ? '这个界面' : '原型'} →</span>
            </span>
          </a>
        </article>`;
          })
          .join('\n')}
      </div>
    </section>`,
    )
    .join('');
}

function renderWorkbench({ prd, state, reqs, screens, covered, build, mode, ctx }) {
  const { tokens, appCss, workbenchCss } = readAssets();
  const stageLabel = STAGE_LABELS[state.stage] || state.stage || '未设置';
  const nextAction = state.next_action || '先读一遍 PRD，确定下一步要做什么';
  const sortedReqs = [...reqs].sort((a, b) => cmp(a.id, b.id));
  const showBasis = prd.basis_required === true || sortedReqs.some((req) => req.basis);
  const pageWord = mode === 'spa' ? '个界面' : '个页面';
  const sortedScreens = sortScreensForWorkbench(screens);
  const { active, done } = coverageOf(sortedReqs, covered);
  const decisions = collectDecisions(ctx.stateBody || '', ctx.prdBody || '', sortedReqs);
  const buildSection = renderBuildSection(build);
  const roundHtml = renderRound(state);
  const decisionHtml = renderDecisionList(decisions);
  const reqRows = renderRequirementRows(sortedReqs, covered, showBasis);
  const cardsByFlow = renderScreenCards(sortedScreens, { tokens, appCss });

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(prd.product || '产品')} · 工作台</title>
<style>
${tokens}
${workbenchCss}
</style>
</head>
<body>
<div class="wrap">
  <header class="head">
    <h1>${esc(prd.product || '未命名产品')}</h1>
    <p class="meta">产品工作台 · ${esc(stageLabel)} · 规格 v${esc(prd.version || '0.0.0')} · 更新于 ${esc(prd.updated || '—')} · ${
      active.length ? `${done.length}/${active.length} 个需求已有原型` : '还没有需求'
    }</p>
  </header>

${buildSection}

  <section class="next">
    <p class="next__label">下一步</p>
    <h2>${esc(nextAction)}</h2>
  </section>

  ${roundHtml}

  <section aria-label="需要你拍板">
    <h2>需要你拍板</h2>
    ${decisionHtml}
  </section>

  <section class="stats">
    <div class="stat"><b>${sortedReqs.length}</b><span>需求总数</span></div>
    <div class="stat"><b>${done.length}</b><span>已有原型（不含已砍）</span></div>
    <div class="stat"><b>${sortedScreens.length}</b><span>${mode === 'spa' ? '原型界面' : '原型页面'}</span></div>
    <div class="stat"><b>${sortedReqs.filter((r) => r.status === 'draft').length}</b><span>待做原型</span></div>
  </section>

  <section id="requirements">
    <h2>需求进度</h2>
    ${
      sortedReqs.length
        ? `<table>
      <thead><tr><th>ID</th><th>需求</th><th>优先级</th><th>状态</th>${showBasis ? '<th>依据</th>' : ''}<th>在哪个页面</th></tr></thead>
      <tbody>${reqRows}</tbody>
    </table>`
        : '<p class="empty">还没有需求。把想法告诉 AI，它会先帮你写第一条。</p>'
    }
  </section>

  <section>
    <h2>${mode === 'spa' ? '原型界面' : '原型页面'}</h2>
    ${sortedScreens.length ? cardsByFlow : `<p class="empty">还没有原型${mode === 'spa' ? '界面' : '页面'}。让 AI 先做一个首页。</p>`}
  </section>

  <details class="help">
    <summary>使用说明与交付</summary>
    <div class="help__body">
      <section class="help__block">
        <h3>怎么用这个工位</h3>
        <ol>
          <li>把想要的功能直接说给 AI，不用先写文档。</li>
          <li>点上面的页面看原型，把不满意的地方告诉 AI。</li>
          <li>每次改完让 AI「刷新工作台」，它会自己检查两边是否一致；顶部会显示检查结果。</li>
        </ol>
        <p class="note">不需要 git，不需要命令行，也不需要懂代码。不要自己改这个页面。</p>
        <p class="note">常用说法：「我有个想法……先问我几个关键问题」「把首页改简单点」「帮我评审，看看哪里不一致」。</p>
        <details class="prompt">
          <summary>给 AI 的开场白</summary>
          <pre>你是我的产品搭档。先读 AGENTS.md、STATE.md 和 product/PRD.md，用一句话告诉我现在做到哪、下一步做什么。
然后按我说的改。改完自己运行 npm run sync 和 npm run check，刷新工作台，再告诉我：改了哪些需求、哪些页面、还有什么没定。
不要要求我运行命令，也不要让我碰 git。</pre>
        </details>
      </section>
      <section class="help__block">
        <h3>要发给研发？</h3>
        <p>不要发整个工作区。对 AI 说「导出交付包」，它会生成只含 PRD 和原型的 zip。</p>
        <p class="note">产物在 dist/ 下：同名文件夹 + 同名 .zip。</p>
      </section>
    </div>
  </details>

  <footer>${esc(prd.product || '')} · ${sortedScreens.length} ${pageWord} · 规格版本 ${esc(prd.version || '—')} · 由 AI 自动生成，不用手改</footer>
</div>
</body>
</html>
`;
}

function main() {
  const prdText = readText(PRD);
  const prd = prdText ? parseFrontMatter(prdText, PRD) : {};
  if (prdText) validatePrd(prd);

  const body = prdText ? prdText.replace(/^---\r?\n[\s\S]*?\r?\n---/, '') : '';
  const reqs = parseRequirements(body, PRD);
  const reqMap = validateRequirements(reqs, prd);
  validateReferences({ prdBody: body, reqs, prd });

  const stateText = readText(STATE);
  const state = stateText ? parseFrontMatter(stateText, STATE) : {};
  if (stateText) validateState(state, prd, reqMap);

  const loaded = loadScreens({ root: ROOT, screensDir: SCREENS_DIR, manifestFile: SCREEN_MANIFEST });
  errors.push(...loaded.errors);
  warnings.push(...loaded.warnings);
  const screens = loaded.screens;

  if (screens.length === 0 && [...reqMap.values()].some((r) => ['prototyped', 'approved', 'delivered'].includes(r.status))) {
    fail('没有任何原型页面，但存在 prototyped/approved/delivered 的需求');
  }
  const covered = validateScreens(screens, reqMap);
  validateCoverage(reqMap, covered);

  const externalPolicy = loadExternalPolicy(PROTOTYPE_DIR);
  validateExternal(screens, loaded, externalPolicy);
  collectPreviewHints(screens);

  // 即使检查失败也要生成工作台：把失败状态直接显示给人看，而不是静默保留旧页面。
  const html = renderWorkbench({
    prd,
    state,
    reqs,
    screens,
    covered,
    build: { errors, warnings, hints },
    mode: loaded.mode,
    ctx: {
      prdBody: body,
      stateBody: stateText ? stateText.replace(/^---\r?\n[\s\S]*?\r?\n---/, '') : '',
    },
  });
  let current = null;
  try {
    current = fs.readFileSync(WORKBENCH, 'utf8');
  } catch {
    current = null;
  }
  if (current !== html) {
    if (CHECK_ONLY) {
      fail('工作台.html 已过期：运行 npm run sync 重新生成');
    } else {
      fs.writeFileSync(WORKBENCH, html);
    }
  }

  const { active, done } = coverageOf(reqs, covered);
  console.log(
    `PRD v${prd.version || '?'} · ${reqs.length} 个需求 · ${screens.length} 个${loaded.mode === 'spa' ? '界面（SPA）' : '页面'}`,
  );
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
  if (hints.length) {
    console.log(`\n${yellow('· 提示')} (${hints.length})`);
    for (const msg of hints) console.log(`  - ${msg}`);
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
