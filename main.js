'use strict';

const { Plugin, PluginSettingTab, Setting, Notice, TFile, normalizePath } = require('obsidian');

const DEFAULT_SETTINGS = {
  token: '',
  owner: 'white1213',
  repo: 'blog',
  branch: 'main',
  postsDir: 'content/posts',
  laodaoDir: 'content/laodao',
  uploadsDir: 'static/uploads',
  basePath: '/blog/',
  imageMaxDim: 1400,
  imageTargetKB: 350,
  imageMinQuality: 0.73
};

const MD_IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'];
const WIKI_IMG_RE = /!\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g;
const MD_IMG_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/* ---------- 小工具 ---------- */

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function isoWithOffset(d) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
    'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) +
    sign + pad2(Math.floor(abs / 60)) + ':' + pad2(abs % 60)
  );
}

function dirnameOf(path) {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

function normalizeSlug(raw) {
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/[\\/:*?"<>|#]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'post-' + Date.now().toString(36);
}

function encodePath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

function bytesToBase64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < arr.length; i += chunk) {
    binary += String.fromCharCode.apply(null, arr.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function utf8ToBase64(str) {
  return bytesToBase64(new TextEncoder().encode(str));
}

function yamlString(v) {
  return JSON.stringify(String(v));
}

function buildFrontMatter(fields) {
  let out = '---\n';
  out += 'title: ' + yamlString(fields.title) + '\n';
  out += 'date: ' + fields.date + '\n';
  if (fields.description) out += 'description: ' + yamlString(fields.description) + '\n';
  const tags = Array.isArray(fields.tags)
    ? fields.tags
    : fields.tags
      ? String(fields.tags).split(/[,，]/).map((t) => t.trim()).filter(Boolean)
      : [];
  if (tags.length) out += 'tags: [' + tags.map(yamlString).join(', ') + ']\n';
  if (fields.image) out += 'image: ' + yamlString(fields.image) + '\n';
  out += '---\n';
  return out;
}

function stripFrontMatter(content, cache) {
  const pos = cache && cache.frontmatterPosition;
  if (pos && pos.end && typeof pos.end.offset === 'number') {
    return content.slice(pos.end.offset);
  }
  const m = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? content.slice(m[0].length) : content;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片解码失败'));
    img.src = url;
  });
}

function canvasToBytes(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob(async (blob) => {
      if (!blob) return resolve(null);
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, type, quality);
  });
}

function mimeOfExt(ext) {
  switch (ext) {
    case 'png': return 'image/png';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'bmp': return 'image/bmp';
    case 'svg': return 'image/svg+xml';
    default: return 'image/jpeg';
  }
}

/* ---------- 图片压缩（视觉不失真前提下尽量小） ---------- */

