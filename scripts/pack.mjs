#!/usr/bin/env node
/**
 * 可选内容包管理。
 *
 *   node scripts/pack.mjs list
 *   node scripts/pack.mjs add pm-methods
 *   node scripts/pack.mjs remove pm-methods
 *
 * 内容包默认不安装：不进入 skills/、不被 AGENTS.md 路由、不被 .claude/skills 发现。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from './lib/json.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKS = path.join(ROOT, 'packs');
const SKILLS = path.join(ROOT, 'skills');

const [command = 'list', packName = ''] = process.argv.slice(2);

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function readPack(name) {
  if (!/^[a-z0-9-]+$/.test(name)) fail(`内容包名只能是小写英文/数字/短横线：${name}`);
  const dir = path.join(PACKS, name);
  if (!fs.existsSync(dir)) fail(`没有这个内容包：${name}（运行 npm run pack:list 查看）`);
  const manifest = readJson(path.join(dir, 'pack.json'));
  if (!manifest || manifest.name !== name) fail(`packs/${name}/pack.json 缺失或 name 不一致`);
  const skills = Array.isArray(manifest.skills) ? manifest.skills : [];
  if (skills.length === 0) fail(`packs/${name}/pack.json 没有列出 skills`);
  return { dir, manifest, skills };
}

function manifestPath(name) {
  return path.join(SKILLS, `.pack-${name}.json`);
}

function installedSkills(name) {
  const manifest = readJson(manifestPath(name));
  return Array.isArray(manifest?.skills) ? manifest.skills : [];
}

function list() {
  if (!fs.existsSync(PACKS)) {
    console.log('没有 packs/ 目录，也没有可选内容包。');
    return;
  }
  const names = fs
    .readdirSync(PACKS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (names.length === 0) {
    console.log('没有可选内容包。');
    return;
  }
  for (const name of names) {
    const dir = path.join(PACKS, name);
    const manifest = readJson(path.join(dir, 'pack.json')) || {};
    const installed = installedSkills(name);
    const status = installed.length ? `已安装（${installed.length} 个技能）` : '未安装';
    console.log(`- ${name} · ${status} · ${manifest.description || '没有说明'}`);
  }
}

function add(name) {
  const { dir, manifest, skills } = readPack(name);
  if (!fs.existsSync(SKILLS)) fail('缺少 skills/ 目录');

  const already = installedSkills(name);
  if (already.length === skills.length) {
    console.log(`✔ 内容包 ${name} 已经安装（${skills.length} 个技能）`);
    return;
  }

  const collisions = skills.filter((skill) => {
    const target = path.join(SKILLS, skill);
    return fs.existsSync(target) && !already.includes(skill);
  });
  if (collisions.length) {
    fail(`这些技能目录已存在，未覆盖：${collisions.join('、')}。先确认它们不是核心技能或被其他内容包占用。`);
  }

  for (const skill of skills) {
    const source = path.join(dir, 'skills', skill);
    if (!fs.existsSync(path.join(source, 'SKILL.md'))) {
      fail(`内容包 ${name} 缺少技能文件：skills/${skill}/SKILL.md`);
    }
    fs.cpSync(source, path.join(SKILLS, skill), { recursive: true });
  }

  fs.writeFileSync(
    manifestPath(name),
    `${JSON.stringify({ pack: name, version: manifest.version || '', skills }, null, 2)}\n`,
  );
  console.log(`✔ 已安装内容包 ${name}：${skills.length} 个技能`);
  console.log('下一步：运行 npm run check，确认技能格式与工位一致性。');
}

function remove(name) {
  const skills = installedSkills(name);
  if (skills.length === 0) fail(`内容包 ${name} 没有安装，或缺少 skills/.pack-${name}.json`);
  for (const skill of skills) {
    fs.rmSync(path.join(SKILLS, skill), { recursive: true, force: true });
  }
  fs.rmSync(manifestPath(name), { force: true });
  console.log(`✔ 已移除内容包 ${name}：${skills.length} 个技能（核心技能未动）`);
}

if (command === 'list') list();
else if (command === 'add') add(packName || fail('用法：node scripts/pack.mjs add <内容包名>'));
else if (command === 'remove') remove(packName || fail('用法：node scripts/pack.mjs remove <内容包名>'));
else {
  console.error('用法：node scripts/pack.mjs <list | add <name> | remove <name>>');
  process.exit(1);
}
