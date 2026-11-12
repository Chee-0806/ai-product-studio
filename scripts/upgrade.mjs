#!/usr/bin/env node
/**
 * 把工位的规则、脚本、技能和文档升级到当前模板版本。
 *
 *   node scripts/upgrade.mjs <工位目录>              升级（自动备份将被替换的机器层）
 *   node scripts/upgrade.mjs <工位目录> --rollback   回到上一次升级之前
 *   node scripts/upgrade.mjs <工位目录> --list       看还有哪些备份可以回滚
 *
 * 只替换机器层：AGENTS/CLAUDE、package.json、scripts/、skills/、packs/、docs/、
 * LICENSES/、共享样式。产品内容（product/、prototype/、工作台.html）不动，
 * STATE.md 只补 last_* 字段。
 *
 * 升级前自动把这些要替换的东西复制到 `.upgrade-backups/<时间戳>/`，保留最近 3 份，
 * 所以不需要用户自己整站备份。通常由启动技能调用，产品经理不需要自己运行。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from './lib/json.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['AGENTS.md', 'CLAUDE.md', '.gitignore', 'LICENSE', 'THIRD_PARTY_NOTICES.md'];
const DIRS = ['skills', 'packs', 'scripts', 'docs', 'LICENSES'];
// 共享样式逐个覆盖；prototype/assets/ 下的 vendor 和其他文件属于工位，不能整目录删除。
const SHARED_STYLES = [
  'prototype/assets/tokens.css',
  'prototype/assets/app.css',
  'prototype/assets/workbench.css',
];
// 这两个由升级改写，也一起备份。
const TOUCHED_EXTRA = ['package.json', 'STATE.md'];

const BACKUP_ROOT = '.upgrade-backups';
const KEEP_BACKUPS = 3;

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function version(dir) {
  return readJson(path.join(dir, 'package.json'))?.version || '未知';
}

function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function backupsOf(station) {
  const dir = path.join(station, BACKUP_ROOT);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => path.join(dir, name));
}

function pruneBackups(station) {
  const kept = backupsOf(station);
  while (kept.length > KEEP_BACKUPS - 1) {
    const oldest = kept.shift();
    fs.rmSync(oldest, { recursive: true, force: true });
  }
}

/** 只备份这次会被替换的东西：机器层很小，不用整站复制。 */
function backupMachineLayer(station, items, meta) {
  pruneBackups(station);
  const target = path.join(station, BACKUP_ROOT, stamp());
  fs.mkdirSync(target, { recursive: true });
  const copied = [];
  for (const item of items) {
    const source = path.join(station, item);
    if (!fs.existsSync(source)) continue;
    const destination = path.join(target, item);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, { recursive: true });
    copied.push(item);
  }
  fs.writeFileSync(path.join(target, 'manifest.json'), `${JSON.stringify({ ...meta, at: new Date().toISOString(), items: copied }, null, 2)}\n`);
  return { dir: target, items: copied };
}

function rollback(station) {
  const backups = backupsOf(station);
  if (!backups.length) fail('没有可回滚的备份');
  const latest = backups[backups.length - 1];
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(latest, 'manifest.json'), 'utf8'));
  } catch {
    fail(`备份不完整，缺少 manifest.json：${latest}`);
  }
  // 先删掉当前版本的同一批文件，再复制回去，避免新旧文件混在一起。
  for (const item of manifest.items || []) {
    fs.rmSync(path.join(station, item), { recursive: true, force: true });
  }
  for (const item of manifest.items || []) {
    const source = path.join(latest, item);
    if (!fs.existsSync(source)) continue;
    const destination = path.join(station, item);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, { recursive: true });
  }
  fs.rmSync(latest, { recursive: true, force: true });
  console.log(`✔ 已回滚到升级前的版本：${manifest.from || '未知'}`);
  console.log(`  恢复：${(manifest.items || []).join('、')}`);
  console.log('  下一步：在工位里运行 npm run sync');
}

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const target = args.find((arg) => !arg.startsWith('--'));
if (!target) fail('用法：node scripts/upgrade.mjs <工位目录> [--rollback | --list]');

const station = path.resolve(target);
if (!fs.existsSync(station)) fail(`目录不存在：${station}`);
if (path.resolve(station) === ROOT) fail('目标和模板是同一个目录，不需要升级');
if (!fs.existsSync(path.join(station, 'AGENTS.md')) || !fs.existsSync(path.join(station, 'product/PRD.md'))) {
  fail('目标不像是产品工位：需要同时有 AGENTS.md 和 product/PRD.md');
}

