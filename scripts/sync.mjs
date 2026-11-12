#!/usr/bin/env node
/**
 * 校验 PRD 与原型的一致性，并生成根目录的「工作台.html」。
 *
 *   node scripts/sync.mjs           校验 + 重建工作台
 *   node scripts/sync.mjs --check   只校验（工作台落后只提示，不失败）
 *   node scripts/sync.mjs --strict  把警告也视为失败（npm run check 默认开启）
 *   node scripts/sync.mjs --require-fresh --require-confirmations
 *                                   交付/评审路径：工作台必须最新、承诺类变更必须已确认
 *   node scripts/sync.mjs --confirm [--by 谁] [--source 对话|页面评论|评审]
 *                                   记下本轮承诺类改动的确认记录
 *   node scripts/sync.mjs --review --role 自评 --conclusion 通过 [--notes "遗留一；遗留二"]
 *                                   记一份评审记录（评的是当前快照）
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
import {
  CHANGE_LABELS,
  BASE_FILE,
  CONFIRMATIONS_FILE,
  REVIEWS_FILE,
  REVIEW_CONCLUSIONS,
  REVIEW_ROLES,
  ROUND_FILE,
  SNAPSHOT_FILE,
  buildSnapshot,
  deriveLedger,
  diffSnapshots,
  groupChanges,
  hashFile,
  hashText,
  latestReview,
  pendingConfirmations,
  readJson,
  readJsonl,
  recordConfirmation,
  recordReview,
  roundsSince,
  snapshotDigest,
  stationPath,
  versionRank,
  writeJson,
} from './lib/station.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');
const STRICT = process.argv.includes('--strict');
/** 交付与评审路径：工作台必须最新、承诺类变更必须有确认记录。 */
const REQUIRE_FRESH = process.argv.includes('--require-fresh');
const REQUIRE_CONFIRMATIONS = process.argv.includes('--require-confirmations');

const flagValue = (name) => {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.findIndex((arg) => arg === name);
  const next = index === -1 ? undefined : process.argv[index + 1];
  return next && !next.startsWith('--') ? next : '';
};
const CONFIRM = process.argv.includes('--confirm') || process.argv.some((arg) => arg.startsWith('--confirm='));
// `--confirm REQ-001` 与 `--confirm=REQ-001` 都要认；只有后面跟的是另一个开关时才算「确认全部」。
const CONFIRM_TARGET = flagValue('--confirm');
const REVIEW_MODE = process.argv.includes('--review');

const PRD = path.join(ROOT, 'product/PRD.md');
const STATE = path.join(ROOT, 'STATE.md');
const PROTOTYPE_DIR = path.join(ROOT, 'prototype');
const SCREENS_DIR = path.join(PROTOTYPE_DIR, 'screens');
const SCREEN_MANIFEST = path.join(PROTOTYPE_DIR, 'screens.json');
const WORKBENCH = path.join(ROOT, '工作台.html');

const errors = [];
const warnings = [];
const hints = [];
/** 交付/评审门禁：只在这里失败，不污染工作台渲染，否则 check 会把自己的失败当成「工作台过期」。 */
const gates = [];

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
    const text = fs.readFileSync(file, 'utf8');
    // 空文件多半是写到一半或误清空：不能当成「没有内容、跳过校验」。
    if (!text.trim()) {
      fail(`${rel(file)} 是空的：写入内容后再校验`);
      return null;
    }
    return text;
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
    // 写成「### REQ-006」或「### REQ-0060 …」的标题不会被下面的正则接住，
    // 需求会静默消失；这里先点名，让人去改格式。
    if (/^#{2,4}\s+REQ-/.test(line) && !/^#{2,4}\s+REQ-\d{3}\s+\S/.test(line)) {
      fail(`${rel(file)} 第 ${index + 1} 行的需求标题格式不对：「${line.trim()}」应为「### REQ-001 标题」`);
    }
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
        acceptanceLines: [],
        approval: '',
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
      cur.acceptanceLines.push(line.replace(/^\s*-\s*\[[ xX]\]\s*/, '').trim());
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
    else if (key === '批准') cur.approval = value;
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

/**
 * 批准记录：定在 REQ 块里，跟着需求走，不建独立日志。
 * 格式：`- **批准**: v0.2.1 · 2026-11-12 · 徐琦（自评）`
 */