async function compressImage(buffer, mime, settings) {
  const blob = new Blob([buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const w = img.naturalWidth;
    const h = img.naturalHeight;

    // 小图直接原样
    if (buffer.byteLength <= 150 * 1024 && Math.max(w, h) <= settings.imageMaxDim) {
      return { bytes: new Uint8Array(buffer), ext: (mime.split('/')[1] || 'png').replace('jpeg', 'jpg') };
    }

    const scale = Math.min(1, settings.imageMaxDim / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, cw, ch);

    const target = settings.imageTargetKB * 1024;
    const qualities = [0.90, 0.87, 0.84, 0.81, 0.78, settings.imageMinQuality];
    for (const q of qualities) {
      const out = await canvasToBytes(canvas, 'image/webp', q);
      if (out && out.byteLength <= target) return { bytes: out, ext: 'webp' };
    }

    // 最低质量仍超目标 → 缩 15%
    const c2 = document.createElement('canvas');
    c2.width = Math.max(1, Math.round(cw * 0.85));
    c2.height = Math.max(1, Math.round(ch * 0.85));
    c2.getContext('2d').drawImage(canvas, 0, 0, c2.width, c2.height);
    const out2 = await canvasToBytes(c2, 'image/webp', settings.imageMinQuality);
    if (out2 && out2.byteLength <= 950 * 1024) return { bytes: out2, ext: 'webp' };

    return { bytes: new Uint8Array(buffer), ext: (mime.split('/')[1] || 'png').replace('jpeg', 'jpg') };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------- 插件主体 ---------- */

class JingzhePublishPlugin extends Plugin {
  async onload() {
    await this.loadPluginData();

    this.addCommand({
      id: 'publish-as-post',
      name: '发布为随笔',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (!checking) this.publishPost(file);
        return true;
      }
    });

    this.addCommand({
      id: 'publish-as-laodao',
      name: '发唠叨（发送选中的文字）',
      editorCheckCallback: (checking, editor) => {
        const text = editor.getSelection();
        if (!text || !text.trim()) return false;
        if (!checking) {
          const file = this.app.workspace.getActiveFile();
          this.publishLaodao(text.trim(), file);
        }
        return true;
      }
    });

    this.addSettingTab(new JingzhePublishSettingTab(this.app, this));
  }

  async loadPluginData() {
    const data = (await this.loadData()) || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
    this.mappings = data.mappings || {};
    this.assetCache = data.assetCache || {};
  }

  async savePluginData() {
    await this.saveData({
      settings: this.settings,
      mappings: this.mappings,
      assetCache: this.assetCache
    });
  }

  /* ---- GitHub ---- */

  headers() {
    return {
      Authorization: 'Bearer ' + this.settings.token,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'obsidian-jingzhe-publish'
    };
  }

  contentsUrl(path) {
    const s = this.settings;
    return (
      'https://api.github.com/repos/' + s.owner + '/' + s.repo + '/contents/' +
      encodePath(path) + '?ref=' + encodeURIComponent(s.branch)
    );
  }

  async githubGet(path) {
    const res = await fetch(this.contentsUrl(path), { headers: this.headers() });
    if (res.status === 404) return null;
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error('读取失败 HTTP ' + res.status + ' ' + body.slice(0, 160));
    }
    return res.json();
  }

  async githubPut(path, contentBase64, message, sha) {
    const s = this.settings;
    if (!sha) {
      const existing = await this.githubGet(path);
      if (existing) sha = existing.sha;
    }
    const payload = {
      message: message,
      content: contentBase64,
      branch: s.branch
    };
    if (sha) payload.sha = sha;

    const res = await fetch(
      'https://api.github.com/repos/' + s.owner + '/' + s.repo + '/contents/' + encodePath(path),
      {
        method: 'PUT',
        headers: Object.assign({ 'Content-Type': 'application/json' }, this.headers()),
        body: JSON.stringify(payload)
      }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error('提交失败 HTTP ' + res.status + ' ' + body.slice(0, 200));
    }
    return res.json();
  }

  /* ---- 图片 ---- */

  resolveImageFile(link, sourceFile) {
    const clean = link.split('#')[0].trim();
    if (!clean) return null;

    const byLink = this.app.metadataCache.getFirstLinkpathDest(clean, sourceFile ? sourceFile.path : '');
    if (byLink instanceof TFile) return byLink;

    const rel = normalizePath(dirnameOf(sourceFile ? sourceFile.path : '') + '/' + clean);
    const byRel = this.app.vault.getAbstractFileByPath(rel);
    if (byRel instanceof TFile) return byRel;

    const byAbs = this.app.vault.getAbstractFileByPath(normalizePath(clean));
    return byAbs instanceof TFile ? byAbs : null;
  }

  async uploadImageFile(file) {
    const s = this.settings;
    const cacheKey = file.path + '@' + file.stat.mtime;
    if (this.assetCache[cacheKey]) return this.assetCache[cacheKey];

    const ext = (file.extension || 'png').toLowerCase();
    const buffer = await this.app.vault.readBinary(file);

    let packed;
    if (ext === 'gif' || ext === 'svg') {
      // 动图/矢量图不压缩，原样上传
      packed = { bytes: new Uint8Array(buffer), ext: ext };
    } else {
      packed = await compressImage(buffer, mimeOfExt(ext), s);
    }

    if (packed.bytes.byteLength > 950 * 1024) {
      throw new Error('图片 ' + file.name + ' 压缩后仍超过 950KB');
    }

    const now = new Date();
    const monthDir = now.getFullYear() + '-' + pad2(now.getMonth() + 1);
    const name = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7) + '.' + packed.ext;
    const repoPath = s.uploadsDir + '/' + monthDir + '/' + name;

    await this.githubPut(repoPath, bytesToBase64(packed.bytes), '上传图片 ' + name);

    const url = s.basePath.replace(/\/$/, '') + '/uploads/' + monthDir + '/' + name;
    this.assetCache[cacheKey] = url;
    await this.savePluginData();
    return url;
  }

  async processImages(content, sourceFile) {
    const found = [];
    content.replace(WIKI_IMG_RE, (raw, link, size) => {
      found.push({ raw: raw, link: link, alt: size && !/^\d+$/.test(size) ? size : '' });
      return raw;
    });
    content.replace(MD_IMG_RE, (raw, alt, link) => {
      found.push({ raw: raw, link: link, alt: alt || '' });
      return raw;
    });
    if (!found.length) return content;

    let out = content;
    for (const item of found) {
      const link = String(item.link || '').trim();
      if (!link) continue;
      if (/^(https?:|data:|mailto:)/i.test(link)) continue;

      const ext = (link.split('.').pop() || '').toLowerCase();
      if (MD_IMAGE_EXT.indexOf(ext) === -1) continue;

      const target = this.resolveImageFile(link, sourceFile);
      if (!target) {
        new Notice('找不到图片：' + link, 5000);
        continue;
      }

      const url = await this.uploadImageFile(target);
      const md = '![' + (item.alt || target.basename) + '](' + url + ')';
      out = out.split(item.raw).join(md);
    }
    return out;
  }

  /* ---- 发布 ---- */

  async publishPost(file) {
    const s = this.settings;
    if (!s.token) {
      new Notice('请先在插件设置里填写 GitHub Token');
      return;
    }
    try {
      new Notice('正在处理…');
      const raw = await this.app.vault.read(file);
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = (cache && cache.frontmatter) || {};
      const body = stripFrontMatter(raw, cache);
      const processedBody = await this.processImages(body, file);

      const title = fm.title || file.basename;
      const slug = normalizeSlug(fm.slug || file.basename);
      const path = s.postsDir + '/' + slug + '.md';

      const mapping = this.mappings[file.path];
      const sameTarget = mapping && mapping.path === path;
      const date = (sameTarget && mapping.date) || fm.date || isoWithOffset(new Date());

      const content =
        buildFrontMatter({
          title: title,
          date: date,
          description: fm.description,
          tags: fm.tags,
          image: fm.image || fm.cover
        }) + '\n' + processedBody.trim() + '\n';

      new Notice('正在提交…');
      const res = await this.githubPut(
        path,
        utf8ToBase64(content),
        '发布文章：' + title,
        sameTarget ? mapping.sha : null
      );

      this.mappings[file.path] = {
        path: path,
        sha: (res.content && res.content.sha) || null,
        date: date
      };
      await this.savePluginData();
      new Notice('已发布《' + title + '》，1–2 分钟后上线', 6000);
    } catch (e) {
      console.error(e);
      new Notice('发布失败：' + e.message, 10000);
    }
  }

  async publishLaodao(text, sourceFile) {
    const s = this.settings;
    if (!s.token) {
      new Notice('请先在插件设置里填写 GitHub Token');
      return;
    }
    try {
      new Notice('正在处理…');
      const processed = await this.processImages(text, sourceFile);
      const now = new Date();
      const y = now.getFullYear();
      const m = pad2(now.getMonth() + 1);
      const d = pad2(now.getDate());
      const path =
        s.laodaoDir + '/' + y + '/' + m + '/' +
        y + m + d + '-' + pad2(now.getHours()) + pad2(now.getMinutes()) + pad2(now.getSeconds()) + '.md';
      const content = '---\ndate: ' + isoWithOffset(now) + '\n---\n\n' + processed.trim() + '\n';

      await this.githubPut(path, utf8ToBase64(content), '发布唠叨', null);
      new Notice('唠叨已发布，1–2 分钟后上线', 5000);
    } catch (e) {
      console.error(e);
      new Notice('发布失败：' + e.message, 10000);
    }
  }
}

