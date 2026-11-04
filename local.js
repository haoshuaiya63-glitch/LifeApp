/* =====================================================
   local.js —— Cordova 本地缓存模块
   依赖：cordova-plugin-file
   提供：
     LocalCache.readJSON / writeJSON / readText / writeText
     LocalCache.trimImages(maxBytes)   清理最旧的图片缓存
     LocalCache.clearAll()             清空全部缓存
     cacheImage(url)                   返回本地 URL（未缓存则下载并保存）
     setCachedSrc(imgEl, url)          给单个 <img> 设置缓存图
     applyCachedImages(root)           处理 root 下所有 img[data-cache-src]
   页面里只要写 <img data-cache-src="http://..."> ，会被自动替换为本地图片
   ===================================================== */
(function (global) {
    'use strict';

    // 缓存目录版本号：以后数据结构变了，改成 v2 即等于清空旧缓存
    const BASE = 'cache/v1/';
    const IMG_DIR = 'img/';

    let rootDir = null;
    const blobUrlCache = new Map();   // path -> blob:URL（避免重复创建）
    const inflight = new Map();       // path -> Promise（避免重复下载）
    const writeQueues = new Map();    // path -> Promise（同一文件串行写入）

    /* ---------- 初始化：等待 cordova 文件系统就绪 ---------- */
    const ready = new Promise(resolve => {
        // 浏览器调试环境（没有 cordova）：直接降级为 localStorage
        if (!global.cordova) return resolve(null);

        let done = false;
        const finish = (dir) => { if (!done) { done = true; resolve(dir); } };

        const tryInit = () => {
            if (done) return true;
            if (global.cordova && cordova.file && cordova.file.dataDirectory &&
                global.resolveLocalFileSystemURL) {
                global.resolveLocalFileSystemURL(
                    cordova.file.dataDirectory,
                    dir => { rootDir = dir; finish(dir); },
                    () => finish(null)
                );
                return true;
            }
            return false;
        };

        document.addEventListener('deviceready', tryInit, false);

        // 兜底轮询（本脚本可能在 deviceready 之后才加载）
        let tries = 0;
        const timer = setInterval(() => {
            tries++;
            if (tryInit() || done) { clearInterval(timer); return; }
            if (tries > 50) { clearInterval(timer); finish(null); }   // 5 秒放弃
        }, 100);
    });

    /* ---------- 目录 / 文件 entry 工具 ---------- */
    function getDir(path, create) {
        return new Promise((resolve, reject) => {
            const parts = path.split('/').filter(Boolean);
            const walk = (dir, i) => {
                if (i >= parts.length) return resolve(dir);
                dir.getDirectory(parts[i], { create }, d => walk(d, i + 1), reject);
            };
            walk(rootDir, 0);
        });
    }

    async function getFileEntry(path, create) {
        const idx = path.lastIndexOf('/');
        const dirPath = idx >= 0 ? path.slice(0, idx) : '';
        const name = idx >= 0 ? path.slice(idx + 1) : path;
        const dir = await getDir(dirPath, create);
        return new Promise((resolve, reject) => {
            dir.getFile(name, { create }, resolve, reject);
        });
    }

    function readAllEntries(dir) {
        return new Promise((resolve, reject) => {
            const reader = dir.createReader();
            const out = [];
            const next = () => reader.readEntries(es => {
                if (!es.length) return resolve(out);
                out.push(...es);
                next();
            }, reject);
            next();
        });
    }

    // 同一路径的写入排队，避免并发写坏文件
    function enqueue(path, task) {
        const prev = writeQueues.get(path) || Promise.resolve();
        const next = prev.catch(() => {}).then(task);
        writeQueues.set(path, next);
        next.finally(() => { if (writeQueues.get(path) === next) writeQueues.delete(path); }).catch(() => {});
        return next;
    }

    /* ---------- 文本 / JSON ---------- */
    async function readText(rel) {
        await ready;
        const path = BASE + rel;
        if (!rootDir) {
            try { return localStorage.getItem('lc_' + path); } catch (e) { return null; }
        }
        try {
            const entry = await getFileEntry(path, false);
            return await new Promise((resolve, reject) => {
                entry.file(f => {
                    const r = new FileReader();
                    r.onloadend = () => resolve(r.result);
                    r.onerror = reject;
                    r.readAsText(f);
                }, reject);
            });
        } catch (e) {
            return null;   // 文件不存在
        }
    }

    async function writeText(rel, text) {
        await ready;
        const path = BASE + rel;
        if (!rootDir) {
            try { localStorage.setItem('lc_' + path, text); } catch (e) {}
            return true;
        }
        return enqueue(path, async () => {
            const entry = await getFileEntry(path, true);
            return new Promise((resolve, reject) => {
                entry.createWriter(w => {
                    let truncated = false;
                    w.onerror = reject;
                    w.onwriteend = () => {
                        if (truncated) return;
                        truncated = true;
                        w.onwriteend = () => resolve(true);
                        w.write(new Blob([text], { type: 'text/plain' }));
                    };
                    w.truncate(0);     // 先清空，避免旧内容残留
                }, reject);
            });
        });
    }

    async function readJSON(rel) {
        const t = await readText(rel);
        if (!t) return null;
        try { return JSON.parse(t); } catch (e) { return null; }
    }

    function writeJSON(rel, obj) {
        try { return writeText(rel, JSON.stringify(obj)); }
        catch (e) { return Promise.resolve(false); }
    }

    /* ---------- 二进制（图片）：先写临时文件再改名，防止写一半被杀进程 ---------- */
    async function writeBlob(rel, blob) {
        await ready;
        if (!rootDir) return false;
        const path = BASE + rel;
        return enqueue(path, async () => {
            const tmpPath = path + '.tmp';
            const tmpEntry = await getFileEntry(tmpPath, true);
            await new Promise((resolve, reject) => {
                tmpEntry.createWriter(w => {
                    w.onwriteend = () => resolve();
                    w.onerror = reject;
                    w.write(blob);
                }, reject);
            });
            const idx = path.lastIndexOf('/');
            const finalName = path.slice(idx + 1);
            await new Promise((resolve, reject) => {
                tmpEntry.getParent(parent => {
                    tmpEntry.moveTo(parent, finalName, resolve, reject);
                }, reject);
            });
            return true;
        });
    }

    // 读本地图片 → blob:URL（比 file:// / cdvfile:// 在新版 WebView 上更稳）
    async function getLocalUrl(rel) {
        await ready;
        if (!rootDir) return null;
        const path = BASE + rel;
        if (blobUrlCache.has(path)) return blobUrlCache.get(path);
        try {
            const entry = await getFileEntry(path, false);
            const buf = await new Promise((resolve, reject) => {
                entry.file(f => {
                    if (!f.size) return reject(new Error('empty'));
                    const r = new FileReader();
                    r.onloadend = () => resolve(r.result);
                    r.onerror = reject;
                    r.readAsArrayBuffer(f);
                }, reject);
            });
            const url = URL.createObjectURL(new Blob([buf]));
            blobUrlCache.set(path, url);
            return url;
        } catch (e) {
            return null;
        }
    }

    /* ---------- 缓存体积控制 ---------- */
    async function trimImages(maxBytes) {
        maxBytes = maxBytes || 300 * 1024 * 1024;
        await ready;
        if (!rootDir) return;
        let dir;
        try { dir = await getDir(BASE + IMG_DIR, false); } catch (e) { return; }
        const entries = (await readAllEntries(dir)).filter(e => e.isFile);
        const infos = (await Promise.all(entries.map(e => new Promise(res => {
            e.file(f => res({ e, size: f.size, t: f.lastModified }), () => res(null));
        })))).filter(Boolean);

        let total = infos.reduce((s, i) => s + i.size, 0);
        if (total <= maxBytes) return;

        infos.sort((a, b) => a.t - b.t);           // 最旧的先删
        for (const info of infos) {
            if (total <= maxBytes * 0.8) break;    // 删到 80% 为止
            await new Promise(res => info.e.remove(res, res));
            total -= info.size;
        }
        blobUrlCache.clear();
    }

    async function clearAll() {
        await ready;
        if (!rootDir) {
            try {
                Object.keys(localStorage).filter(k => k.startsWith('lc_')).forEach(k => localStorage.removeItem(k));
            } catch (e) {}
            return;
        }
        try {
            const dir = await getDir(BASE, false);
            await new Promise(res => dir.removeRecursively(res, res));
        } catch (e) {}
        blobUrlCache.clear();
    }

    global.LocalCache = { ready, readJSON, writeJSON, readText, writeText, writeBlob, getLocalUrl, trimImages, clearAll };

    /* =====================================================
       图片缓存
       ===================================================== */
    function hash53(str) {
        let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
        for (let i = 0; i < str.length; i++) {
            const ch = str.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
    }

    function imgPath(url) {
        const clean = url.split('?')[0].split('#')[0];
        const m = clean.match(/\.([a-zA-Z0-9]{2,4})$/);
        return IMG_DIR + hash53(url) + '.' + (m ? m[1].toLowerCase() : 'bin');
    }

    /**
     * 返回可直接给 <img src> 的地址：
     *  - 本地已有 → blob:URL
     *  - 本地没有 → 下载一次，同时存本地，并返回 blob:URL
     *  - 下载失败 / 非 cordova 环境 → 返回原始远程地址
     */
    async function cacheImage(remoteUrl) {
        if (!remoteUrl || !/^https?:\/\//i.test(remoteUrl)) return remoteUrl;
        await ready;
        if (!rootDir) return remoteUrl;

        const rel = imgPath(remoteUrl);
        const local = await getLocalUrl(rel);
        if (local) return local;

        if (inflight.has(rel)) return inflight.get(rel);

        const p = (async () => {
            try {
                const resp = await fetch(remoteUrl);
                if (!resp.ok) throw new Error('http ' + resp.status);
                const blob = await resp.blob();
                if (!blob.size) throw new Error('empty');
                writeBlob(rel, blob).catch(() => {});          // 后台落盘
                const url = URL.createObjectURL(blob);
                blobUrlCache.set(BASE + rel, url);
                return url;
            } catch (e) {
                return remoteUrl;                              // 失败就直接用远程地址
            } finally {
                inflight.delete(rel);
            }
        })();
        inflight.set(rel, p);
        return p;
    }

    function setCachedSrc(img, remoteUrl) {
        if (!img) return;
        if (!remoteUrl) { img.removeAttribute('src'); return; }
        cacheImage(remoteUrl).then(u => { img.src = u; });
    }

    function applyCachedImages(root) {
        root = root || document;
        root.querySelectorAll('img[data-cache-src]').forEach(img => {
            const remote = img.dataset.cacheSrc;
            img.removeAttribute('data-cache-src');             // 先移除，避免重复处理
            if (remote) setCachedSrc(img, remote);
        });
    }

    global.cacheImage = cacheImage;
    global.setCachedSrc = setCachedSrc;
    global.applyCachedImages = applyCachedImages;

    /* 自动监听：任何新插入的 img[data-cache-src] 都会被处理，不需要手动调用 */
    function startObserver() {
        let scheduled = false;
        const schedule = () => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => { scheduled = false; applyCachedImages(document); });
        };
        new MutationObserver(schedule).observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['data-cache-src']
        });
        schedule();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startObserver);
    } else {
        startObserver();
    }
})(window);
