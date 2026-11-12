#!/usr/bin/env node
/**
 * 校验技能格式：
 *   - skills/ 里已安装到工位的技能；
 *   - packs/<name>/skills/ 里可选内容包的源文件；
 *   - launcher/ 里用户级启动技能的源文件。
 *
 * 三处分开校验，避免「内容包已安装」时同一技能被当成重复。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from './lib/json.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = path.join(ROOT, 'skills');
const PACKS = path.join(ROOT, 'packs');
const LAUNCHER = path.join(ROOT, 'launcher');
const errors = [];
const warnings = [];

if (!fs.existsSync(SKILLS)) {
  console.error('✖ 缺少 skills/ 目录');
  process.exit(1);
}

function validateSkill(file, prefix, seen) {
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    errors.push(`${prefix}/SKILL.md：缺少 front matter（--- 开头）`);
    return false;
  }
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index === -1) continue;
    meta[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  const name = meta.name || '';
  const description = meta.description || '';
  if (!name) errors.push(`${prefix}/SKILL.md：front matter 缺少 name`);
  else {
    if (!/^[a-z0-9-]+$/.test(name)) errors.push(`${prefix}/SKILL.md：name 只能是小写英文/数字/短横线`);
    else if (name !== path.basename(prefix)) errors.push(`${prefix}/SKILL.md：name「${name}」必须与目录名一致`);
    if (seen.has(name)) errors.push(`技能 name 重复：${name}`);
    seen.add(name);
  }
  if (!description) errors.push(`${prefix}/SKILL.md：front matter 缺少 description`);
  else if (description.length < 20) warnings.push(`${prefix}/SKILL.md：description 太短，写清触发场景`);

  const body = match[2];
  const vendored = text.includes('来源：Anthropic');
  if (!/^##\s+什么时候用/m.test(body)) {
    errors.push(`${prefix}/SKILL.md：缺少「## 什么时候用」`);
  }
  if (!vendored && !/^##\s+不要做/m.test(body)) {
    warnings.push(`${prefix}/SKILL.md：建议补「## 不要做」`);
  }
  const lines = body.split(/\r?\n/).length;
  if (!vendored && lines > 120) warnings.push(`${prefix}/SKILL.md：正文 ${lines} 行，建议控制在 120 行内`);
  if (/\bTODO\b|\bFIXME\b/.test(text)) {
    errors.push(`${prefix}/SKILL.md：不要留 TODO/FIXME`);
  }
  return true;
}

function validateRoot(dir, prefix) {
  const seen = new Set();
  let count = 0;
  const dirs = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of dirs) {
    const file = path.join(dir, name, 'SKILL.md');
    if (!fs.existsSync(file)) {
      errors.push(`${prefix}/${name}/：缺少 SKILL.md`);
      continue;
    }
    count += 1;
    validateSkill(file, `${prefix}/${name}`, seen);
  }
  return { count };
}

const installed = validateRoot(SKILLS, 'skills');

const launchers = fs.existsSync(LAUNCHER) ? validateRoot(LAUNCHER, 'launcher') : { count: 0 };

const packs = [];
if (fs.existsSync(PACKS)) {
  for (const entry of fs.readdirSync(PACKS, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    const dir = path.join(PACKS, name, 'skills');
    const manifest = readJson(path.join(PACKS, name, 'pack.json'));
    if (!manifest) {
      errors.push(`packs/${name}/：缺少 pack.json`);
      continue;
    }
    if (manifest.name !== name) {
      errors.push(`packs/${name}/pack.json：name「${manifest.name}」必须与目录名一致`);
    }
    if (!fs.existsSync(dir)) {
      errors.push(`packs/${name}/：缺少 skills/ 目录`);
      continue;
    }
    const result = validateRoot(dir, `packs/${name}/skills`);
    packs.push({ name, count: result.count });
  }
}

console.log(`已安装技能：${installed.count} 个`);
if (launchers.count) console.log(`启动技能：${launchers.count} 个`);
if (packs.length) {
  console.log(`可选内容包：${packs.map((pack) => `${pack.name}（${pack.count} 个技能）`).join('、')}`);
}
if (warnings.length) {
  console.log(`\n⚠ 警告 (${warnings.length})`);
  for (const msg of warnings) console.log(`  - ${msg}`);
}
if (errors.length) {
  console.log(`\n✖ 错误 (${errors.length})`);
  for (const msg of errors) console.log(`  - ${msg}`);
  process.exitCode = 1;
} else {
  console.log('✔ 技能格式通过');
}
