#!/usr/bin/env node
/**
 * 把工位的规则、脚本、技能和文档升级到当前模板版本。
 *
 *   node scripts/upgrade.mjs <工位目录>
 *
 * 只替换机器层：AGENTS/CLAUDE、package.json、scripts/、skills/、packs/、docs/、
 * LICENSES/、共享样式。产品内容（product/、prototype/、STATE.md、工作台.html）不动。
 * 通常由启动技能调用，产品经理不需要自己运行。
 */
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

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function version(dir) {
  return readJson(path.join(dir, 'package.json'))?.version || '未知';
}

const target = process.argv[2];
if (!target) fail('用法：node scripts/upgrade.mjs <工位目录>');

const station = path.resolve(target);
if (!fs.existsSync(station)) fail(`目录不存在：${station}`);
if (path.resolve(station) === ROOT) fail('目标和模板是同一个目录，不需要升级');
if (!fs.existsSync(path.join(station, 'AGENTS.md')) || !fs.existsSync(path.join(station, 'product/PRD.md'))) {
  fail('目标不像是产品工位：需要同时有 AGENTS.md 和 product/PRD.md');
}

const templateVersion = version(ROOT);
const stationVersion = version(station);
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
console.log('  保留产品内容：product/、prototype/；STATE.md 只补 last_* 字段；工作台.html 不动');
console.log('  下一步：在工位里运行 npm run sync && npm run check');