function validateApprovals(reqs, prd) {
  for (const req of reqs) {
    if (req.status !== 'approved' && req.status !== 'delivered') continue;
    if (!req.approval) {
      fail(`${req.id} 状态是 ${req.status}，缺少「- **批准**: vX.Y.Z · 日期 · 谁（角色）」`);
      continue;
    }
    const match = req.approval.match(/^v?(\d+\.\d+\.\d+)\s*[·・|]\s*(\d{4}-\d{2}-\d{2})\s*[·・|]\s*(.+)$/);
    if (!match) {
      fail(`${req.id} 的批准记录格式不对，应为「v0.2.1 · 2026-11-12 · 徐琦（自评）」`);
      continue;
    }
    const approvedRank = versionRank(match[1]);
    const currentRank = versionRank(prd.version);
    if (approvedRank && currentRank && approvedRank > currentRank) {
      fail(`${req.id} 的批准版本 v${match[1]} 大于当前 PRD 版本 ${prd.version}`);
    }
    if (!/[（(](自评|内部评审|甲方评审)[）)]/.test(match[3])) {
      // 旧工位升级后才有的字段：提示怎么补，不阻断检查。
      hints.push(`${req.id} 的批准记录没写角色：补成「… · 徐琦（自评）」，自评与甲方评审才分得清`);
    }
  }
}

/** 开放问题的「提出于 vX」：有了它，机器才算得出这条挂了几轮。 */
function validateOpenQuestions(openQuestions, prd) {
  if (!openQuestions.hasRaisedAt) {
    if (openQuestions.questions.length) {
      // 旧工位没有这一列：提示补，但不阻断——升级不该让 npm run check 变红。
      hints.push('PRD「开放问题」表没有「提出于」列：补一列（填提出时的版本号）才能按「挂了几轮」排序');
    }
    return;
  }
  const currentRank = versionRank(prd.version);
  for (const row of openQuestions.questions) {
    if (!row.raisedAt) {
      const message = `开放问题「${row.question}」缺少「提出于」版本`;
      if (row.resolved) hints.push(`${message}（已解决的可以补，不阻断）`);
      else fail(message);
      continue;
    }
    const rank = versionRank(row.raisedAt);
    if (!rank) {
      fail(`开放问题「${row.question}」的「提出于」不是版本号（当前「${row.raisedAt}」）`);
    } else if (currentRank && rank > currentRank) {
      fail(`开放问题「${row.question}」的「提出于 v${row.raisedAt}」大于当前 PRD 版本 ${prd.version}`);
    }
  }
}

/**
 * 评审的前置条件：全绿、P0 有原型、开放问题处置过。
 * 只在 PRD 说 approved（或正在记评审）时要求，日常施工不打扰。
 *
 * 只在交付/评审路径（--require-fresh）才出现的问题写进 gates：写进 errors 会改变
 * 渲染结果，让 check 把一份正确的工作台判成「过期」。
 */
