#!/usr/bin/env node
/**
 * 打包并安装「启动技能」：把模板工程打成用户级技能，用于从空文件夹建工位。
 *
 *   node scripts/launcher.mjs build             生成 dist/launcher/product-studio/
 *   node scripts/launcher.mjs install           生成后装到 ~/.claude/skills/product-studio
 *   node scripts/launcher.mjs install --dir X   装到指定目录（测试用）
 *
 * 技能里自带模板，建站和升级不依赖网络。模板由 new.mjs 现场生成，避免在仓库里
 * 存第二份工位骨架。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'launcher/product-studio/SKILL.md');
const OUT = path.join(ROOT, 'dist/launcher/product-studio');

function readVersion() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'pipe', encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} 失败：${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function build() {
  if (!fs.existsSync(SOURCE)) {
    throw new Error('缺少 launcher/product-studio/SKILL.md');
  }
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.copyFileSync(SOURCE, path.join(OUT, 'SKILL.md'));
  fs.writeFileSync(path.join(OUT, 'VERSION'), `${readVersion()}\n`);

  // 用 new.mjs 生成一份干净的工位骨架，作为技能内置模板。
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-launcher-'));
  try {
    const template = path.join(temp, 'template');
    run(process.execPath, [path.join(ROOT, 'scripts/new.mjs'), template, '--name', '产品工位'], ROOT);
    fs.cpSync(template, path.join(OUT, 'template'), { recursive: true });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }

  console.log(`✔ 启动技能已生成：${path.relative(ROOT, OUT)}（模板 v${readVersion()}）`);
  return OUT;
}

function install(destination) {
  const built = build();
  const target = destination || path.join(os.homedir(), '.claude/skills/product-studio');
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(built, target, { recursive: true });
  console.log(`✔ 已安装到：${target}`);
  console.log('  在空文件夹里对 AI 说「建一个产品工位」即可。');
}

function parseArgs(argv) {
  const args = { command: argv[0] || 'build', dir: '' };
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === '--dir') args.dir = argv[++index] || '';
  }
  return args;
}

const { command, dir } = parseArgs(process.argv.slice(2));
try {
  if (command === 'build') build();
  else if (command === 'install') install(dir);
  else {
    console.error('用法：node scripts/launcher.mjs build | install [--dir <目录>]');
    process.exit(1);
  }
} catch (error) {
  console.error(`✖ ${error.message}`);
  process.exit(1);
}