/* ---------- 设置页 ---------- */

class JingzhePublishSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Jingzhe Publish' });
    containerEl.createEl('p', {
      text: '把当前笔记发布到惊蛰博客。Token 只保存在本机插件数据里。'
    });

    const text = (label, desc, key, placeholder, isPassword) => {
      new Setting(containerEl)
        .setName(label)
        .setDesc(desc)
        .addText((t) => {
          t.setPlaceholder(placeholder || '');
          t.setValue(s[key] || '');
          if (isPassword) t.inputEl.type = 'password';
          t.onChange(async (v) => {
            s[key] = v.trim();
            await this.plugin.savePluginData();
          });
        });
    };

    const num = (label, desc, key, step) => {
      new Setting(containerEl)
        .setName(label)
        .setDesc(desc)
        .addText((t) => {
          t.setValue(String(s[key]));
          t.inputEl.type = 'number';
          if (step) t.inputEl.step = String(step);
          t.onChange(async (v) => {
            const n = Number(v);
            if (!isNaN(n) && n > 0) {
              s[key] = n;
              await this.plugin.savePluginData();
            }
          });
        });
    };

    text('GitHub Token', '细粒度 token，只需目标仓库 Contents: Read and write', 'token', 'github_pat_...', true);
    text('仓库 owner', '例如 white1213', 'owner', 'white1213');
    text('仓库名', '例如 blog', 'repo', 'blog');
    text('分支', '默认 main', 'branch', 'main');

    containerEl.createEl('h3', { text: '目录' });
    text('文章目录', '默认 content/posts', 'postsDir', 'content/posts');
    text('唠叨目录', '默认 content/laodao', 'laodaoDir', 'content/laodao');
    text('图片上传目录', '默认 static/uploads', 'uploadsDir', 'static/uploads');
    text('站点路径前缀', '图片链接前缀，本站为 /blog/', 'basePath', '/blog/');

    containerEl.createEl('h3', { text: '图片压缩' });
    num('最长边像素', '默认 1400（正文最宽 800px）', 'imageMaxDim', 100);
    num('体积目标 KB', '默认 350', 'imageTargetKB', 50);
    new Setting(containerEl)
      .setName('质量下限')
      .setDesc('默认 0.73，低于此值宁可缩尺寸')
      .addText((t) => {
        t.setValue(String(s.imageMinQuality));
        t.inputEl.type = 'number';
        t.inputEl.step = '0.01';
        t.onChange(async (v) => {
          const n = Number(v);
          if (!isNaN(n) && n > 0.3 && n <= 1) {
            s.imageMinQuality = n;
            await this.plugin.savePluginData();
          }
        });
      });

    containerEl.createEl('h3', { text: '使用' });
    containerEl.createEl('p', {
      text: '命令面板：发布为随笔（发当前笔记）／发唠叨（发选中的文字）。再次发布同一篇笔记会更新原来的博客文章。'
    });
  }
}

JingzhePublishPlugin._internals = {
  normalizeSlug: normalizeSlug,
  isoWithOffset: isoWithOffset,
  buildFrontMatter: buildFrontMatter,
  stripFrontMatter: stripFrontMatter,
  bytesToBase64: bytesToBase64,
  utf8ToBase64: utf8ToBase64,
  encodePath: encodePath,
  dirnameOf: dirnameOf,
  compressImage: compressImage,
  mimeOfExt: mimeOfExt
};

module.exports = JingzhePublishPlugin;
