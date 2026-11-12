/**
 * 工位账本：快照、变更分级、确认记录、评审记录、承诺推导。
 *
 * 只被 scripts/sync.mjs 使用，不单独运行。设计约束（见 AGENTS.md）：
 * - 快照是唯一可靠的比对基线：工位不保证有 .git。
 * - 确认记录防的是疏忽，不是伪造：它由 AI 代写，人能看见并抽查。
 * - 账本是推导物：从 REQ 状态、开放问题、ADR、STATE.next_action 推出来，
 *   不新建第二份真相。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const STATION_DIR = '.station';
export const SNAPSHOT_FILE = 'snapshot.json';
/** 本轮起点：一直停在上一版的样子，同一版里 sync 多少次都不推进。 */
export const BASE_FILE = 'base.json';
export const ROUND_FILE = 'round.json';
export const CONFIRMATIONS_FILE = 'confirmations.jsonl';
export const REVIEWS_FILE = 'reviews.jsonl';

export const CHANGE_LABELS = {
  commitment: '承诺类',
  structure: '结构类',
  rewrite: '重写类',
};

const sha1 = (value) => crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 12);

export const hashText = sha1;

export function hashFile(file) {
  try {
    return sha1(fs.readFileSync(file));
  } catch {
    return '';
  }
}

