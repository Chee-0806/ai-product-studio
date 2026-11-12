/**
 * 读取原型页面：多页 HTML 或单页应用（SPA）清单。
 *
 * 两种来源对上层是同一件事：一组带 id / title / flow / form / reqs 的界面。
 * - 没有 prototype/screens.json：扫描 prototype/screens/**\/*.html（原有行为）。
 * - 有 prototype/screens.json 且 mode=spa：按清单描述入口与路由，不要求每个路由是独立 HTML。
 */
import fs from 'node:fs';
import path from 'node:path';

export const FORMS = ['mobile', 'desktop', 'responsive'];
export const FORM_LABELS = { mobile: '手机', desktop: '桌面', responsive: '自适应' };
export const DEFAULT_FORM = 'responsive';

const toPosix = (value) => value.split(path.sep).join('/');
const rel = (root, file) => toPosix(path.relative(root, file));
const uniq = (values) => [...new Set(values)];

export function walkHtml(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkHtml(full));
    else if (entry.isFile() && entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

function parseMeta(html) {
  const meta = {};
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const name = tag[0].match(/\bname=["']([^"']+)["']/i)?.[1];
    const content = tag[0].match(/\bcontent=["']([^"']*)["']/i)?.[1] ?? '';
    if (name && name.toLowerCase().startsWith('screen:')) {
      meta[name.slice(7).toLowerCase()] = content;
    }
  }
  return meta;
}

/** 找出页面加载的外部 http(s) 资源；普通 <a href> 外链不算。 */
export function detectExternalResources(html) {
  const urls = new Set();
  const add = (value) => {
    const trimmed = String(value).trim();
    if (/^(https?:)?\/\//i.test(trimmed)) urls.add(trimmed);
  };

  for (const tag of html.matchAll(/<(script|img|source|video|audio|iframe|link|object)\b[^>]*>/gi)) {
    const raw = tag[0];
    for (const attr of ['src', 'href', 'data', 'poster']) {
      const match = raw.match(new RegExp(`\\b${attr}\\s*=\\s*["']([^"']+)["']`, 'i'));
      if (match) add(match[1]);
    }
    const srcset = raw.match(/\bsrcset\s*=\s*["']([^"']+)["']/i);
    if (srcset) {
      for (const part of srcset[1].split(',')) add(part.trim().split(/\s+/)[0]);
    }
  }
  for (const match of html.matchAll(/url\(\s*["']?((?:https?:)?\/\/[^)"']+)["']?\s*\)/gi)) {
    urls.add(match[1]);
  }
  for (const match of html.matchAll(/@import\s+["']((?:https?:)?\/\/[^"']+)["']/gi)) {
    urls.add(match[1]);
  }
  return [...urls];
}

function normalizeUrl(url) {
  return url.startsWith('//') ? `https:${url}` : url;
}

function hostOf(url) {
  try {
    return new URL(normalizeUrl(url)).host.toLowerCase();
  } catch {
    return '';
  }
}

/** 白名单按域名匹配，支持 https://*.example.com 或 *.example.com。 */
export function isExternalAllowed(url, allow = []) {
  const host = hostOf(url);
  if (!host) return false;
  return allow.some((raw) => {
    let pattern = String(raw).trim().toLowerCase();
    if (!pattern) return false;
    if (pattern.includes('://')) {
      try {
        pattern = new URL(pattern).host.toLowerCase();
      } catch {
        return false;
      }
    }
    pattern = pattern.replace(/\/+$/, '');
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1);
      return host === pattern.slice(2) || host.endsWith(suffix);
    }
    return host === pattern;
  });
}

export function loadExternalPolicy(protoRoot) {
  const file = path.join(protoRoot, 'external.json');
  if (!fs.existsSync(file)) return { allow: [], errors: [] };
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return {
      allow: [],
      errors: [`prototype/external.json：不是合法 JSON（${error.message}）`],
    };
  }
  const errors = [];
  let allow = [];
  if (data.allow !== undefined && !Array.isArray(data.allow)) {
    errors.push('prototype/external.json：allow 必须是数组');
  } else {
    allow = (data.allow || []).map((item) => String(item).trim()).filter(Boolean);
  }
  return { allow, errors };
}