if (flags.has('--list')) {
  const backups = backupsOf(station);
  if (!backups.length) console.log('没有可回滚的备份。');
  else {
    console.log(`可回滚的备份（${backups.length}）：`);
    for (const dir of backups) {
      let meta = {};
      try {
        meta = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
      } catch {
        meta = {};
      }
      console.log(`  ${path.basename(dir)}  ${meta.from || '?'} → ${meta.to || '?'}`);
    }
  }
  process.exit(0);
}

if (flags.has('--rollback')) {
  rollback(station);
  process.exit(0);
}

const templateVersion = version(ROOT);
const stationVersion = version(station);
const items = [...FILES, ...DIRS, ...SHARED_STYLES, ...TOUCHED_EXTRA];
const backup = backupMachineLayer(station, items, { station: path.basename(station), from: stationVersion, to: templateVersion });

const replaced = [];

for (const file of FILES) {
  const source = path.join(ROOT, file);
  if (!fs.existsSync(source)) continue;
  const destination = path.join(station, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  replaced.push(file);
}

for (const dir of DIRS) {
  const source = path.join(ROOT, dir);
  if (!fs.existsSync(source)) continue;
  const destination = path.join(station, dir);
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
  replaced.push(`${dir}/`);
}

for (const file of SHARED_STYLES) {
  const source = path.join(ROOT, file);
  if (!fs.existsSync(source)) continue;
  const destination = path.join(station, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  replaced.push(file);
}

// 启动技能的打包脚本只属于模板工程，不进入工位。
fs.rmSync(path.join(station, 'scripts', 'launcher.mjs'), { force: true });

// package.json 用模板的版本与脚本，但保留工位自己的名字和说明。
const templatePackage = readJson(path.join(ROOT, 'package.json'));
if (templatePackage) {
  const stationPackage = readJson(path.join(station, 'package.json')) || {};
  const merged = { ...templatePackage };
  if (stationPackage.name) merged.name = stationPackage.name;
  if (stationPackage.description) merged.description = stationPackage.description;
  if (merged.scripts) {
    delete merged.scripts['launcher:build'];
    delete merged.scripts['launcher:install'];
  }
  fs.writeFileSync(path.join(station, 'package.json'), `${JSON.stringify(merged, null, 2)}\n`);
  replaced.push('package.json');
}

/** 旧工位没有 last_* 时补上，让 STATE.md 与当前规则一致。 */
function seedLastRound(dir) {
  const file = path.join(dir, 'STATE.md');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match || /^last_round:/m.test(match[1])) return;
  const body = match[1].replace(/\s+$/, '');
  const next = `---\n${body}\nlast_round: 工位升级到模板 v${templateVersion}\nlast_reason: 规则、脚本和技能更新；产品内容未变\nlast_reqs: 无\n---`;
  fs.writeFileSync(file, text.replace(match[0], next));
  replaced.push('STATE.md 的 last_* 字段');
}

seedLastRound(station);

// Claude Code 的技能入口；旧工位可能没有。
const claudeSkills = path.join(station, '.claude/skills');
if (!fs.existsSync(claudeSkills)) {
  try {
    fs.mkdirSync(path.dirname(claudeSkills), { recursive: true });
    fs.symlinkSync('../skills', claudeSkills, 'dir');
    replaced.push('.claude/skills');
  } catch {
    // 不支持符号链接时仍可通过 AGENTS.md 路由使用技能
  }
}

console.log(`✔ 工位已升级：${stationVersion} → ${templateVersion}`);
console.log(`  替换：${replaced.join('、')}`);
console.log(`  备份：${path.relative(station, backup.dir)}（回滚用 --rollback）`);
console.log('  保留产品内容：product/、prototype/；STATE.md 只补 last_* 字段');

// 顺手重建工作台，让升级结果当场可见；检查没过也照常重建，把问题显示出来。
const syncScript = path.join(station, 'scripts', 'sync.mjs');
if (fs.existsSync(syncScript)) {
  const result = spawnSync(process.execPath, [syncScript], { cwd: station, encoding: 'utf8' });
  if (result.status === 0) {
    console.log('  工作台已重建，一致性检查通过');
  } else {
    console.log('  工作台已重建，但一致性检查没通过，需要修：');
    const lines = `${result.stdout || ''}\n${result.stderr || ''}`.trim().split('\n').filter((line) => line.trim());
    for (const line of lines.slice(-6)) console.log(`    ${line}`);
  }
}