export function stationPath(root, file) {
  return path.join(root, STATION_DIR, file);
}

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function readJsonl(file) {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

export function writeJson(file, data) {
  ensureDir(file);
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

export function appendJsonl(file, record) {
  ensureDir(file);
  const line = `${JSON.stringify(record)}\n`;
  if (fs.existsSync(file)) {
    const text = fs.readFileSync(file, 'utf8');
    if (!text.endsWith('\n') && text.length) fs.appendFileSync(file, '\n');
  }
  fs.appendFileSync(file, line);
}

/** 版本号转序号，用于比较大小；不合法返回 null。每段单独放大，避免多位数碰撞。 */
export function versionRank(version) {
  const match = String(version || '').match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return Number(match[1]) * 1e12 + Number(match[2]) * 1e6 + Number(match[3]);
}

/**
 * 「挂了几轮」：按 PRD 变更记录表数，提出于某版之后又出了几版。
 * 表可能倒序（最新在前）也可能正序，先看首尾版本判断方向。
 * 数不出来时返回 null，不猜。
 */
export function roundsSince(raisedAt, changeLogVersions) {
  const version = String(raisedAt || '').replace(/^v/i, '').trim();
  if (!versionRank(version) || !changeLogVersions.length) return null;
  const index = changeLogVersions.indexOf(version);
  if (index === -1) return null;
  const first = versionRank(changeLogVersions[0]);
  const last = versionRank(changeLogVersions[changeLogVersions.length - 1]);
  // 正序（旧在前）时，越靠后越新。
  if (first && last && first < last) return changeLogVersions.length - 1 - index;
  return index;
}

/**
 * 建快照。只存比对需要的字段，不存整页 HTML。
 */
export function buildSnapshot({ prd, reqs, screens, decisions, openQuestions, now }) {
  const reqMap = {};
  for (const req of reqs) {
    reqMap[req.id] = {
      title: req.title,
      priority: req.priority,
      status: req.status,
      acceptanceCount: req.acceptanceLines.length,
      acceptanceHash: sha1(req.acceptanceLines.join('\n')),
      approval: req.approval || '',
    };
  }
  const screenMap = {};
  for (const screen of screens) {
    if (!screen.id) continue;
    screenMap[screen.id] = {
      title: screen.title || '',
      reqs: [...screen.reqs].sort(),
      hash: screen.hash || '',
      file: screen.relFile || '',
    };
  }
  const decisionMap = {};
  for (const decision of decisions) {
    decisionMap[decision.file] = { title: decision.title, hash: decision.hash };
  }
  return {
    generatedAt: now,
    prd: { version: prd.version, status: prd.status || '', updated: prd.updated || '' },
    reqs: reqMap,
    screens: screenMap,
    decisions: decisionMap,
    openQuestions: openQuestions.map((question) => ({
      text: question.question,
      status: question.status,
      raisedAt: question.raisedAt || '',
      owner: question.owner || '',
      // 整行 hash：负责人、「提出于」这类不改变问题的改动也要能比出来。
      hash: sha1([question.question, question.owner || '', question.raisedAt || '', question.status || ''].join('|')),
    })),
  };
}

/** 快照自身的指纹：不含生成时间，用于判断「签署之后有没有再改」。 */
export function snapshotDigest(snapshot) {
  if (!snapshot) return '';
  const { generatedAt, ...rest } = snapshot;
  return sha1(JSON.stringify(rest));
}

/**
 * 比对两次快照，按 AIP-9 的三档分类。
 *
 * 承诺类：REQ 增删或四要素变化、PRD 状态、ADR 增删改、开放问题增删改。
 * 结构类：页面/路由增删、data-req 归属变化。
 * 重写类：页面内容变化，但页面与需求归属没动。
 *
 * PRD 版本号每轮都变，不单独算一档。
 */
export function diffSnapshots(prev, next) {
  if (!prev) return [];
  const changes = [];
  const push = (kind, scope, detail = '') => changes.push({ kind, scope, detail, digest: sha1(`${kind}|${scope}`) });

  const prevReqs = prev.reqs || {};
  const nextReqs = next.reqs || {};
  for (const id of Object.keys(nextReqs).sort()) {
    const before = prevReqs[id];
    const after = nextReqs[id];
    if (!before) {
      push('commitment', `新增需求 ${id}「${after.title}」`);
      continue;
    }
    if (before.title !== after.title) push('commitment', `${id} 标题「${before.title}」→「${after.title}」`);
    if (before.priority !== after.priority) push('commitment', `${id} 优先级 ${before.priority}→${after.priority}`);
    if (before.status !== after.status) push('commitment', `${id} 状态 ${before.status}→${after.status}`);
    if (before.acceptanceCount !== after.acceptanceCount) {
      push('commitment', `${id} 验收 ${before.acceptanceCount}→${after.acceptanceCount} 条`);
    } else if (before.acceptanceHash !== after.acceptanceHash) {
      push('commitment', `${id} 验收内容有改动`);
    }
    if ((before.approval || '') !== (after.approval || '')) {
      push('commitment', `${id} 的批准记录有改动`);
    }
  }
  for (const id of Object.keys(prevReqs).sort()) {
    if (!nextReqs[id]) push('commitment', `删除需求 ${id}「${prevReqs[id].title}」`);
  }

  const prevStatus = prev.prd?.status || '';
  const nextStatus = next.prd?.status || '';
  if (prevStatus !== nextStatus) push('commitment', `PRD 状态 ${prevStatus || '未设置'}→${nextStatus || '未设置'}`);

  const prevDecisions = prev.decisions || {};
  const nextDecisions = next.decisions || {};
  for (const file of Object.keys(nextDecisions).sort()) {
    const before = prevDecisions[file];
    const after = nextDecisions[file];
    if (!before) push('commitment', `新增决策记录 ${file}`);
    else if (before.title !== after.title || before.hash !== after.hash) {
      push('commitment', `决策记录 ${file} 内容有改动`);
    }
  }
  for (const file of Object.keys(prevDecisions).sort()) {
    if (!nextDecisions[file]) push('commitment', `删除决策记录 ${file}`);
  }

  const keyOf = (question) => sha1(question.text);
  const prevQuestions = new Map((prev.openQuestions || []).map((q) => [keyOf(q), q]));
  const nextQuestions = new Map((next.openQuestions || []).map((q) => [keyOf(q), q]));
  for (const [key, question] of nextQuestions) {
    const before = prevQuestions.get(key);
    if (!before) {
      push('commitment', `新增开放问题「${question.text}」`);
      continue;
    }
    if ((before.status || '') !== (question.status || '')) {
      push('commitment', `开放问题「${question.text}」状态 ${before.status || '未设置'}→${question.status || '未设置'}`);
    } else if ((before.hash || '') !== (question.hash || '')) {
      push('commitment', `开放问题「${question.text}」的负责人或提出于版本有改动`);
    }
  }
  for (const [key, question] of prevQuestions) {
    if (!nextQuestions.has(key)) push('commitment', `删除开放问题「${question.text}」`);
  }

  const prevScreens = prev.screens || {};
  const nextScreens = next.screens || {};
  for (const id of Object.keys(nextScreens).sort()) {
    const before = prevScreens[id];
    const after = nextScreens[id];
    if (!before) {
      push('structure', `新增页面 ${id}「${after.title}」`, after.file || '');
      continue;
    }
    const beforeReqs = before.reqs || [];
    const afterReqs = after.reqs || [];
    if (beforeReqs.join(',') !== afterReqs.join(',')) {
      const added = afterReqs.filter((req) => !beforeReqs.includes(req));
      const removed = beforeReqs.filter((req) => !afterReqs.includes(req));
      const parts = [
        added.length ? `挂上 ${added.join('、')}` : '',
        removed.length ? `摘掉 ${removed.join('、')}` : '',
      ].filter(Boolean);
      push(
        'structure',
        `页面 ${id} 的需求归属从 ${beforeReqs.join('、') || '无'} 变成 ${afterReqs.join('、') || '无'}`,
        `${parts.join('，')}${after.file ? `；文件 ${after.file}` : ''}`,
      );
    } else if (before.hash !== after.hash) {
      push('rewrite', `页面 ${id}「${after.title}」的内容有改动`, after.file || '');
    }
  }
  for (const id of Object.keys(prevScreens).sort()) {
    if (!nextScreens[id]) {
      push('structure', `删除页面 ${id}「${prevScreens[id].title}」`, prevScreens[id].file || '');
    }
  }

  return changes;
}

export function groupChanges(changes) {
  return {
    commitment: changes.filter((change) => change.kind === 'commitment'),
    structure: changes.filter((change) => change.kind === 'structure'),
    rewrite: changes.filter((change) => change.kind === 'rewrite'),
  };
}

/**
 * 本轮承诺类变更里，哪些缺确认记录。
 * 确认记录要同时对上 diffDigest 与当前 PRD 版本：同一个 digest 不能跨轮复用。
 */
export function pendingConfirmations(changes, confirmations, version) {
  const confirmed = new Set(
    confirmations.filter((record) => record.version === version).map((record) => record.diffDigest),
  );
  return changes.filter((change) => change.kind === 'commitment' && !confirmed.has(change.digest));
}

/**
 * 账本：从既有事实推导，不新增文件。
 *
 * 开放问题不在这里重复：它们已经按「挂了几轮」排在「要你拍板」里，
 * 同一件事在同一个区出现两次只会让人看漏。
 */
export function deriveLedger({ reqs, decisions, state }) {
  const ledger = [];

  for (const req of reqs) {
    if (req.status !== 'approved' && req.status !== 'delivered') continue;
    ledger.push({
      kind: '对外',
      text: `${req.id}「${req.title}」已评审`,
      detail: req.approval ? `批准 ${req.approval}` : '缺批准记录',
      anchor: `#req-${req.id}`,
    });
  }

  if (state.next_action) {
    ledger.push({ kind: '对内', text: state.next_action, detail: '下一件要做的事（只会保留最新一条）' });
  }

  for (const decision of decisions) {
    for (const rejected of decision.rejected) {
      ledger.push({ kind: '负向', text: rejected, detail: `来自 ${decision.file}` });
    }
  }

  return ledger;
}

export function recordConfirmation(file, { version, changes, by, source, now }) {
  for (const change of changes) {
    appendJsonl(file, {
      at: now,
      version,
      diffDigest: change.digest,
      kind: change.kind,
      scope: change.scope,
      source: source || '对话',
      by: by || '未署名',
    });
  }
}

/** 评审记录：评的是快照，所以连快照指纹一起存——签完之后再改就能查出来。 */
export function recordReview(file, { version, role, conclusion, reqs, openItems, notes, snapshotDigest, now }) {
  const record = {
    at: now,
    version,
    role,
    conclusion,
    reqs: reqs || [],
    openItems: openItems || [],
    notes: notes || [],
    snapshotDigest: snapshotDigest || '',
  };
  appendJsonl(file, record);
  return record;
}

export function latestReview(reviews, version) {
  const matched = reviews.filter((review) => review.version === version);
  return matched.length ? matched[matched.length - 1] : null;
}

export const REVIEW_CONCLUSIONS = ['通过', '有条件通过', '不通过'];
export const REVIEW_ROLES = ['自评', '内部评审', '甲方评审'];