function parseScreenFile(file, root, protoRoot) {
  const html = fs.readFileSync(file, 'utf8');
  const meta = parseMeta(html);
  const previewRaw = (meta.preview || '').trim();
  const previewFile = previewRaw ? path.resolve(protoRoot, previewRaw) : null;
  return {
    file,
    relFile: rel(root, file),
    bytes: Buffer.byteLength(html),
    id: (meta.id || '').trim(),
    title: (meta.title || '').trim(),
    flow: (meta.flow || '').trim(),
    form: (meta.form || DEFAULT_FORM).trim().toLowerCase(),
    reqs: uniq([...html.matchAll(/data-req=["'](REQ-\d{3})["']/g)].map((match) => match[1])),
    previewRaw,
    previewFile,
    previewRel: previewFile ? rel(root, previewFile) : '',
    externalUrls: detectExternalResources(html),
    mode: 'multi',
    source: 'html',
  };
}

function isInside(parent, child) {
  return child === parent || child.startsWith(parent + path.sep);
}

function loadSpa({ root, protoRoot, manifestFile, manifest, errors, warnings }) {
  const label = rel(root, manifestFile);
  const screens = [];
  const entryRaw = typeof manifest.entry === 'string' ? manifest.entry.trim() : '';
  if (!entryRaw) {
    errors.push(`${label}：SPA 清单缺少 entry（入口 HTML，例如 app.html）`);
    return { mode: 'spa', entry: '', entryFile: null, entryExternal: [], screens, errors, warnings };
  }

  const entryFile = path.resolve(protoRoot, entryRaw);
  if (!isInside(protoRoot, entryFile)) {
    errors.push(`${label}：entry 不能指向 prototype/ 之外（当前「${entryRaw}」）`);
  } else if (!fs.existsSync(entryFile)) {
    errors.push(`${label}：入口文件不存在：prototype/${entryRaw}`);
  } else if (!entryFile.endsWith('.html')) {
    errors.push(`${label}：entry 必须是 HTML 文件（当前「${entryRaw}」）`);
  }

  const entryRel = toPosix(path.relative(protoRoot, entryFile));
  const entryHtml = fs.existsSync(entryFile) ? fs.readFileSync(entryFile, 'utf8') : '';
  const entryExternal = detectExternalResources(entryHtml);

  if (!Array.isArray(manifest.screens) || manifest.screens.length === 0) {
    errors.push(`${label}：screens 必须是非空数组，每个界面一项`);
    return { mode: 'spa', entry: entryRel, entryFile, entryExternal, screens, errors, warnings };
  }

  const seen = new Set();
  manifest.screens.forEach((raw, index) => {
    const where = `${label} 第 ${index + 1} 个界面`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(`${where}：必须是对象`);
      return;
    }

    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!id) {
      errors.push(`${where}：缺少 id`);
    } else if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) {
      errors.push(`${where}：id 只能包含英文、数字、下划线和短横线（当前「${id}」）`);
    } else if (seen.has(id)) {
      errors.push(`${where}：id 重复（${id}）`);
    } else {
      seen.add(id);
    }

    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    if (!title) errors.push(`${where}：缺少 title`);

    let route = typeof raw.route === 'string' ? raw.route.trim() : '';
    if (!route && id) route = `#/${id}`;
    if (route && !route.startsWith('#')) {
      errors.push(`${where}：route 必须以 # 开头，才能双击 file:// 打开（当前「${route}」）`);
    }

    const form = String(raw.form || DEFAULT_FORM).trim().toLowerCase();
    if (!FORMS.includes(form)) {
      errors.push(`${where}：form 只能是 ${FORMS.join(' | ')}（当前「${raw.form}」）`);
    }

    let reqs = [];
    if (raw.reqs !== undefined && !Array.isArray(raw.reqs)) {
      errors.push(`${where}：reqs 必须是数组，例如 ["REQ-001"]`);
    } else {
      reqs = uniq(
        (raw.reqs || []).map((item) => String(item).trim()).filter(Boolean),
      );
      for (const reqId of reqs) {
        if (!/^REQ-\d{3}$/.test(reqId)) errors.push(`${where}：reqs 里的「${reqId}」不是合法需求 ID`);
      }
    }

    const flow = typeof raw.flow === 'string' ? raw.flow.trim() : '';

    const previewRaw = typeof raw.preview === 'string' ? raw.preview.trim() : '';
    let previewFile = previewRaw ? path.resolve(protoRoot, previewRaw) : null;
    if (previewFile && !isInside(protoRoot, previewFile)) {
      errors.push(`${where}：preview 不能指向 prototype/ 之外（当前「${previewRaw}」）`);
      previewFile = null;
    } else if (previewFile && !fs.existsSync(previewFile)) {
      warnings.push(`${where}：preview 指向的图片不存在：prototype/${previewRaw}`);
      previewFile = null;
    }

    screens.push({
      file: entryFile,
      relFile: `${rel(root, entryFile)}${route}`,
      id,
      title,
      flow,
      form,
      reqs,
      previewRaw,
      previewFile,
      previewRel: previewFile ? rel(root, previewFile) : '',
      // 入口扫描结果统一挂在清单上，避免每个路由重复告警。
      externalUrls: [],
      mode: 'spa',
      source: 'manifest',
    });
  });

  return { mode: 'spa', entry: entryRel, entryFile, entryExternal, screens, errors, warnings };
}

export function loadScreens({ root, screensDir, manifestFile }) {
  const protoRoot = path.dirname(screensDir);
  const errors = [];
  const warnings = [];

  if (fs.existsSync(manifestFile)) {
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    } catch (error) {
      errors.push(`${rel(root, manifestFile)}：不是合法 JSON（${error.message}）`);
      return { mode: 'multi', entry: '', screens: [], errors, warnings };
    }

    const mode = String(manifest.mode || (manifest.entry ? 'spa' : 'multi')).toLowerCase();
    if (!['spa', 'multi'].includes(mode)) {
      errors.push(`${rel(root, manifestFile)}：mode 只能是 spa 或 multi（当前「${manifest.mode}」）`);
      return { mode: 'multi', entry: '', screens: [], errors, warnings };
    }
    if (mode === 'spa') {
      return loadSpa({ root, protoRoot, manifestFile, manifest, errors, warnings });
    }
    warnings.push(`${rel(root, manifestFile)}：mode=multi 时忽略清单，按 screens/*.html 扫描`);
  }

  const screens = walkHtml(screensDir).map((file) => parseScreenFile(file, root, protoRoot));
  for (const screen of screens) {
    if (screen.previewFile && !fs.existsSync(screen.previewFile)) {
      warnings.push(`${screen.relFile}：screen:preview 指向的图片不存在：${screen.previewRaw}`);
      screen.previewFile = null;
      screen.previewRel = '';
    }
  }
  return { mode: 'multi', entry: '', screens, errors, warnings };
}
