#!/usr/bin/env node
/** 校验 skills/<name>/SKILL.md 的 front matter 与结构。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = path.join(ROOT, 'skills');
const errors = [];
const warnings = [];

if (!fs.existsSync(SKILLS)) {
  console.error('✖ 缺少 skills/ 目录');
  process.exit(1);
}

const dirs = fs
  .readdirSync(SKILLS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const seen = new Set();
let count = 0;

for (const dir of dirs) {
  const file = path.join(SKILLS, dir, 'SKILL.md');
  if (!fs.existsSync(file)) {
    errors.push(`skills/${dir}/：缺少 SKILL.md`);
    continue;
  }
  count += 1;
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    errors.push(`skills/${dir}/SKILL.md：缺少 front matter（--- 开头）`);
    continue;
  }
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index === -1) continue;
    meta[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  const name = meta.name || '';
  const description = meta.description || '';
  if (!name) errors.push(`skills/${dir}/SKILL.md：front matter 缺少 name`);
  else {
    if (!/^[a-z0-9-]+$/.test(name)) errors.push(`skills/${dir}/SKILL.md：name 只能是小写英文/数字/短横线`);
    else if (name !== dir) errors.push(`skills/${dir}/SKILL.md：name「${name}」必须与目录名一致`);
    if (seen.has(name)) errors.push(`技能 name 重复：${name}`);
    seen.add(name);
  }
  if (!description) errors.push(`skills/${dir}/SKILL.md：front matter 缺少 description`);
  else if (description.length < 20) warnings.push(`skills/${dir}/SKILL.md：description 太短，写清触发场景`);

  const body = match[2];
  const vendored = text.includes('来源：Anthropic');
  if (!/^##\s+什么时候用/m.test(body)) {
    errors.push(`skills/${dir}/SKILL.md：缺少「## 什么时候用」`);
  }
  if (!vendored && !/^##\s+不要做/m.test(body)) {
    warnings.push(`skills/${dir}/SKILL.md：建议补「## 不要做」`);
  }
  const lines = body.split(/\r?\n/).length;
  if (!vendored && lines > 120) warnings.push(`skills/${dir}/SKILL.md：正文 ${lines} 行，建议控制在 120 行内`);
  if (/\bTODO\b|\bFIXME\b/.test(text)) {
    errors.push(`skills/${dir}/SKILL.md：不要留 TODO/FIXME`);
  }
}

console.log(`技能：${count} 个`);
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
