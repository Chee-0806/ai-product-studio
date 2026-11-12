#!/usr/bin/env node
/**
 * 批量生成工作台用的预览图：prototype/previews/<界面 ID>.png。
 *
 *   node scripts/previews.mjs            只补需要预览图的界面（超大页面、外部资源页面、SPA 界面）
 *   node scripts/previews.mjs --all      所有界面都出静态图
 *   node scripts/previews.mjs --force    已有图片也重拍
 *   node scripts/previews.mjs --only=a,b 只处理指定界面
 *
 * 用本机已装的 Chrome/Edge/Chromium 无头模式截图，不装依赖、不联网。
 * 走浏览器调试协议设置视口，手机宽度才不会被系统最小窗口宽度撑开、截掉右边。
 * 生成后跑 npm run sync，工作台会自动改用预览图（约定优先，不需要在页面里加 meta）。
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MAX_INLINE_BYTES, loadScreens } from './lib/screens.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROTOTYPE_DIR = path.join(ROOT, 'prototype');
const SCREENS_DIR = path.join(PROTOTYPE_DIR, 'screens');
const SCREEN_MANIFEST = path.join(PROTOTYPE_DIR, 'screens.json');

const ALL = process.argv.includes('--all');
const FORCE = process.argv.includes('--force');
const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.slice('--only='.length).split(',').map((id) => id.trim()).filter(Boolean) : [];

const VIEWPORTS = {
  mobile: { width: 420, height: 900 },
  desktop: { width: 1440, height: 900 },
  responsive: { width: 1280, height: 800 },
};

function findChrome() {
  const fromEnv = process.env.CHROME_PATH || process.env.CHROME_BIN;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ];
  return candidates.find((file) => fs.existsSync(file)) || '';
}

function needsPreview(screen) {
  return screen.mode === 'spa' || screen.externalUrls.length > 0 || screen.bytes > MAX_INLINE_BYTES;
}

function outPathOf(screen) {
  const declared = (screen.previewRaw || '').trim();
  const relPath = declared.endsWith('.png') ? declared : path.join('previews', `${screen.id}.png`);
  return path.join(PROTOTYPE_DIR, relPath);
}

function urlOf(screen) {
  const hash = screen.mode === 'spa' ? (screen.relFile.match(/#.*$/) || [''])[0] : '';
  return pathToFileURL(screen.file).href + hash;
}

/** 极简 CDP 客户端：只够创建目标、设视口、导航、截图。 */
class Session {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
      else resolve(message.result || {});
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} 超时`));
      }, 30_000);
    });
  }
}

function launchChrome(bin) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-preview-'));
  const proc = spawn(
    bin,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--allow-file-access-from-files',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const cleanup = () => {
    try {
      proc.kill();
    } catch {
      /* 已退出 */
    }
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // 浏览器可能还在写临时目录；下次系统会回收，不影响产物。
    }
  };
  const ready = new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('Chrome 启动超时')), 20_000);
    proc.stderr.on('data', (chunk) => {
      buffer += chunk.toString();
      const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    proc.on('exit', () => {
      clearTimeout(timer);
      reject(new Error('Chrome 启动失败'));
    });
  });
  return { proc, cleanup, ready };
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('连不上浏览器调试端口')), { once: true });
  });
  return new Session(socket);
}

async function shootWithCdp(cdp, screen, outFile) {
  const view = VIEWPORTS[screen.form] || VIEWPORTS.responsive;
  const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId;
  try {
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send(
      'Emulation.setDeviceMetricsOverride',
      {
        width: view.width,
        height: view.height,
        deviceScaleFactor: 2,
        mobile: screen.form === 'mobile',
      },
      sessionId,
    );
    await cdp.send('Page.navigate', { url: urlOf(screen) }, sessionId);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, Buffer.from(shot.data, 'base64'));
  } finally {
    await cdp.send('Target.closeTarget', { targetId: target.targetId }).catch(() => {});
  }
  if (!fs.existsSync(outFile) || fs.statSync(outFile).size === 0) {
    throw new Error('没有生成图片（页面可能打不开或加载超时）');
  }
}

/** Node 没有内置 WebSocket 时的退路：直接命令行截图，窄屏可能被系统最小窗口宽度撑开。 */
function shootWithCli(chrome, screen, outFile) {
  const view = VIEWPORTS[screen.form] || VIEWPORTS.responsive;
  const width = Math.max(view.width, 520);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  execFileSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      `--window-size=${width},${view.height}`,
      '--virtual-time-budget=2500',
      `--screenshot=${outFile}`,
      urlOf(screen),
    ],
    { stdio: 'ignore', timeout: 90_000 },
  );
  if (!fs.existsSync(outFile) || fs.statSync(outFile).size === 0) {
    throw new Error('没有生成图片（页面可能打不开或加载超时）');
  }
}

async function main() {
  const loaded = loadScreens({ root: ROOT, screensDir: SCREENS_DIR, manifestFile: SCREEN_MANIFEST });
  if (loaded.errors.length) {
    console.error('✖ 先修原型清单的错误，再生成预览图：');
    for (const msg of loaded.errors) console.error(`  - ${msg}`);
    process.exitCode = 1;
    return;
  }
  const screens = loaded.screens.filter((screen) => !ONLY.length || ONLY.includes(screen.id));
  if (!screens.length) {
    console.log('没有可生成预览图的界面。');
    return;
  }

  const chrome = findChrome();
  if (!chrome) {
    console.error('✖ 没找到 Chrome / Edge / Chromium。装一个，或用 CHROME_PATH=/路径 指定。');
    process.exitCode = 1;
    return;
  }

  let done = 0;
  let skipped = 0;
  let untouched = 0;
  const failed = [];
  const useCdp = typeof WebSocket === 'function';
  let chromeProcess = null;

  try {
    let cdp = null;
    if (useCdp) {
      chromeProcess = launchChrome(chrome);
      cdp = await connect(await chromeProcess.ready);
    }
    for (const screen of screens) {
      const outFile = outPathOf(screen);
      if (fs.existsSync(outFile) && !FORCE) {
        skipped += 1;
        continue;
      }
      if (!ALL && !ONLY.length && !needsPreview(screen)) {
        // 小页面本来就能内联进工作台，不必出静态图。
        untouched += 1;
        continue;
      }
      try {
        if (cdp) await shootWithCdp(cdp, screen, outFile);
        else shootWithCli(chrome, screen, outFile);
        done += 1;
        console.log(`· ${screen.id} → ${path.relative(ROOT, outFile)}`);
      } catch (error) {
        failed.push(`${screen.id}：${error.message}`);
      }
    }
    if (cdp) cdp.socket.close();
  } finally {
    if (chromeProcess) chromeProcess.cleanup();
  }

  console.log(`\n预览图：生成 ${done} 张，已有跳过 ${skipped} 张${untouched ? `，小页面无需预览图 ${untouched} 个` : ''}`);
  if (failed.length) {
    console.log(`\n✖ 失败 (${failed.length})`);
    for (const msg of failed) console.log(`  - ${msg}`);
    process.exitCode = 1;
  }
  if (done) console.log('\n下一步：npm run sync（工作台会自动改用预览图）');
}

main().catch((error) => {
  console.error(`✖ ${error.message}`);
  process.exitCode = 1;
});