function validateReviewGate({ prd, openQuestions, reviews, reqMap, covered }) {
  const reviewing = prd.status === 'approved' || REVIEW_MODE;
  if (!reviewing && !REQUIRE_FRESH) return;
  const strictHere = (message) => (reviewing ? fail(message) : gates.push(message));
  const unresolved = openQuestions.questions.filter((row) => !row.resolved);
  if (prd.status === 'approved' && unresolved.length) {
    fail(
      `PRD 状态是 approved，但还有 ${unresolved.length} 条开放问题没处置：${unresolved
        .map((row) => `「${row.question}」`)
        .join('、')}`,
    );
  }
  const uncoveredP0 = [...reqMap.values()].filter(
    (req) => req.priority === 'P0' && req.status !== 'dropped' && (covered.get(req.id) || []).length === 0,
  );
  if (uncoveredP0.length) {
    strictHere(`评审前 P0 需求必须有原型：${uncoveredP0.map((req) => req.id).join('、')} 还没有页面覆盖`);
  }
  if (!REVIEW_MODE && reviewing && !latestReview(reviews, prd.version)) {
    hints.push(
      prd.status === 'approved'
        ? `PRD 状态已是 approved，但没有 v${prd.version} 的评审记录：用 node scripts/sync.mjs --review 补一份`
        : `还没有 v${prd.version} 的评审记录：评审结束后用 node scripts/sync.mjs --review 落盘`,
    );
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
    // 工作台显示的是纯文本，Markdown 的加粗记号只会原样露出来。
    .map((match) => match[1].replace(/^\[[ xX]\]\s*/, '').replace(/\*\*(.+?)\*\*/g, '$1').trim())
    .filter((item) => item && !/^暂无/.test(item));
}

/**
 * 开放问题是否已处置。按整格匹配，不做子串匹配：状态写「未关闭」「unresolved」
 * 时必须算未处置，否则 approved 的前置条件会被绕开。
 */
const RESOLVED_QUESTION = /^(已定|已决|已解决|已关闭|关闭|已确认|不做|resolved|closed|done)/i;
const NEGATED_STATUS = /^(未|没|不|not\b|un)/i;

/**
 * 解析 PRD「开放问题」表格。
 *
 * 列按表头定位：「问题 | 负责人 | 提出于 | 状态」。没有「提出于」列的旧工位
 * 仍能解析，只是无法按「挂了几轮」排序，校验会给一条提醒而不是报错。
 */
function parseOpenQuestions(prdBody) {
  const section = sectionOf(prdBody, /^##\s*(?:\d+[.、]\s*)?开放问题/);
  const questions = [];
  let columns = null;

  for (const line of section.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    if (/^\|[\s:|-]+\|$/.test(trimmed)) continue;
    const cells = trimmed.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
    if (!columns) {
      // 「提出于」优先精确匹配：表里还有「提出人」时，宽松匹配会认错列。
      const exactRaisedAt = cells.findIndex((cell) => /提出于|raised\s*at/i.test(cell));
      columns = {
        question: Math.max(0, cells.findIndex((cell) => /问题|事项|issue|question/i.test(cell))),
        owner: cells.findIndex((cell) => /负责|owner/i.test(cell)),
        raisedAt:
          exactRaisedAt !== -1 ? exactRaisedAt : cells.findIndex((cell) => /提出|raised/i.test(cell)),
        status: cells.findIndex((cell) => /状态|status|结论/i.test(cell)),
      };
      continue;
    }
    if (cells.length < 2) continue;
    const pick = (index) => (index >= 0 && index < cells.length ? cells[index] : '');
    const question = pick(columns.question).replace(/\*\*/g, '').trim();
    if (!question) continue;
    const status = pick(columns.status === -1 ? cells.length - 1 : columns.status);
    questions.push({
      question,
      owner: pick(columns.owner),
      raisedAt: pick(columns.raisedAt).replace(/^v/i, ''),
      status,
      resolved: RESOLVED_QUESTION.test(status.trim()) && !NEGATED_STATUS.test(status.trim()),
    });
  }
  return { questions, hasRaisedAt: columns ? columns.raisedAt !== -1 : false };
}

/** PRD「变更记录」表里的版本号，按表里的顺序（通常最新在前）。 */
function parseChangeLog(prdBody) {
  const section = sectionOf(prdBody, /^##\s*(?:\d+[.、]\s*)?变更记录/);
  const versions = [];
  for (const line of section.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    if (/^\|[\s:|-]+\|$/.test(trimmed)) continue;
    const cells = trimmed.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
    if (!versionRank(cells[0])) continue;
    versions.push(cells[0]);
  }
  return versions;
}

/**
 * 读决策记录：标题与「被否决的方案与原因」一节。负面知识只有一个落点，
 * 不做第二份清单。
 */
function loadDecisions() {
  const dir = path.join(ROOT, 'product/decisions');
  let files = [];
  try {
    // README 是模板说明，不是决策记录：它的示例内容不能进账本。
    files = fs
      .readdirSync(dir)
      .filter((file) => file.endsWith('.md') && !/^readme(\.|$)/i.test(file))
      .sort();
  } catch {
    return [];
  }
  return files.map((file) => {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    const title = (text.match(/^#\s+(.+)$/m) || ['', file])[1].trim();
    const rejected = bulletsOf(sectionOf(text, /^##\s*(?:\d+[.、]\s*)?(?:被否决的方案|否决的方案|被否决)/));
    return { file, title, hash: hashText(text), rejected };
  });
}

const MAX_DECISIONS = 8;
/** 一条开放问题挂过这么多轮，就该浮到最上面。 */
const STALE_ROUNDS = 3;

/** 工作台「需要你拍板」：交接板阻塞 + PRD 开放问题 + 待评审需求。 */
function collectDecisions(stateBody, openQuestions, reqs, changeLogVersions = []) {
  const items = [];
  for (const text of bulletsOf(sectionOf(stateBody, /^##\s*待确认/))) {
    if (/^(见|详见)\s*PRD/.test(text)) continue;
    items.push({ text, from: '交接板' });
  }
  for (const row of openQuestions.questions) {
    if (row.resolved) continue;
    items.push({
      text: row.question,
      from: row.owner ? `PRD 开放问题 · ${row.owner}` : 'PRD 开放问题',
      rounds: roundsSince(row.raisedAt, changeLogVersions),
    });
  }
  const waiting = reqs.filter((req) => req.status === 'prototyped');
  if (waiting.length) {
    items.push({
      text: `${waiting.length} 条需求已有原型，等评审确认是否通过`,
      from: '需求评审',
    });
  }
  // 挂得越久越靠前：超过阈值的问题不该埋在列表中间。
  return items.sort((a, b) => {
    const ra = Number.isInteger(a.rounds) ? a.rounds : -1;
    const rb = Number.isInteger(b.rounds) ? b.rounds : -1;
    return rb - ra;
  });
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

function formatTime(iso) {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

/** 身份行：评审时看这一行，就能判断「这份快照能不能用」。 */
function renderIdentity({ prd, counts, build, generatedAt, review }) {
  const failed = build.errors.length > 0;
  const parts = [
    `依据 PRD v${prd.version || '—'}（${prd.updated || '—'}）`,
    failed
      ? `检查有 ${build.errors.length} 个问题`
      : build.warnings.length
        ? `检查通过，${build.warnings.length} 条提醒`
        : '检查通过',
    `生成于 ${formatTime(generatedAt)}`,
    `${counts.reqs} 个需求 / ${counts.screens} ${counts.pageWord}`,
  ];
  // 只有进了评审的工位才提签署：草案阶段写「还没有签署」只是噪音。
  if (review) {
    parts.push(`已签署：${review.role || '未标注'} · ${review.conclusion || '通过'}（${formatTime(review.at)}）`);
  } else if (prd.status === 'review' || prd.status === 'approved') {
    parts.push('还没有签署');
  }
  return `<p class="identity${failed ? ' identity--fail' : ''}">${parts
    .map((part) => `<span>${esc(part)}</span>`)
    .join('')}</p>`;
}

function renderChangeGroups(groups) {
  return ['commitment', 'structure', 'rewrite']
    .filter((kind) => groups[kind].length)
    .map(
      (kind) => `<div class="change change--${kind}">
        <p class="change__kind">${CHANGE_LABELS[kind]} <span>${groups[kind].length}</span></p>
        <ul class="change__list">${groups[kind]
          .map((change) => `<li>${esc(change.scope)}</li>`)
          .join('')}</ul>
      </div>`,
    )
    .join('');
}

function renderRound(state, { groups }) {
  const round = {
    change: String(state.last_round || '').trim(),
    reason: String(state.last_reason || '').trim(),
    reqs: reqIdsIn(state.last_reqs),
  };
  const total = ['commitment', 'structure', 'rewrite'].reduce((sum, kind) => sum + groups[kind].length, 0);
  // 「是不是第一次建基线」只影响这一行文案，却会让干净检出（没有 .station）的工作台
  // 与检出的页面差一句、被判成过期。所以这里只说事实，基线提示走终端。
  const facts = total
    ? renderChangeGroups(groups)
    : '<p class="round__meta">需求、页面和决定记录这一轮都没有变。</p>';
  return `<section class="round" aria-label="本轮变更">
    <p class="round__label">本轮变更</p>
    <p class="round__change">${round.change ? esc(round.change) : '这一轮还没有变更记录。'}</p>
    ${round.reason ? `<p class="round__meta">为什么：${esc(round.reason)}</p>` : ''}
    ${
      round.reqs.length
        ? `<p class="round__meta">影响需求：${round.reqs
            .map((id) => `<a href="#req-${esc(id)}">${esc(id)}</a>`)
            .join('、')}</p>`
        : ''
    }
    ${facts}
  </section>`;
}

function renderDecisionList(decisions) {
  const shown = decisions.slice(0, MAX_DECISIONS);
  return shown.length
    ? `<ol class="decisions">
      ${shown
        .map((item) => {
          const stale = Number.isInteger(item.rounds) && item.rounds >= STALE_ROUNDS;
          const rounds =
            Number.isInteger(item.rounds) && item.rounds > 0
              ? `<span class="decisions__rounds${stale ? ' decisions__rounds--stale' : ''}">已挂 ${item.rounds} 轮</span>`
              : '';
          return `<li><span>${esc(item.text)}</span>${rounds}<span class="decisions__from">${esc(
            item.from,
          )}</span></li>`;
        })
        .join('\n      ')}
    </ol>${
      decisions.length > shown.length
        ? `<p class="note">还有 ${decisions.length - shown.length} 条在 PRD 的「开放问题」里。</p>`
        : ''
    }`
    : '<p class="empty">目前没有需要你决定的事。</p>';
}

/** 「等你处理」：未确认的承诺类改动、结构类改动、要你拍板的事、承诺账本，合在一处。 */
function renderWaiting({ pending, structure, decisions, ledger }) {
  const urgent = pending.length
    ? `<div class="pending">
      <p class="pending__title">${pending.length} 处承诺类改动还没有你确认</p>
      <p class="note">这些改的是范围、优先级、验收或决定记录，不是改文案。你确认之后 AI 会记一条确认记录，这一块才会消失。</p>
      <ul class="change__list">${pending.map((change) => `<li>${esc(change.scope)}</li>`).join('')}</ul>
    </div>`
    : '';
  const structureHtml = structure.length
    ? `<div class="structure">
      <p class="structure__title">${structure.length} 处结构改动（只列出，不拦）</p>
      <p class="note">页面或数据追溯的归属变了。如果你不打算这么改，现在说。</p>
      <ul class="change__list">${structure
        .map(
          (change) =>
            `<li>${esc(change.scope)}${
              change.detail ? `<span class="change__detail">${esc(change.detail)}</span>` : ''
            }</li>`,
        )
        .join('')}</ul>
    </div>`
    : '';
  const ledgerHtml = ledger.length
    ? `<details class="ledger">
      <summary>承诺账本（${ledger.length}）</summary>
      <ul class="ledger__list">${ledger
        .map(
          (item) =>
            `<li><span class="ledger__kind ledger__kind--${esc(
              item.kind === '对外' ? 'out' : item.kind === '对内' ? 'in' : item.kind === '负向' ? 'no' : 'open',
            )}">${esc(item.kind)}</span><span class="ledger__text">${esc(item.text)}</span><span class="ledger__detail">${esc(
              item.detail || '',
            )}</span></li>`,
        )
        .join('')}</ul>
    </details>`
    : '';
  return `${urgent}${structureHtml}${renderDecisionList(decisions)}${ledgerHtml}`;
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
  const decisions = collectDecisions(
    ctx.stateBody || '',
    ctx.openQuestions || { questions: [] },
    sortedReqs,
    ctx.changeLogVersions || [],
  );
  const buildSection = renderBuildSection(build);
  const identityHtml = renderIdentity({
    prd,
    counts: { reqs: sortedReqs.length, screens: sortedScreens.length, pageWord },
    build,
    generatedAt: ctx.generatedAt,
    review: ctx.review,
  });
  const roundHtml = renderRound(state, { groups: ctx.groups });
  const waitingHtml = renderWaiting({
    pending: ctx.pending || [],
    structure: ctx.groups.structure,
    decisions,
    ledger: ctx.ledger || [],
  });
  const reqRows = renderRequirementRows(sortedReqs, covered, showBasis);
  const cardsByFlow = renderScreenCards(sortedScreens, { tokens, appCss });

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<!-- station-meta ${JSON.stringify({ version: prd.version, generatedAt: ctx.generatedAt }).replace(
      /[<>&]/g,
      (char) => ({ '<': '\\u003c', '>': '\\u003e', '&': '\\u0026' })[char],
    )} -->
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
    <p class="meta">产品工作台 · ${esc(stageLabel)}</p>
    ${identityHtml}
  </header>

${buildSection}

  <section class="next">
    <p class="next__label">下一步</p>
    <h2>${esc(nextAction)}</h2>
  </section>

  ${roundHtml}

  <section id="waiting" aria-label="等你处理">
    <h2>等你处理</h2>
    ${waitingHtml}
  </section>

  <details class="reference" id="requirements">
    <summary>需求进度（${sortedReqs.length} 条 · ${
      active.length ? `${done.length}/${active.length} 有原型` : '还没有需求'
    }）</summary>
    <section class="stats">
    <div class="stat"><b>${sortedReqs.length}</b><span>需求总数</span></div>
    <div class="stat"><b>${done.length}</b><span>已有原型（不含已砍）</span></div>
    <div class="stat"><b>${sortedScreens.length}</b><span>${mode === 'spa' ? '原型界面' : '原型页面'}</span></div>
    <div class="stat"><b>${sortedReqs.filter((r) => r.status === 'draft').length}</b><span>待做原型</span></div>
  </section>

    ${
      sortedReqs.length
        ? `<table>
      <thead><tr><th>ID</th><th>需求</th><th>优先级</th><th>状态</th>${showBasis ? '<th>依据</th>' : ''}<th>在哪个页面</th></tr></thead>
      <tbody>${reqRows}</tbody>
    </table>`
        : '<p class="empty">还没有需求。把想法告诉 AI，它会先帮你写第一条。</p>'
    }
  </details>

  <details class="reference" open>
    <summary>${mode === 'spa' ? '原型界面' : '原型页面'}（${sortedScreens.length}）</summary>
    ${sortedScreens.length ? cardsByFlow : `<p class="empty">还没有原型${mode === 'spa' ? '界面' : '页面'}。让 AI 先做一个首页。</p>`}
  </details>

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

/** 工作台里嵌的元信息，用来判断它是不是旧版本生成的。 */
function readWorkbenchMeta(html) {
  const match = html && html.match(/<!-- station-meta (\{.*?\}) -->/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/**
 * 读 .station 里的 JSON：文件坏了要明说，不能悄悄当成「不存在」，
 * 否则这一轮的变更清单会空得莫名其妙。
 */
function loadStationJson(file, label) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    warn(`${label}（${rel(file)}）已经损坏，按基线重建：这一轮的改动不会被列出`);
    return null;
  }
}

const isChange = (change) =>
  Boolean(
    change &&
      typeof change.kind === 'string' &&
      typeof change.scope === 'string' &&
      typeof change.digest === 'string',
  );

/** 把生成时间从页面里抹掉，用来判断「除了时间戳，内容有没有变」。 */
function withoutStamp(html, meta) {
  if (!html || !meta?.generatedAt) return html || '';
  return html.split(meta.generatedAt).join('@T@').split(formatTime(meta.generatedAt)).join('@T@');
}

function main() {
  if (CHECK_ONLY && (CONFIRM || REVIEW_MODE)) {
    fail('--check 是只读的，不写确认或评审记录：去掉 --check 单独运行');
  }
  const prdText = readText(PRD);
  const prd = prdText ? parseFrontMatter(prdText, PRD) : {};
  if (prdText) validatePrd(prd);

  const body = prdText ? prdText.replace(/^---\r?\n[\s\S]*?\r?\n---/, '') : '';
  const reqs = parseRequirements(body, PRD);
  const reqMap = validateRequirements(reqs, prd);
  validateApprovals(reqs, prd);
  validateReferences({ prdBody: body, reqs, prd });

  const openQuestions = parseOpenQuestions(body);
  const changeLogVersions = parseChangeLog(body);
  const decisions = loadDecisions();
  validateOpenQuestions(openQuestions, prd);

  const stateText = readText(STATE);
  const state = stateText ? parseFrontMatter(stateText, STATE) : {};
  if (stateText) validateState(state, prd, reqMap);

  const loaded = loadScreens({ root: ROOT, screensDir: SCREENS_DIR, manifestFile: SCREEN_MANIFEST });
  errors.push(...loaded.errors);
  warnings.push(...loaded.warnings);
  const screens = loaded.screens;
  for (const screen of screens) {
    screen.hash = screen.file ? hashFile(screen.file) : '';
  }

  if (screens.length === 0 && [...reqMap.values()].some((r) => ['prototyped', 'approved', 'delivered'].includes(r.status))) {
    fail('没有任何原型页面，但存在 prototyped/approved/delivered 的需求');
  }
  const covered = validateScreens(screens, reqMap);
  validateCoverage(reqMap, covered);

  const externalPolicy = loadExternalPolicy(PROTOTYPE_DIR);
  validateExternal(screens, loaded, externalPolicy);
  collectPreviewHints(screens);

  // 快照：工位不保证有 .git，它是唯一可靠的比对基线。
  const now = new Date().toISOString();
  let current = null;
  try {
    current = fs.readFileSync(WORKBENCH, 'utf8');
  } catch {
    current = null;
  }
  const currentMeta = readWorkbenchMeta(current);
  const snapshot = buildSnapshot({ prd, reqs, screens, decisions, openQuestions: openQuestions.questions, now });
  const snapshotFile = stationPath(ROOT, SNAPSHOT_FILE);
  const baseFile = stationPath(ROOT, BASE_FILE);
  const roundFile = stationPath(ROOT, ROUND_FILE);
  const confirmationsFile = stationPath(ROOT, CONFIRMATIONS_FILE);
  const reviewsFile = stationPath(ROOT, REVIEWS_FILE);
  const confirmations = readJsonl(confirmationsFile);

  const previous = loadStationJson(snapshotFile, '上一版快照');
  const usable = Boolean(previous && previous.reqs && previous.screens);
  if (previous && !usable) {
    warn('上一版快照读不出来，已重建基线：这一轮的改动不会被列出');
  }
  if (previous?.prd?.version && snapshot.prd.version) {
    const prevRank = versionRank(previous.prd.version);
    const nextRank = versionRank(snapshot.prd.version);
    if (prevRank && nextRank && nextRank < prevRank) {
      fail(`PRD 版本从 ${previous.prd.version} 退回了 ${snapshot.prd.version}：版本号只增不减，改回旧号会丢确认与评审记录`);
    }
  }

  // 「本轮」从上一个 PRD 版本开始算：同一版里 sync 多少次，起点都不动，
  // 否则改一点、刷新一次，前一次看到的变更就没了。
  let base = loadStationJson(baseFile, '本轮起点');
  let baseline = false;
  let baseMoved = false;
  if (!base || !base.reqs || !base.screens) {
    base = snapshot;
    baseline = true;
    baseMoved = true;
  } else if (previous && previous.prd && base.prd && previous.prd.version !== snapshot.prd.version) {
    // 上一版还有没确认的承诺类改动时，起点不推进——否则升个版本号，
    // 那些改动就从「本轮变更」里消失，等于被静默转正。
    const unconfirmed = pendingConfirmations(
      diffSnapshots(base, previous),
      confirmations,
      previous.prd.version,
    ).filter((change) => change.kind === 'commitment');
    if (unconfirmed.length) {
      hints.push(`上一版还有 ${unconfirmed.length} 处承诺类改动没确认，已带进这一轮：${unconfirmed[0].scope}…`);
    } else {
      base = previous;
      baseMoved = true;
    }
  }

  let changes = [];
  let generatedAt = now;
  const round = readJson(roundFile);
  const roundUsable =
    round && round.version === prd.version && Array.isArray(round.changes) && round.changes.every(isChange);
  if (CHECK_ONLY && roundUsable) {
    // 与上一次 sync 用同一份变更清单和同一个生成时间，否则 check 会把刚生成的页面判为过期。
    changes = round.changes;
    baseline = Boolean(round.baseline);
    if (round.at) generatedAt = round.at;
  } else {
    changes = baseline ? [] : diffSnapshots(base, snapshot);
    // 没有 round.json（例如干净检出）时沿用页面自己的生成时间，
    // 否则 check 会把一份正确的工作台判成「过期」。
    if (CHECK_ONLY && currentMeta?.generatedAt) generatedAt = currentMeta.generatedAt;
  }
  const groups = groupChanges(changes);
  // 只提醒本轮新写的决策记录：旧记录按「只增不改」不动。
  for (const change of changes) {
    if (!change.scope.startsWith('新增决策记录 ')) continue;
    const file = change.scope.slice('新增决策记录 '.length);
    const decision = decisions.find((item) => item.file === file);
    if (decision && !decision.rejected.length) {
      hints.push(`新写的 ${file} 没有「被否决的方案与原因」：负面知识只有这一个落点`);
    }
  }

  const reviews = readJsonl(reviewsFile);
  let pending = pendingConfirmations(changes, confirmations, prd.version);
  const digest = snapshotDigest(snapshot);

  validateReviewGate({ prd, openQuestions, reviews, reqMap, covered });

  // 签完冻结：同一版本签过字之后，再改就是这个版本被悄悄改了。
  // 旧记录没有 snapshotDigest，不参与冻结判断。
  const signed = latestReview(reviews, prd.version);
  // 「不通过」本来就要改，不冻结；通过和有条件通过才锁住这一版。
  if (signed && signed.conclusion !== '不通过' && signed.snapshotDigest && signed.snapshotDigest !== digest) {
    fail(
      `v${prd.version} 已经签署（${signed.role || '未标注'} · ${signed.conclusion || '通过'}），签署之后不能再改：` +
        '把这一轮的改动并入新版本（升 PRD 版本号）再签一次',
    );
  }

  // 确认记录只在检查通过时写：写进一条对不上快照的确认，比没写更糟。
  if (CONFIRM && !CHECK_ONLY) {
    const targets = CONFIRM_TARGET
      ? changes.filter((change) => change.kind === 'commitment' && change.scope.includes(CONFIRM_TARGET))
      : changes.filter((change) => change.kind === 'commitment');
    if (errors.length) {
      console.log(`检查没通过（${errors.length} 个错误），没有写确认记录：先修完再确认`);
    } else if (!targets.length) {
      console.log(CONFIRM_TARGET ? `没有找到含「${CONFIRM_TARGET}」的承诺类改动` : '这一轮没有承诺类改动需要确认');
    } else {
      recordConfirmation(confirmationsFile, {
        version: prd.version,
        changes: targets,
        by: flagValue('--by'),
        source: flagValue('--source'),
        now,
      });
      console.log(`已记下 ${targets.length} 条确认记录（v${prd.version}）`);
      // 重算一次，免得同一轮里「刚确认完」还被判成没确认。
      pending = pendingConfirmations(changes, readJsonl(confirmationsFile), prd.version);
    }
  }

  // 评审记录只在三个前置条件都过了之后才写，否则会留下一条「其实没签成」的记录。
  if (REVIEW_MODE && !CHECK_ONLY) {
    const conclusion = flagValue('--conclusion');
    const role = flagValue('--role');
    const notes = flagValue('--notes')
      .split(/[；;]/)
      .map((note) => note.trim())
      .filter(Boolean);
    const problems = [];
    if (!REVIEW_CONCLUSIONS.includes(conclusion)) {
      problems.push(`要显式写结论：--conclusion ${REVIEW_CONCLUSIONS.join(' | ')}`);
    }
    if (!REVIEW_ROLES.includes(role)) {
      problems.push(`要显式写角色：--role ${REVIEW_ROLES.join(' | ')}`);
    }
    if (errors.length) problems.push(`检查没通过（${errors.length} 个错误），不能签署`);
    if (pending.length) problems.push(`还有 ${pending.length} 处承诺类改动没确认：先确认，再评审`);
    const unresolved = openQuestions.questions.filter((row) => !row.resolved);
    if (conclusion === '通过' && unresolved.length) {
      problems.push(`结论是「通过」，但还有 ${unresolved.length} 条开放问题没处置：要么处置完，要么签「有条件通过」`);
    }
    if (conclusion === '有条件通过') {
      if (!notes.length) {
        problems.push('「有条件通过」必须写清遗留项（--notes "遗留一；遗留二"），否则等于没说');
      } else {
        // 遗留项必须已经在开放问题表里：只留在对话或命令行里的意见，不算落盘。
        const unmatched = notes.filter(
          (note) => !unresolved.some((row) => row.question.includes(note) || note.includes(row.question)),
        );
        if (unmatched.length) {
          problems.push(`这些遗留项还没写进 PRD「开放问题」表：${unmatched.map((note) => `「${note}」`).join('、')}`);
        }
      }
    }
    if (problems.length) {
      for (const problem of problems) fail(problem);
    } else {
      const record = recordReview(reviewsFile, {
        version: prd.version,
        role,
        conclusion,
        reqs: reqs.filter((req) => req.status === 'approved' || req.status === 'delivered').map((req) => req.id),
        openItems: unresolved.map((row) => row.question),
        notes,
        snapshotDigest: digest,
        now,
      });
      reviews.push(record);
      console.log(`已记下评审记录：v${prd.version} · ${role} · ${conclusion}`);
    }
  }

  if (pending.length && REQUIRE_CONFIRMATIONS) {
    gates.push(
      `有 ${pending.length} 处承诺类改动还没有确认记录：${pending.map((change) => change.scope).join('；')}。` +
        '确认后重新运行（node scripts/sync.mjs --confirm --by "谁"）',
    );
  }

  const ledger = deriveLedger({ reqs, decisions, state });
  const currentReview = latestReview(reviews, prd.version);

  // 即使检查失败也要生成工作台：把失败状态直接显示给人看，而不是静默保留旧页面。
  let html = renderWorkbench({
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
      openQuestions,
      changeLogVersions,
      groups,
      pending,
      ledger,
      generatedAt,
      review: currentReview,
    },
  });

  if (current !== html) {
    if (CHECK_ONLY) {
      const behind = `页面是 v${currentMeta?.version || '?'}，PRD 是 v${prd.version}`;
      if (REQUIRE_FRESH) gates.push(`工作台.html 不是最新生成物（${behind}）：交付或评审前先运行 npm run sync`);
      else hints.push(`工作台落后于工作区（${behind}）：日常不阻断，交付或评审前运行 npm run sync 刷新`);
    } else {
      // 只有生成时间不同就不重写：每次 sync 都留一条时间戳 diff 没有意义，
      // 也会让「本轮变更」的文案每次跳动。
      const unchanged =
        currentMeta?.generatedAt && withoutStamp(current, currentMeta) === withoutStamp(html, { generatedAt });
      if (unchanged) {
        generatedAt = currentMeta.generatedAt;
      } else {
        fs.writeFileSync(WORKBENCH, html);
      }
    }
  }

  if (!CHECK_ONLY && errors.length === 0) {
    writeJson(snapshotFile, snapshot);
    if (baseMoved) writeJson(baseFile, base);
    // at 必须等于页面里嵌的那个时间，否则 check 会拿新时间重渲染，把刚生成的页面判成过期。
    writeJson(roundFile, { version: prd.version, at: generatedAt, baseline, changes });
  }

  const { active, done } = coverageOf(reqs, covered);
  console.log(
    `PRD v${prd.version || '?'} · ${reqs.length} 个需求 · ${screens.length} 个${loaded.mode === 'spa' ? '界面（SPA）' : '页面'}`,
  );
  console.log(active.length ? `覆盖：${done.length}/${active.length} 个有效需求已出原型` : '覆盖：还没有需求');
  if (!CHECK_ONLY) {
    console.log(
      baseline
        ? '已记下这一版作为基线，下一轮起会逐条列出改了什么'
        : `本轮变更：承诺类 ${groups.commitment.length} · 结构类 ${groups.structure.length} · 重写类 ${groups.rewrite.length}`,
    );
  }
  if (pending.length) {
    console.log(
      `待确认：${pending.length} 处承诺类改动等人点头${REQUIRE_CONFIRMATIONS ? '' : '（日常不阻断）'}`,
    );
  }
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
  if (gates.length) {
    console.log(`\n${red('✖ 交付前必须解决')} (${gates.length})`);
    for (const msg of gates) console.log(`  - ${msg}`);
  }
  if (errors.length || gates.length || (STRICT && warnings.length)) {
    console.log(
      `\n${red('✖ 一致性校验未通过')}${
        STRICT && warnings.length && !errors.length && !gates.length ? '（strict：警告即失败）' : ''
      }`,
    );
    process.exitCode = 1;
  } else {
    console.log(`\n${green('✔ 一致性校验通过')}${warnings.length ? '（有警告）' : ''}`);
  }
}

main();
