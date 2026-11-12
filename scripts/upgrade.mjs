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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['AGENTS.md', 'CLAUDE.md', '.gitignore', 'package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md'];
const DIRS = ['skills', 'packs', 'scripts', 'docs', 'LICENSES', 'prototype/assets'];

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function version(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version || '未知';
  } catch {
    return '未知';
  }
}

const target = process.argv[2];
if (!target) fail('用法：node scripts/upgrade.mjs <工位目录>');

const station = path.resolve(target);
if (!fs.existsSync(station)) fail(`目录不存在：${station}`);
if (path.resolve(station) === ROOT) fail('目标和模板是同一个目录，不需要升级');
if (!fs.existsSync(path.join(station, 'AGENTS.md')) || !fs.existsSync(path.join(station, 'product/PRD.md'))) {
  fail('目标不像是产品工位：需要同时有 AGENTS.md 和 product/PRD.md');
}

const from = version(ROOT);
const to = version(station);

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

console.log(`✔ 工位已升级：${to} → ${from}`);
console.log(`  替换：${replaced.join('、')}`);
console.log('  保留：product/、prototype/、STATE.md、工作台.html');
console.log('  下一步：在工位里运行 npm run sync && npm run check');
