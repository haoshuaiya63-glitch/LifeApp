/* =====================================================
   app.js —— 主脚本（已接入 local.js 的本地缓存）
   依赖：cordova.js、local.js 必须先加载
   ===================================================== */

/* ===== 常量 ===== */
const MUSIC_API = 'http://43.167.237.62:3600';
const API_BASE = 'http://43.167.237.62:8000';
const ZC_API = 'http://43.167.237.62:3800';

/* ===== 带超时的 fetch（外部服务挂了不拖死首页） ===== */
function fetchTimeout(url, opts = {}, ms = 5000) {
    return new Promise((resolve, reject) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => {
            ctrl.abort();
            reject(new Error('timeout'));
        }, ms);
        fetch(url, { ...opts, signal: ctrl.signal })
            .then(res => { clearTimeout(timer); resolve(res); })
            .catch(err => { clearTimeout(timer); reject(err); });
    });
}

/* ===== 音乐播放器系统 ===== */
let musicList = [];
let musicIndex = 0;
let musicPlaying = false;
let musicLoaded = false;
let musicBarVisible = false;

const audioEl      = document.getElementById('bgMusic');
const musicBar     = document.getElementById('musicBar');
const musicCover   = document.getElementById('musicCover');
const musicTitle   = document.getElementById('musicTitle');
const musicArtist  = document.getElementById('musicArtist');
const musicPlayBtn = document.getElementById('musicPlayBtn');
const musicProgress= document.getElementById('musicProgress');

let avatarClickTimer = null;
const accountAvatarEl = document.getElementById('accountAvatar');

accountAvatarEl.addEventListener('click', function(e) {
    e.stopImmediatePropagation();

    if (avatarClickTimer) {
        clearTimeout(avatarClickTimer);
        avatarClickTimer = null;
        handleAvatarDoubleClick();
    } else {
        avatarClickTimer = setTimeout(() => {
            avatarClickTimer = null;
            loginWithSwipe();
        }, 280);
    }
}, true);

function handleAvatarDoubleClick() {
    const el = document.getElementById('accountAvatar');
    el.classList.add('spinning');
    setTimeout(() => el.classList.remove('spinning'), 650);

    if (!musicLoaded) {
        loadMusicList().then(() => {
            musicBarVisible ? hideMusicBar() : showMusicBar();
        });
    } else {
        musicBarVisible ? hideMusicBar() : showMusicBar();
    }
}

async function loadMusicList() {
    try {
        const res = await fetch(`${MUSIC_API}/music/list`);
        const data = await res.json();
        if (data.success && data.data.length) {
            musicList = data.data;
            musicLoaded = true;
            const saved = localStorage.getItem('music_index');
            if (saved !== null && parseInt(saved) < musicList.length) {
                musicIndex = parseInt(saved);
            }
            applyCurrentTrack();
        } else {
            musicTitle.textContent = '暂无歌曲';
            musicArtist.textContent = '去后台添加吧～';
        }
    } catch(e) {
        musicTitle.textContent = '连接失败';
        musicArtist.textContent = '检查3600端口';
    }
}

function applyCurrentTrack() {
    if (!musicList.length) return;
    const track = musicList[musicIndex];
    musicTitle.textContent  = track.title  || '未知曲目';
    musicArtist.textContent = track.artist || '未知艺术家';
    audioEl.src = `${MUSIC_API}${track.url}`;
    audioEl.load();
    if (track.cover_url) {
        musicCover.style.backgroundImage = `url(${MUSIC_API}${track.cover_url})`;
        musicCover.style.backgroundSize  = 'cover';
        musicCover.innerHTML = '';
    } else {
        musicCover.style.backgroundImage = '';
        musicCover.innerHTML = '🎵';
    }
    musicProgress.style.width = '0%';
    localStorage.setItem('music_index', musicIndex);
}

function musicToggle() {
    if (!musicList.length) return;
    if (musicPlaying) {
        audioEl.pause();
        musicPlaying = false;
        musicPlayBtn.textContent = '▶️';
        musicCover.classList.remove('rotating');
    } else {
        audioEl.play().then(() => {
            musicPlaying = true;
            musicPlayBtn.textContent = '⏸️';
            musicCover.classList.add('rotating');
        }).catch(() => {
            showStickerToast('点击播放按钮开始 🎵');
        });
    }
}

function musicNext() {
    musicIndex = (musicIndex + 1) % musicList.length;
    applyCurrentTrack();
    if (musicPlaying) {
        audioEl.play().catch(() => {});
    }
}

function musicPrev() {
    musicIndex = (musicIndex - 1 + musicList.length) % musicList.length;
    applyCurrentTrack();
    if (musicPlaying) {
        audioEl.play().catch(() => {});
    }
}

function showMusicBar() {
    musicBar.classList.add('show');
    musicBarVisible = true;
    if (!musicLoaded) return;
    if (!musicPlaying) musicToggle();
}

function hideMusicBar() {
    musicBar.classList.remove('show');
    musicBarVisible = false;
}

audioEl.addEventListener('timeupdate', () => {
    if (!audioEl.duration) return;
    const pct = (audioEl.currentTime / audioEl.duration) * 100;
    musicProgress.style.width = pct + '%';
});

audioEl.addEventListener('ended', () => {
    musicNext();
    if (musicPlaying) audioEl.play().catch(() => {});
});

audioEl.addEventListener('play',  () => {
    musicPlaying = true;
    musicPlayBtn.textContent = '⏸️';
    musicCover.classList.add('rotating');
});
audioEl.addEventListener('pause', () => {
    musicPlaying = false;
    musicPlayBtn.textContent = '▶️';
    musicCover.classList.remove('rotating');
});

/* ===== 随机抽取系统 ===== */
let rpAllMedia = [];
let rpCurrentIdx = 0;
let rpResultIdx = 0;
let rpSpinning = false;
let rpResultId = null;

async function showRandomPicker() {
  hidePetMenu?.();
  document.getElementById('randomPickerModal').style.display = 'flex';
  document.getElementById('rpHint').textContent = '正在加载记录…';
  document.getElementById('rpSpinBtn').disabled = true;
  document.getElementById('rpEnterBtn').style.display = 'none';
  document.getElementById('rpStrip').innerHTML = '';

  try {
    const firstRes = await fetch(`${API_BASE}/media?page=1&limit=1`);
    const firstData = await firstRes.json();
    if (!firstData.success || !firstData.total_items) {
      document.getElementById('rpHint').textContent = '还没有记录哦，快去上传吧～';
      return;
    }

    const total = firstData.total_items;
    const GROUP_SIZE = 50;
    const totalGroups = Math.ceil(total / GROUP_SIZE);

    const randomGroup = Math.floor(Math.random() * totalGroups);
    const targetPage = totalGroups - randomGroup;

    const res = await fetch(`${API_BASE}/media?page=${targetPage}&limit=${GROUP_SIZE}`);
    const data = await res.json();
    rpAllMedia = data.success && data.data ? data.data : [];

    if (!rpAllMedia.length) {
      document.getElementById('rpHint').textContent = '加载失败，请重试';
      return;
    }

    buildRpStrip();
    document.getElementById('rpSpinBtn').disabled = false;
    document.getElementById('rpHint').textContent = `点击「开始抽取」随机选一条`;

  } catch (e) {
    document.getElementById('rpHint').textContent = '加载失败，请稍后重试';
  }
}

function buildRpStrip() {
  const strip = document.getElementById('rpStrip');
  strip.innerHTML = '';
  rpAllMedia.forEach((item) => {
    const slide = document.createElement('div');
    slide.style.cssText = `
      height:200px;
      display:flex;
      align-items:center;
      justify-content:center;
      position:relative;
      overflow:hidden;
      border-radius:14px;
    `;
    let inner = '';
    if (item.type === 'video') {
      const poster = item.thumbnail ? API_BASE + item.thumbnail : './mr.jpg';
      inner = `
        <img src="${poster}"
          style="width:100%;height:100%;object-fit:cover;border-radius:14px"
          onerror="this.src='./mr.jpg'">
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">
          <div style="background:rgba(255,105,180,0.82);color:#fff;border-radius:50%;width:48px;height:48px;display:flex;align-items:center;justify-content:center;font-size:20px">▶</div>
        </div>
      `;
    } else {
      inner = `
        <img src="${API_BASE + item.url}"
          style="width:100%;height:100%;object-fit:cover;border-radius:14px"
          onerror="this.src='./mr.jpg'">
      `;
    }
    const desc = item.description
      ? (item.description.length > 20 ? item.description.slice(0, 20) + '…' : item.description)
      : '';
    inner += `
      <div style="position:absolute;bottom:0;left:0;right:0;
        background:linear-gradient(transparent,rgba(0,0,0,0.5));
        padding:20px 10px 8px;border-radius:0 0 14px 14px;
        color:#fff;font-size:12px;text-align:left">
        ${desc}
      </div>
    `;
    slide.innerHTML = inner;
    strip.appendChild(slide);
  });
  rpGoTo(0, true);
}

function rpGoTo(idx, instant) {
  const strip = document.getElementById('rpStrip');
  strip.style.transition = instant ? 'none' : 'transform 0.07s linear';
  strip.style.transform = `translateY(-${idx * 200}px)`;
  rpCurrentIdx = idx;
}

function doRandomSpin() {
  if (rpSpinning || !rpAllMedia.length) return;
  rpSpinning = true;
  if (navigator.vibrate) navigator.vibrate(60);

  document.getElementById('rpSpinBtn').disabled = true;
  document.getElementById('rpEnterBtn').style.display = 'none';
  document.getElementById('rpShimmer').style.display = 'block';
  document.getElementById('rpHint').textContent = '抽取中…✨';

  const total = rpAllMedia.length;
  rpResultIdx = Math.floor(Math.random() * total);
  rpResultId = rpAllMedia[rpResultIdx].id;

  const totalSteps = 28 + Math.floor(Math.random() * 18);
  let count = 0;
  let delay = 55;

  function step() {
    const next = (rpCurrentIdx + 1) % total;
    rpGoTo(next, true);
    count++;
    if (count >= totalSteps) {
      rpGoTo(rpResultIdx, true);
      rpDone();
    } else {
      if (count > totalSteps * 0.6) delay = Math.min(delay + 20, 280);
      setTimeout(step, delay);
    }
  }
  setTimeout(step, delay);
}

function rpDone() {
  rpSpinning = false;
  document.getElementById('rpShimmer').style.display = 'none';
  document.getElementById('rpSpinBtn').disabled = false;
  document.getElementById('rpSpinBtn').textContent = '再抽一次';
  document.getElementById('rpEnterBtn').style.display = 'block';

  const item = rpAllMedia[rpResultIdx];
  const typeStr = item.type === 'video' ? '视频' : '图片';
  document.getElementById('rpHint').textContent = `✨ 抽到了一条${typeStr}！`;

  spawnHearts(20);
  if (navigator.vibrate) navigator.vibrate([80, 40, 120]);
}

const _origSpinBtn = document.getElementById('rpSpinBtn');
if (_origSpinBtn) {
  _origSpinBtn.addEventListener('click', async function () {
    if (this.textContent.includes('再抽')) {
      await showRandomPicker();
      setTimeout(doRandomSpin, 300);
    }
  });
}

function enterRandomResult() {
  if (!rpResultId) return;
  const idToShow = rpResultId;
  hideRandomPicker();
  if (document.getElementById('mainPage').style.display !== 'block') {
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('mainPage').style.display = 'block';
  }
  showDetail(idToShow);
}

function spawnHearts(count = 28) {
  for (let i = 0; i < count; i++) {
    const heart = document.createElement('div');
    heart.className = 'heart';
    heart.innerText = '⭐';
    const x = (Math.random() - 0.5) * 2;
    heart.style.setProperty('--x', x);
    heart.style.fontSize = (14 + Math.random() * 20) + 'px';
    document.body.appendChild(heart);
    setTimeout(() => heart.remove(), 1200);
  }
}

function hideRandomPicker() {
  document.getElementById('randomPickerModal').style.display = 'none';
  document.getElementById('rpSpinBtn').textContent = '🎲 开始抽取';
  document.getElementById('rpEnterBtn').style.display = 'none';
  document.getElementById('rpHint').textContent = '点击「开始抽取」随机选一条';
  rpAllMedia = [];
  rpResultId = null;
}

/* ===== 全局状态 ===== */
let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
let touchEndY = 0;
const minSwipeDistance = 50;
let isSearchMode = false;
let searchQuery = '';

/* ==========================================================
   地图 iframe 控制
   ========================================================== */
function openPostMap(post) {
    const lat = parseFloat(post.lat);
    const lng = parseFloat(post.lng);
    if (!lat || !lng) {
        showStickerToast('这条记录没有位置信息哦');
        return;
    }

    const wrap  = document.getElementById('mapFrameWrap');
    const frame = document.getElementById('mapFrame');
    if (!wrap || !frame) {
        showStickerToast('地图容器未找到');
        return;
    }

    wrap.style.display = 'block';

    const basePayload = {
        lng, lat,
        address:      post.location || '帖子位置',
        authorName:   post.uploader_name   || 'TA',
        authorAvatar: post.uploader_avatar
            ? (post.uploader_avatar.startsWith('/') ? API_BASE + post.uploader_avatar : post.uploader_avatar)
            : '',
        myName:       myProfile.nickname   || '我',
        myAvatar:     myProfile.avatar_url
            ? (myProfile.avatar_url.startsWith('/') ? API_BASE + myProfile.avatar_url : myProfile.avatar_url)
            : ''
    };

    const send = (myLng, myLat) => {
        const payload = Object.assign({}, basePayload);
        if (myLng != null && myLat != null) {
            payload.myLng = myLng;
            payload.myLat = myLat;
        }
        try {
            frame.contentWindow.postMessage({ type: 'openLoveMap', payload }, '*');
        } catch (e) { console.warn('postMessage 失败', e); }
    };

    const afterFrameReady = () => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    send(pos.coords.longitude, pos.coords.latitude);
                },
                (err) => {
                    console.warn('父页面定位失败:', err.message || err.code);
                    send();
                },
                { enableHighAccuracy: true, timeout: 9000, maximumAge: 60000 }
            );
        } else {
            send();
        }
    };

    if (frame.dataset.loaded === '1') {
        afterFrameReady();
    } else {
        frame.onload = () => {
            frame.dataset.loaded = '1';
            afterFrameReady();
        };
        setTimeout(() => {
            if (!frame.dataset.loaded) {
                frame.dataset.loaded = '1';
                afterFrameReady();
            }
        }, 800);
    }
}
function closeMapFrame() {
    const wrap = document.getElementById('mapFrameWrap');
    if (wrap) wrap.style.display = 'none';
}

window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'closeMap') {
        closeMapFrame();
    }
});

/* ========== 定位 ========== */
function getCurrentLocation() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            console.warn('当前环境不支持定位');
            return resolve(null);
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({
                lat: pos.coords.latitude.toFixed(6),
                lon: pos.coords.longitude.toFixed(6),
            }),
            (err) => {
                console.warn('定位失败:', err.message || err.code);
                resolve(null);
            },
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 10 * 60 * 1000 }
        );
    });
}

/* ==================================================
   语音录制
   ================================================== */
let pendingVoiceUrl = null;
let pendingVoiceDuration = 0;

let voiceRecording  = false;
let voiceStartTime  = 0;
let voiceTimer      = null;
let voiceLongPressTimer = null;

let voiceMedia      = null;
let voiceMediaPath  = '';

let voiceRecorder   = null;
let voiceChunks     = [];

function setupVoiceLongPress() {
    const input = document.getElementById('commentInput');
    if (!input || input.dataset.voiceBound) return;
    input.dataset.voiceBound = '1';

    input.addEventListener('contextmenu', e => e.preventDefault());

    input.addEventListener('touchstart',  onVoiceStart, { passive: true });
    input.addEventListener('touchend',    onVoiceEnd,   { passive: true });
    input.addEventListener('touchcancel', onVoiceEnd,   { passive: true });

    input.addEventListener('mousedown', onVoiceStart);
    document.addEventListener('mouseup', onVoiceEnd);
}

function onVoiceStart() {
    if (voiceRecording) return;
    const input = document.getElementById('commentInput');
    if (input && input.value.trim()) return;

    clearTimeout(voiceLongPressTimer);
    voiceLongPressTimer = setTimeout(startVoiceRecord, 500);
}

function onVoiceEnd() {
    clearTimeout(voiceLongPressTimer);
    if (voiceRecording) stopVoiceRecord();
}

async function startVoiceRecord() {
    try { window.getSelection()?.removeAllRanges(); } catch (e) {}
    try { document.activeElement?.blur(); } catch (e) {}

    if (window.cordova && window.Media) {
        startVoiceRecordCordova();
        return;
    }

    if (navigator.mediaDevices && window.MediaRecorder) {
        await startVoiceRecordWeb();
        return;
    }

    if (!window.isSecureContext) {
        showStickerToast('当前页面不是安全上下文，无法录音。请用 localhost 或 https 访问');
    } else {
        showStickerToast('当前浏览器不支持录音');
    }
}

function stopVoiceRecord() {
    voiceRecording = false;
    stopVoiceTimer();

    if (window.cordova && voiceMedia) {
        stopVoiceRecordCordova();
    } else if (voiceRecorder) {
        stopVoiceRecordWeb();
    } else {
        stopVoiceOverlayUI();
    }
}

async function startVoiceRecordWeb() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        voiceChunks = [];
        const mr = new MediaRecorder(stream);
        voiceRecorder = mr;

        mr.ondataavailable = (e) => { if (e.data.size > 0) voiceChunks.push(e.data); };
        mr.onstop = () => {
            stream.getTracks().forEach(t => t.stop());
            const blob = new Blob(voiceChunks, { type: 'audio/webm' });
            voiceChunks = [];
            if (blob.size < 800) {
                showStickerToast('录音太短啦');
                stopVoiceOverlayUI();
                return;
            }
            uploadVoiceBlob(blob, 'rec.webm');
        };
        mr.start();

        voiceRecording = true;
        voiceStartTime = Date.now();
        startVoiceTimer();
        showVoiceOverlay(true);
    } catch (e) {
        console.error(e);
        if (e.name === 'NotAllowedError') {
            showStickerToast('麦克风权限被拒绝，请在地址栏左侧允许');
        } else if (e.name === 'NotFoundError') {
            showStickerToast('没有找到麦克风设备');
        } else {
            showStickerToast('录音启动失败: ' + e.message);
        }
        stopVoiceOverlayUI();
    }
}

function stopVoiceRecordWeb() {
    if (voiceRecorder && voiceRecorder.state !== 'inactive') {
        voiceRecorder.stop();
    }
    voiceRecorder = null;
}

function startVoiceRecordCordova() {
    try {
        const fname = 'rec_' + Date.now() + '.m4a';
        const dir = (cordova.file && (cordova.file.cacheDirectory || cordova.file.tempDirectory)) || '';
        voiceMediaPath = dir ? (dir + fname) : fname;

        voiceMedia = new Media(voiceMediaPath,
            () => {},
            (err) => {
                console.error('Media err', err);
                showStickerToast('录音失败');
                stopVoiceOverlayUI();
            }
        );
        voiceMedia.startRecord();

        voiceRecording = true;
        voiceStartTime = Date.now();
        startVoiceTimer();
        showVoiceOverlay(true);
    } catch (e) {
        console.error(e);
        showStickerToast('录音启动失败');
        stopVoiceOverlayUI();
    }
}

function stopVoiceRecordCordova() {
    if (!voiceMedia) { stopVoiceOverlayUI(); return; }
    const path = voiceMediaPath;
    try { voiceMedia.stopRecord(); } catch (e) {}
    try { voiceMedia.release(); } catch (e) {}
    voiceMedia = null;

    window.resolveLocalFileSystemURL(path, (entry) => {
        entry.file((file) => {
            const reader = new FileReader();
            reader.onloadend = function () {
                const blob = new Blob([new Uint8Array(this.result)], { type: 'audio/m4a' });
                uploadVoiceBlob(blob, 'rec.m4a');
            };
            reader.readAsArrayBuffer(file);
        }, (e) => {
            console.error('read file', e);
            showStickerToast('读取录音失败');
            stopVoiceOverlayUI();
        });
    }, (e) => {
        console.error('resolve', e);
        showStickerToast('读取录音失败');
        stopVoiceOverlayUI();
    });
}

async function uploadVoiceBlob(blob, filename) {
    const duration = Math.max(1, Math.round((Date.now() - voiceStartTime) / 1000));
    const fd = new FormData();
    fd.append('file', blob, filename);
    fd.append('device_id', DEVICE_ID);
    fd.append('duration', String(duration));

    try {
        const res = await fetch(`${API_BASE}/voice/upload`, { method: 'POST', body: fd });
        const data = await res.json();
        if (data.success) {
            pendingVoiceUrl = data.url;
            pendingVoiceDuration = data.duration || duration;
            document.getElementById('voicePreviewAudio').src = API_BASE + pendingVoiceUrl;
            document.getElementById('voicePreviewBar').style.display = 'flex';
            showStickerToast('语音已就绪，可发表评论 🎤');
        } else {
            showStickerToast(data.message || '语音上传失败');
        }
    } catch (e) {
        console.error(e);
        showStickerToast('语音上传失败');
    } finally {
        stopVoiceOverlayUI();
    }
}

function clearPendingVoice() {
    pendingVoiceUrl = null;
    pendingVoiceDuration = 0;
    document.getElementById('voicePreviewBar').style.display = 'none';
    const a = document.getElementById('voicePreviewAudio');
    if (a) a.src = '';
}

function showVoiceOverlay(show) {
    let el = document.getElementById('voiceOverlay');
    if (!el) {
        el = document.createElement('div');
        el.id = 'voiceOverlay';
        el.className = 'voice-overlay';
        el.innerHTML = `
            <div class="voice-overlay-card">
                <div class="voice-mic">🎤</div>
                <div class="voice-wave">
                    <i></i><i></i><i></i><i></i><i></i><i></i><i></i>
                </div>
                <div class="voice-time" id="voiceTime">0.0"</div>
                <div class="voice-hint">松开发送 · 最长 60 秒</div>
            </div>`;
        document.body.appendChild(el);
    }
    el.classList.toggle('show', !!show);
    if (show) {
        const t = document.getElementById('voiceTime');
        if (t) t.textContent = '0.0"';
    }
}

function startVoiceTimer() {
    stopVoiceTimer();
    voiceTimer = setInterval(() => {
        if (!voiceStartTime) return;
        const sec = (Date.now() - voiceStartTime) / 1000;
        const t = document.getElementById('voiceTime');
        if (t) t.textContent = sec.toFixed(1) + '"';
        if (sec >= 60) stopVoiceRecord();
    }, 100);
}
function stopVoiceTimer() {
    if (voiceTimer) { clearInterval(voiceTimer); voiceTimer = null; }
}
function stopVoiceOverlayUI() {
    voiceRecording = false;
    voiceStartTime = 0;
    stopVoiceTimer();
    showVoiceOverlay(false);
}

/* ===== 登录页打字机效果 ===== */
const text = "MuMu and DaZi";
const loveTextEl = document.getElementById("loveText");
let index = 0;

function typeWriter() {
    if (index <= text.length) {
        loveTextEl.textContent = text.slice(0, index);
        index++;
        setTimeout(typeWriter, 200);
    } else {
        startLetterBounce();
    }
}

function startLetterBounce() {
    loveTextEl.style.borderRight = "none";
    loveTextEl.innerHTML = text.split('').map((ch, i) => {
        const displayCh = ch === ' ' ? '&nbsp;' : ch;
        return `<span class="love-letter" style="animation-delay:${i * 0.08}s">${displayCh}</span>`;
    }).join('');
}

typeWriter();

/* ==================================
桌宠系统 V3.0
================================== */
const pet = document.getElementById("pet");
const menu = document.getElementById("petMenu");
const PET_MENU_R = 105;

function hidePetMenu() {
    menu.style.display = "none";
}

function setupPetMenu() {
    const btns = menu.querySelectorAll('button');
    const n = btns.length;
    btns.forEach((b, i) => {
        const a = -Math.PI / 2 + i * 2 * Math.PI / n;
        b.style.setProperty('--tx', Math.cos(a) * PET_MENU_R + 'px');
        b.style.setProperty('--ty', Math.sin(a) * PET_MENU_R + 'px');
        b.style.setProperty('--i', i);
    });
}
setupPetMenu();

function togglePetMenu() {
    if (menu.style.display === 'block') {
        menu.style.display = 'none';
        return;
    }
    const m = PET_MENU_R + 40;
    const cx = Math.max(m, Math.min(px + PET_SIZE / 2, window.innerWidth - m));
    const cy = Math.max(m, Math.min(py + PET_SIZE / 2, window.innerHeight - m));
    menu.style.left = cx + 'px';
    menu.style.top = cy + 'px';
    menu.style.display = 'block';
}

let petGifs     = ['1.gif', '2.gif', '3.gif'];
let petGifIdx   = 0;
let petGifTimer = null;
let zcModeOn    = false;

function startPetLoop(gifs) {
    if (petGifTimer) clearInterval(petGifTimer);
    petGifs   = (gifs && gifs.length) ? gifs : ['1.gif', '2.gif', '3.gif'];
    petGifIdx = 0;
    const el = document.getElementById('petGif');
    if (el) el.src = petGifs[0];
    if (petGifs.length > 1) {
        petGifTimer = setInterval(() => {
            petGifIdx = (petGifIdx + 1) % petGifs.length;
            const el = document.getElementById('petGif');
            if (el) el.src = petGifs[petGifIdx];
        }, 3000);
    }
}

startPetLoop(['1.gif', '2.gif', '3.gif']);

async function loadZcGifs() {
    try {
        const r = await fetchTimeout(`${ZC_API}/pet/zc/gifs`, {}, 4000);
        const d = await r.json();

        if (d.success && d.data && d.data.length) {
            const activeCategory = d.active_category || '全部';
            let filtered = d.data.filter(item => item.enabled);
            if (activeCategory !== '全部') {
                filtered = filtered.filter(item => item.category === activeCategory);
            }
            if (filtered.length) {
                startPetLoop(filtered.map(item => item.url));
                return true;
            }
        }
    } catch (e) { }
    return false;
}
async function toggleZcMode() {
    hidePetMenu();
    zcModeOn = !zcModeOn;

    fetchTimeout(`${ZC_API}/pet/zc/pref`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: DEVICE_ID, enabled: zcModeOn })
    }, 4000).catch(() => {});

    if (zcModeOn) {
        const ok = await loadZcGifs();
        showStickerToast(ok ? '🐾 已切换到 zc 形象' : '⚠️ 加载失败，保持当前形象');
        if (!ok) zcModeOn = false;
    } else {
        startPetLoop(['1.gif', '2.gif', '3.gif']);
        showStickerToast('已恢复默认形象');
    }
    updateZcBtn();
}

function updateZcBtn() {
    const btn = document.getElementById('zcBtn');
    if (btn) btn.textContent = zcModeOn ? '✅ zc 形象' : 'zc 形象';
}
let mode = "free";
let px = 50;
let py = 200;
const PET_SIZE = 100;
let vx = [-2, -1, 1, 2][Math.floor(Math.random() * 4)];
let vy = [-2, -1, 1, 2][Math.floor(Math.random() * 4)];
let edgeDir = 1;
let flashCount = 0;
let lastActionTime = Date.now();
const EDGE_GAP = 20;

pet.addEventListener("click", (e) => {
    if (didDrag) return;
    if (mode === "fixed") mode = "free";
    createHearts(e.pageX, e.pageY);
    showBubble();
    togglePetMenu();
});

function freeMove() {
    px += vx;
    py += vy;
    const maxX = window.innerWidth - PET_SIZE;
    const maxY = window.innerHeight - PET_SIZE;
    if (px <= 0) { px = 0; vx = Math.abs(vx); }
    if (px >= maxX) { px = maxX; vx = -Math.abs(vx); }
    if (py <= 0) { py = 0; vy = Math.abs(vy); }
    if (py >= maxY) { py = maxY; vy = -Math.abs(vy); }
    pet.style.left = px + "px";
    pet.style.top = py + "px";
}

function nearEdge() {
    const maxX = window.innerWidth - PET_SIZE;
    const maxY = window.innerHeight - PET_SIZE;
    return (
        px <= EDGE_GAP ||
        py <= EDGE_GAP ||
        px >= maxX - EDGE_GAP ||
        py >= maxY - EDGE_GAP
    );
}

function edgeMove() {
    const maxX = window.innerWidth - PET_SIZE;
    const maxY = window.innerHeight - PET_SIZE;
    if (py <= EDGE_GAP) {
        px += edgeDir * 2;
        if (px <= 0 || px >= maxX) edgeDir *= -1;
    } else if (py >= maxY - EDGE_GAP) {
        px += edgeDir * 2;
        if (px <= 0 || px >= maxX) edgeDir *= -1;
    } else if (px <= EDGE_GAP) {
        py += edgeDir * 2;
        if (py <= 0 || py >= maxY) edgeDir *= -1;
    } else if (px >= maxX - EDGE_GAP) {
        py += edgeDir * 2;
        if (py <= 0 || py >= maxY) edgeDir *= -1;
    } else {
        mode = "free";
        return;
    }
    pet.style.left = px + "px";
    pet.style.top = py + "px";
}

function startFlashMode() {
    mode = "flash";
    flashCount = 0;
    const timer = setInterval(() => {
        if (mode !== "flash") { clearInterval(timer); return; }
        flashCount++;
        px = Math.random() * (window.innerWidth - PET_SIZE);
        py = Math.random() * (window.innerHeight - PET_SIZE);
        pet.style.left = px + "px";
        pet.style.top = py + "px";
        if (flashCount >= 30) {
            clearInterval(timer);
            mode = "free";
            vx = [-2, -1, 1, 2][Math.floor(Math.random() * 4)];
            vy = [-2, -1, 1, 2][Math.floor(Math.random() * 4)];
        }
    }, 8000);
}

let dragging = false;
let didDrag = false;
let offsetX = 0;
let offsetY = 0;
let dragStartX = 0;
let dragStartY = 0;

pet.addEventListener("mousedown", (e) => {
    dragging = true;
    didDrag = false;
    mode = "manual";
    lastActionTime = Date.now();
    offsetX = e.clientX - px;
    offsetY = e.clientY - py;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    e.preventDefault();
});
document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    if (Math.abs(e.clientX - dragStartX) > 5 ||
        Math.abs(e.clientY - dragStartY) > 5) {
        didDrag = true;
    }
    px = e.clientX - offsetX;
    py = e.clientY - offsetY;
    px = Math.max(0, Math.min(px, window.innerWidth - PET_SIZE));
    py = Math.max(0, Math.min(py, window.innerHeight - PET_SIZE));
    pet.style.left = px + "px";
    pet.style.top = py + "px";
    lastActionTime = Date.now();
});
document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    if (didDrag) {
        mode = "fixed";
    }
});

pet.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    dragging = true;
    didDrag = false;
    mode = "manual";
    lastActionTime = Date.now();
    offsetX = t.clientX - px;
    offsetY = t.clientY - py;
    dragStartX = t.clientX;
    dragStartY = t.clientY;
    e.stopPropagation();
}, { passive: true });
document.addEventListener("touchmove", (e) => {
    if (!dragging) return;
    const t = e.touches[0];
    if (Math.abs(t.clientX - dragStartX) > 5 ||
        Math.abs(t.clientY - dragStartY) > 5) {
        didDrag = true;
    }
    px = t.clientX - offsetX;
    py = t.clientY - offsetY;
    px = Math.max(0, Math.min(px, window.innerWidth - PET_SIZE));
    py = Math.max(0, Math.min(py, window.innerHeight - PET_SIZE));
    pet.style.left = px + "px";
    pet.style.top = py + "px";
    lastActionTime = Date.now();
}, { passive: true });
document.addEventListener("touchend", () => {
    if (!dragging) return;
    dragging = false;
    if (didDrag) {
        mode = "fixed";
    } else {
        if (mode === "fixed") mode = "free";
        createHearts(px + PET_SIZE / 2, py + PET_SIZE / 2);
        showBubble();
    }
});

setInterval(() => {
    if (mode === "manual") {
        if (Date.now() - lastActionTime > 30000) {
            startFlashMode();
        }
    }
}, 1000);

setInterval(() => {
    if (mode === "free") freeMove();
    if (mode === "edge") edgeMove();
}, 50);

function createHearts(x, y) {
    for (let i = 0; i < 8; i++) {
        const heart = document.createElement("div");
        heart.className = "heart-effect";
        heart.innerHTML = "🍊";
        heart.style.left = (x + Math.random() * 60 - 30) + "px";
        heart.style.top = (y + Math.random() * 30 - 15) + "px";
        document.body.appendChild(heart);
        setTimeout(() => { heart.remove(); }, 2000);
    }
}

const sweetWords = [
    "爱你呀 ", "抱抱～ ", "辛苦啦 ", "今天也很棒 ",
    "记得开心哦 ", "么么哒 ", "陪着你呢 ",
    "最喜欢你啦 ", "摸摸头 ", "要天天开心呀 "
];

function showBubble() {
    const bubble = document.createElement("div");
    bubble.className = "pet-bubble";
    bubble.innerText = sweetWords[Math.floor(Math.random() * sweetWords.length)];
    bubble.style.left = (px + 20) + "px";
    bubble.style.top = (py - 50) + "px";
    document.body.appendChild(bubble);
    setTimeout(() => { bubble.remove(); }, 2500);
}

document.addEventListener("click", (e) => {
    if (!pet.contains(e.target) && !menu.contains(e.target)) {
        menu.style.display = "none";
    }
});

window.addEventListener("resize", () => {
    const maxX = window.innerWidth - PET_SIZE;
    const maxY = window.innerHeight - PET_SIZE;
    px = Math.min(px, maxX);
    py = Math.min(py, maxY);
    pet.style.left = px + "px";
    pet.style.top = py + "px";
});

/* ===== 设备唯一标识 ===== */
let deviceIdFresh = false;

function getDeviceId() {
    let id = localStorage.getItem('ld_device_id');
    if (!id) {
        id = 'dev_' + (crypto.randomUUID ? crypto.randomUUID() : (Date.now() + '_' + Math.random().toString(36).slice(2)));
        localStorage.setItem('ld_device_id', id);
        deviceIdFresh = true;
    }
    return id;
}
let DEVICE_ID = getDeviceId();

async function restoreLocalState() {
    try {
        const savedId = ((await LocalCache.readText('device_id.txt')) || '').trim();
        if (savedId && deviceIdFresh) {
            DEVICE_ID = savedId;
            localStorage.setItem('ld_device_id', DEVICE_ID);
        } else if (!savedId) {
            LocalCache.writeText('device_id.txt', DEVICE_ID);
        }

        const arr = await LocalCache.readJSON('seen_ids.json');
        if (Array.isArray(arr) && arr.length) {
            const s = getSeenIds();
            arr.forEach(x => s.add(String(x)));
            try { localStorage.setItem('seen_ids', JSON.stringify([...s])); } catch (e) {}
        }
    } catch (e) {
        console.warn('恢复本地状态失败', e);
    }
}

const DEFAULT_AVATAR_URL = `./c.jpg`;

const defaultAvatarDataUri = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60">' +
    '<rect width="60" height="60" rx="30" fill="#ffb6c1"/>' +
    '<text x="30" y="40" font-size="26" text-anchor="middle" fill="white">🐾</text>' +
    '</svg>'
);

let myProfile = { nickname: '神秘人', avatar_url: '', wechat_bound: false, wechat_masked: '' };
let pendingAvatarFile = null;

function updateAvatarUI() {
    const avatarImg = document.getElementById('avatarImg');
    const avatarName = document.getElementById('avatarName');

    if (!avatarImg || !avatarName) return;

    avatarName.textContent = myProfile.nickname || '神秘人';

    avatarImg.onerror = function() {
        this.onerror = null;
        this.src = defaultAvatarDataUri;
    };

    if (myProfile.avatar_url) {
        const url = myProfile.avatar_url.startsWith('/')
            ? API_BASE + myProfile.avatar_url
            : myProfile.avatar_url;
        setCachedSrc(avatarImg, url);
    } else {
        avatarImg.src = DEFAULT_AVATAR_URL;
    }
}

/* 总未读：延迟 + 超时 + 失败静默（关键！避免抢 db_lock 拖死首屏） */
async function loadTotalUnreadCount() {
    // 延迟 3 秒，避开 loadMediaData 的首屏高峰
    await new Promise(r => setTimeout(r, 3000));
    try {
        const res = await fetchTimeout(
            `${API_BASE}/media?page=1&limit=9999&device_id=${encodeURIComponent(DEVICE_ID)}`,
            {},
            15000
        );
        const result = await res.json();
        if (result.success && result.data) {
            const total = result.data.reduce((sum, item) => sum + (item.unread_count || 0), 0);
            updateTotalUnreadBadge(total);
        }
    } catch (e) {
        // 超时/失败静默，不影响主页面
        console.warn('加载总未读数失败（不影响主页面）:', e.message || e);
    }
}

function updateTotalUnreadBadge(total) {
    const badge = document.getElementById('totalUnreadBadge');
    if (!badge) return;
    if (total > 0) {
        badge.textContent = total > 99 ? '99+' : total;
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
}

async function loadMyProfile() {
    try {
        const local = await LocalCache.readJSON('profile.json');
        if (local && local.device_id === DEVICE_ID) {
            myProfile.nickname      = local.nickname || myProfile.nickname;
            myProfile.avatar_url    = local.avatar_url || '';
            myProfile.wechat_bound  = !!local.wechat_bound;
            myProfile.wechat_masked = local.wechat_masked || '';
            updateAvatarUI();
        }
    } catch (e) {}

    try {
        const res = await fetch(`${API_BASE}/profile/${DEVICE_ID}`);
        const result = await res.json();
        if (result.success) {
            myProfile.nickname      = result.nickname;
            myProfile.avatar_url    = result.avatar_url;
            myProfile.wechat_bound  = !!result.wechat_bound;
            myProfile.wechat_masked = result.wechat_masked || '';
            LocalCache.writeJSON('profile.json', Object.assign({ device_id: DEVICE_ID }, myProfile));
        }
    } catch (e) {
        console.error('加载头像信息失败:', e);
    } finally {
        updateAvatarUI();
        try {
            const r = await fetchTimeout(`${ZC_API}/pet/zc/pref/${DEVICE_ID}`, {}, 4000);
            const d = await r.json();
            if (d.success && d.enabled) {
                zcModeOn = true;
                await loadZcGifs();
                updateZcBtn();
            }
        } catch (e) {
            console.warn('ZC 服务不可用', e);
        }
        loadTotalUnreadCount();
    }
}

let currentPage = 1;
const itemsPerPage = 4;
let currentDetailId = null;
let mediaData = [];
let tgBgNaturalRatio = null;

function loadTgBackgroundRatio() {
    if (tgBgNaturalRatio !== null) return Promise.resolve(tgBgNaturalRatio);
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            tgBgNaturalRatio = img.naturalHeight / img.naturalWidth;
            resolve(tgBgNaturalRatio);
        };
        img.onerror = () => {
            tgBgNaturalRatio = 0;
            resolve(0);
        };
        img.src = './tg.jpg';
    });
}

function checkDetailBgOverflow() {
    const contentEl = document.getElementById('v28');
    const commentsList = document.getElementById('commentsList');
    if (!contentEl || !commentsList || !tgBgNaturalRatio) return;

    commentsList.classList.remove('scroll-mode');
    commentsList.style.maxHeight = '';

    const renderedBgHeight = contentEl.clientWidth * tgBgNaturalRatio;
    const contentHeight = contentEl.scrollHeight;

    if (contentHeight > renderedBgHeight) {
        const overflowAmount = contentHeight - renderedBgHeight;
        const commentsHeight = commentsList.scrollHeight;
        const newMaxHeight = Math.min(
            Math.max(commentsHeight - overflowAmount, 300),
            commentsHeight
        );
        commentsList.style.maxHeight = newMaxHeight + 'px';
        commentsList.classList.add('scroll-mode');
    }
}
function compressImage(file, quality = 0.6) {
    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        img.onload = function () {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            canvas.toBlob(resolve, 'image/jpeg', quality);
        };
        img.src = URL.createObjectURL(file);
    });
}

const LOVE_START_DATE = new Date('2026-01-06');

function updateLoveDays() {
    const today = new Date();
    const start = new Date(LOVE_START_DATE.getFullYear(), LOVE_START_DATE.getMonth(), LOVE_START_DATE.getDate());
    const now = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const diffDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));

    const loginDaysEl = document.getElementById('loveDays');
    if (loginDaysEl) {
        loginDaysEl.textContent = diffDays >= 0 ? ` ${diffDays} Days ` : "💕 爱情倒计时...";
    }

    const headerDaysEl = document.getElementById('headerLoveDays');
    if (headerDaysEl) {
        headerDaysEl.textContent = diffDays >= 0 ? `💕 ${diffDays} Days` : '💕 倒计时...';
    }
}
updateLoveDays();
setInterval(updateLoveDays, 60000);

/* =====================================================
   帖子列表：先本地，再服务器
   ===================================================== */
let mediaLoadSeq = 0;

async function loadMediaData() {
    const seq = ++mediaLoadSeq;
    const loadingEl = document.getElementById('loading');
    const gridEl = document.getElementById('mediaGrid');
    const pagEl = document.getElementById('pagination');

    const useCache = !isSearchMode;
    const cacheKey = `media_p${currentPage}.json`;
    let localStr = null;

    // ① 本地（try/catch 保护）
    if (useCache) {
        let local = null;
        try {
            local = await LocalCache.readJSON(cacheKey);
        } catch (e) {
            console.warn('本地列表缓存读取失败，跳过', e);
        }
        if (seq !== mediaLoadSeq) return;
        if (local && Array.isArray(local.data) && local.data.length) {
            localStr = JSON.stringify(local.data);
            mediaData = local.data;
            renderMediaGrid(local.data);
            updatePagination(local.total_pages, local.current_page);
            loadingEl.style.display = 'none';
        }
    }
    if (localStr === null) {
        loadingEl.style.display = 'block';
        gridEl.style.display = 'none';
        pagEl.style.display = 'none';
    }

    // ② 服务器（15 秒超时，避免死等）
    try {
        const response = await fetchTimeout(
            `${API_BASE}/media?page=${currentPage}&limit=${itemsPerPage}&device_id=${encodeURIComponent(DEVICE_ID)}`,
            {},
            15000
        );
        const result = await response.json();
        if (seq !== mediaLoadSeq) return;
        if (result.success) {
            if (useCache) LocalCache.writeJSON(cacheKey, result);
            if (JSON.stringify(result.data) !== localStr) {
                mediaData = result.data;
                renderMediaGrid(result.data);
            }
            updatePagination(result.total_pages, result.current_page);
        } else if (localStr === null) {
            showError('加载数据失败');
        }
    } catch (error) {
        console.error('加载数据错误:', error);
        if (seq === mediaLoadSeq && localStr === null) showError('网络错误，且本地没有缓存');
    } finally {
        if (seq === mediaLoadSeq) loadingEl.style.display = 'none';
    }
}
function getBgPositionForId(id) {
    const x = 20 + ((id * 37) % 60);
    const y = 20 + ((id * 53) % 60);
    return `${x}% ${y}%`;
}
function renderMediaGrid(data) {
    const grid = document.getElementById('mediaGrid');
    grid.innerHTML = '';
    const seenIds = getSeenIds();

    data.forEach(item => {

        const mediaItem = document.createElement('div');
        const unreadForCard = item.unread_count || 0;
        mediaItem.className = 'media-item' + (unreadForCard > 0 ? ' has-unread' : '');
        mediaItem.style.position = 'relative';
        mediaItem.onclick = () => showDetail(item.id);
        mediaItem.style.backgroundPosition = getBgPositionForId(item.id);

        let mediaHtml = '';
        const images = item.images || [{ url: item.url, type: item.type }];

        if (images.length > 1) {
            const slides = images.map((img) => {
                if (img.type === 'video') {
                    const poster = item.thumbnail ? API_BASE + item.thumbnail : '';
                    return `<div class="swipe-slide" style="min-width:100%;position:relative;">
                        <video class="media-preview" muted poster="${poster}" style="pointer-events:none;">
                            <source src="${API_BASE}${img.url}">
                        </video>
                        <div class="play-icon">▶</div>
                    </div>`;
                }
                return `<div class="swipe-slide" style="min-width:100%;">
                    <img class="media-preview" data-cache-src="${API_BASE}${img.url}" loading="lazy">
                </div>`;
            }).join('');

            const dots = images.map((_, i) =>
                `<span class="swipe-dot${i === 0 ? ' active' : ''}"></span>`
            ).join('');

            mediaHtml = `
                <div class="swipe-wrap" data-idx="0">
                    <div class="swipe-track" style="display:flex;transition:transform .25s ease;">
                        ${slides}
                    </div>
                    <div class="swipe-dots">${dots}</div>
                    <div class="swipe-count">${images.length}张</div>
                </div>`;
        } else {
            if (item.type === 'video') {
                const posterUrl = item.thumbnail ? API_BASE + item.thumbnail : './appIcon.png';
                mediaHtml = `<div class="video-thumbnail" style="position:relative">
                    <video class="media-preview" muted poster="${posterUrl}">
                        <source src="${API_BASE}${item.url}" type="video/mp4">
                    </video>
                    <div class="play-icon">▶</div>
                </div>`;
            } else {
                mediaHtml = `<img class="media-preview" data-cache-src="${API_BASE}${item.url}" alt="图片" loading="lazy">`;
            }
        }

        const uploaderAvatarSrc = item.uploader_avatar
            ? (API_BASE + item.uploader_avatar)
            : DEFAULT_AVATAR_URL;
        const uploaderAvatarAttr = item.uploader_avatar
            ? `data-cache-src="${uploaderAvatarSrc}"`
            : `src="${uploaderAvatarSrc}"`;

        const isNew = !seenIds.has(String(item.id));
        const newBadgeHtml = isNew ? `<div class="new-badge">NEW</div>` : '';

        const unread = item.unread_count || 0;
        const unreadDotHtml = unread > 0
            ? `<div class="unread-dot">${unread > 99 ? '99+' : unread}</div>`
            : '';

        const badgeWrapHtml = (isNew || unread > 0)
            ? `<div class="card-badge-wrap">${newBadgeHtml}${unreadDotHtml}</div>`
            : '';

        mediaItem.innerHTML = `
            <div class="uploader-badge">
                <img class="uploader-avatar"
                     ${uploaderAvatarAttr}
                     onerror="this.onerror=null;this.src='${defaultAvatarDataUri}'">
                <span class="uploader-name">${item.uploader_name || '神秘人'}</span>
            </div>
            <div style="position:relative;width:100%;">
                ${badgeWrapHtml}
                ${mediaHtml}
            </div>
            <div class="media-info">
                <p class="media-description">${item.description}</p>
                <p class="media-date">${item.date}</p>
            </div>`;
        grid.appendChild(mediaItem);

        grid.querySelectorAll('.swipe-wrap').forEach(wrap => {
            if (wrap.dataset.bound) return;
            wrap.dataset.bound = '1';
            const track = wrap.querySelector('.swipe-track');
            const dots = wrap.querySelectorAll('.swipe-dot');
            const total = dots.length;
            let startX = 0, idx = 0;

            wrap.addEventListener('touchstart', e => {
                startX = e.touches[0].clientX;
                e.stopPropagation();
            }, { passive: true });

            wrap.addEventListener('touchend', e => {
                const dx = e.changedTouches[0].clientX - startX;
                if (Math.abs(dx) < 30) return;
                e.stopPropagation();
                idx = dx < 0 ? Math.min(idx + 1, total - 1) : Math.max(idx - 1, 0);
                track.style.transform = `translateX(-${idx * 100}%)`;
                dots.forEach((d, i) => d.classList.toggle('active', i === idx));
            }, { passive: true });
        });
    });

    grid.querySelectorAll('.loc-weather[data-geo-id]').forEach(el => {
        el.addEventListener('click', ev => {
            ev.stopPropagation();
            const id = el.dataset.geoId;
            const target = mediaData.find(m => String(m.id) === String(id));
            if (target) openPostMap(target);
        });
    });

    document.getElementById('mediaGrid').style.display = 'grid';
}
function updatePagination(totalPages, currentPageNum) {
    currentPage = currentPageNum;
    document.getElementById('pageInfo').textContent = `${currentPage} / ${totalPages}`;
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    if (currentPage === 1) {
        prevBtn.disabled = true;
        prevBtn.classList.add('disabled');
    } else {
        prevBtn.disabled = false;
        prevBtn.classList.remove('disabled');
    }
    if (currentPage === totalPages) {
        nextBtn.disabled = true;
        nextBtn.classList.add('disabled');
    } else {
        nextBtn.disabled = false;
        nextBtn.classList.remove('disabled');
    }
    document.getElementById('pagination').style.display = 'flex';
}

function previousPage() {
    if (currentPage > 1) {
        currentPage--;
        if (isSearchMode) {
            performSearchWithPage();
        } else {
            loadMediaData();
        }
    }
}

function nextPage() {
    const pageInfo = document.getElementById('pageInfo').textContent;
    const totalPages = parseInt(pageInfo.split(' / ')[1]);
    if (currentPage < totalPages) {
        currentPage++;
        if (isSearchMode) {
            performSearchWithPage();
        } else {
            loadMediaData();
        }
    }
}

/* ===== 上传 ===== */
let multiSelectOn = false;
let currentGroupId = null;
let groupFileCount = 0;

function showUploadModal() {
    document.getElementById('uploadModal').style.display = 'block';
}

function onMultiSelectToggle(checked) {
    multiSelectOn = checked;
    const track = document.getElementById('multiSelectTrack');
    const thumb = document.getElementById('multiSelectThumb');
    const hint  = document.getElementById('multiSelectHint');
    const finishBtn = document.getElementById('finishGroupBtn');
    if (checked) {
        track.style.background = '#ff69b4';
        thumb.style.transform  = 'translateX(20px)';
        currentGroupId  = 'grp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        groupFileCount  = 0;
        hint.textContent = '已开启：连续上传将归为同一帖子';
        finishBtn.style.display = 'block';
    } else {
        track.style.background = '#ccc';
        thumb.style.transform  = 'translateX(0)';
        currentGroupId  = null;
        groupFileCount  = 0;
        hint.textContent = '开启后连续上传归为同一帖子';
        finishBtn.style.display = 'none';
    }
}

function hideUploadModal() {
    document.getElementById('uploadModal').style.display = 'none';
    document.getElementById('fileInput').value = '';
    document.getElementById('filePreviewContainer').innerHTML = '';
    document.getElementById('descriptionInput').value = '';
}

function previewFile() {
    const file = document.getElementById('fileInput').files[0];
    const container = document.getElementById('filePreviewContainer');
    container.innerHTML = '';
    if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            const isVideo = file.type.startsWith('video/');
            const el = document.createElement(isVideo ? 'video' : 'img');
            el.src = e.target.result;
            if (isVideo) el.muted = true;
            el.style.width = '70px';
            el.style.height = '70px';
            el.style.objectFit = 'cover';
            el.style.borderRadius = '8px';
            container.appendChild(el);
        };
        reader.readAsDataURL(file);
    }
}

async function uploadFile() {
    const file = document.getElementById('fileInput').files[0];
    const description = document.getElementById('descriptionInput').value.trim();
    if (!file || !description) {
        alert('请选择文件并填写描述');
        return;
    }

    const loc = await getCurrentLocation();

    const doUpload = (fileToSend) => {
        const formData = new FormData();
        if (loc) {
            formData.append('lat', loc.lat);
            formData.append('lon', loc.lon);
        }
        formData.append('file', fileToSend, file.name);
        formData.append('description', description);
        formData.append('device_id', DEVICE_ID);
        if (multiSelectOn && currentGroupId) {
            formData.append('group_id', currentGroupId);
        }

        showUploadProgress();

        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_BASE}/upload`);

        xhr.upload.onprogress = function (e) {
            if (e.lengthComputable) {
                updateUploadProgress(Math.round((e.loaded / e.total) * 100));
            }
        };

        xhr.onload = function () {
            hideUploadProgress();
            let result;
            try { result = JSON.parse(xhr.responseText); }
            catch (e) { alert('上传失败，请稍后重试'); return; }

            if (result.success) {
                if (multiSelectOn) {
                    groupFileCount++;
                    document.getElementById('fileInput').value = '';
                    document.getElementById('filePreviewContainer').innerHTML = '';
                    showStickerToast(`第 ${groupFileCount} 个文件已上传，可继续选择或关闭窗口`);
                } else {
                    hideUploadModal();
                    currentPage = 1;
                    loadMediaData();
                }
            } else {
                alert('上传失败：' + result.message);
            }
        };

        xhr.onerror = function () {
            hideUploadProgress();
            alert('上传失败，请稍后重试');
        };

        xhr.send(formData);
    };

    if (file.type.startsWith('image/')) {
        compressImage(file, 0.6)
            .then(compressedFile => doUpload(compressedFile || file))
            .catch(() => doUpload(file));
    } else {
        doUpload(file);
    }
}

const starEmojis = ['⭐', '✨', '🌟'];

function spawnAvatarStar() {
    const avatarWrap = document.getElementById('accountAvatar');
    if (!avatarWrap) return;
    const rect = avatarWrap.getBoundingClientRect();

    const star = document.createElement('div');
    star.className = 'avatar-star';
    star.textContent = starEmojis[Math.floor(Math.random() * starEmojis.length)];

    const startX = rect.left + rect.width / 2 + (Math.random() - 0.5) * rect.width * 0.8;
    const startY = rect.top + (Math.random() - 0.5) * rect.height * 0.6;
    star.style.left = startX + 'px';
    star.style.top = startY + 'px';

    const sx = (Math.random() - 0.5) * 60;
    const sy = -40 - Math.random() * 50;
    star.style.setProperty('--sx', sx + 'px');
    star.style.setProperty('--sy', sy + 'px');
    star.style.fontSize = (12 + Math.random() * 8) + 'px';

    document.body.appendChild(star);
    setTimeout(() => star.remove(), 1600);
}
function startAvatarStarLoop() {
    setInterval(() => {
        const count = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i++) {
            setTimeout(() => spawnAvatarStar(), i * 80);
        }
    }, 500);
}
function showUploadProgress() {
    updateUploadProgress(0);
    document.getElementById('uploadProgressOverlay').classList.add('show');
}
function hideUploadProgress() {
    document.getElementById('uploadProgressOverlay').classList.remove('show');
}
function updateUploadProgress(percent) {
    document.getElementById('uploadProgressPercent').textContent = percent + '%';
    document.getElementById('uploadProgressFill').style.width = percent + '%';
    document.getElementById('uploadProgressLabel').textContent =
        percent >= 100 ? '处理中，请稍候…' : '正在上传...';
}

/* =====================================================
   详情页
   ===================================================== */
let detailRequestSeq = 0;

async function renderDetail(item, skipMedia) {
    if (!skipMedia) {
        detailSlideIdx = 0;
        renderDetailMedia(item);
    }

    const detailUploaderEl = document.getElementById('detailUploader');
    if (detailUploaderEl) {
        const hasAvatar = !!item.uploader_avatar;
        const avatarSrc = hasAvatar ? (API_BASE + item.uploader_avatar) : DEFAULT_AVATAR_URL;
        detailUploaderEl.innerHTML = `
            <img class="detail-uploader-avatar" ${hasAvatar ? 'data-cache-src' : 'src'}="${avatarSrc}" onerror="this.onerror=null;this.src='${defaultAvatarDataUri}'">
            <span class="detail-uploader-name">${item.uploader_name || '神秘人'}</span>
        `;
    }
    document.getElementById('detailDescription').textContent = item.description;

    const hasGeo = item.lat && item.lng;
    const locHtml = (item.location || item.weather)
        ? `<span class="loc-weather" ${hasGeo ? 'id="detailLocWeather" style="cursor:pointer;text-decoration:underline dotted"' : ''}>${
            item.location ? '📍' + escapeHtml(item.location) : ''
          }${
            item.weather ? ' <span class="wx">' + escapeHtml(item.weather) + '</span>' : ''
          }</span>`
        : '';
    document.getElementById('detailDate').innerHTML =
        `${item.date}${locHtml ? ' · ' + locHtml : ''}`;

    const locEl = document.getElementById('detailLocWeather');
    if (locEl) {
        locEl.onclick = () => openPostMap(item);
    }

    const comments = item.comments || [];
    document.getElementById('likeCount').textContent = item.likes;
    currentLiked = !!item.is_liked;
    updateLikeBtnUI();
    document.getElementById('commentCount').textContent = comments.length;
    renderComments(comments);
    await loadTgBackgroundRatio();
    checkDetailBgOverflow();
}

async function showDetail(id) {
    const seq = ++detailRequestSeq;

    document.getElementById('commentsList').innerHTML = '';
    document.getElementById('commentCount').textContent = '0';
    document.getElementById('unreadBadge').style.display = 'none';

    markSeen(id);
    document.querySelectorAll('.media-item').forEach(el => {
        const fn = el.getAttribute('onclick') || '';
        if (fn.includes(`showDetail(${id})`)) {
            el.querySelector('.card-badge-wrap')?.remove();
        }
    });

    const cacheKey = `detail_${id}.json`;

    let local = null;
    try {
        local = await LocalCache.readJSON(cacheKey);
    } catch (e) {
        console.warn('本地详情缓存读取失败，跳过', e);
    }
    if (seq !== detailRequestSeq) return;
    if (local) {
        currentDetailId = id;
        await renderDetail(local, false);
        if (seq !== detailRequestSeq) return;
        document.getElementById('detailPage').style.display = 'block';
    }

    try {
        const response = await fetchTimeout(
            `${API_BASE}/media/${id}?device_id=${encodeURIComponent(DEVICE_ID)}`,
            {},
            15000
        );
        const result = await response.json();

        if (seq !== detailRequestSeq) return;

        if (result.success) {
            const item = result.data;
            currentDetailId = id;
            LocalCache.writeJSON(cacheKey, item);

            const changed = !local || JSON.stringify(local) !== JSON.stringify(item);
            if (changed) {
                const mediaSame = !!local && local.url === item.url &&
                    JSON.stringify(local.images || null) === JSON.stringify(item.images || null);
                await renderDetail(item, mediaSame);
                if (seq !== detailRequestSeq) return;
            }

            document.getElementById('detailPage').style.display = 'block';
            loadVisitors(id);

            fetch(`${API_BASE}/media/${id}/read`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ device_id: DEVICE_ID })
            }).then(() => loadTotalUnreadCount())
              .catch(() => {});
        }
    } catch (error) {
        console.error('加载详情错误:', error);
        if (seq === detailRequestSeq && !local) alert('加载详情失败');
    }
}
function renderDetailMedia(item) {
    const wrapper = document.getElementById('detailMediaWrapper');
    const images = item.images && item.images.length > 1
        ? item.images
        : [{ url: item.url, type: item.type }];

    if (images.length === 1) {
        const single = images[0];
        if (single.type === 'video') {
            wrapper.innerHTML = `
                <video class="detail-media" controls playsinline preload="metadata"
                       style="width:100%;max-height:70vh;background:#000;display:block;">
                    <source src="${API_BASE}${single.url}" type="video/mp4">
                </video>`;
        } else {
            wrapper.innerHTML = `
                <img class="detail-media" data-cache-src="${API_BASE}${single.url}"
                     style="width:100%;max-height:70vh;object-fit:contain;display:block;cursor:pointer;"
                     onclick="showFullscreen('${API_BASE}${single.url}')">`;
        }
        return;
    }

    const slides = images.map((img, i) => {
        if (img.type === 'video') {
            return `<div class="detail-slide" style="width:100%;flex:0 0 100%;box-sizing:border-box;">
                <video controls playsinline preload="metadata"
                       style="width:100%;max-height:65vh;background:#000;display:block;object-fit:contain;">
                    <source src="${API_BASE}${img.url}" type="video/mp4">
                </video>
            </div>`;
        }
        return `<div class="detail-slide" style="width:100%;flex:0 0 100%;box-sizing:border-box;">
            <img data-cache-src="${API_BASE}${img.url}"
                 style="width:100%;max-height:65vh;object-fit:contain;display:block;cursor:pointer;"
                 onclick="showFullscreen('${API_BASE}${img.url}')">
        </div>`;
    }).join('');

    const dots = images.map((_, i) =>
        `<span class="detail-dot${i===0?' active':''}" data-idx="${i}"></span>`
    ).join('');

    wrapper.innerHTML = `
        <div style="position:relative;overflow:hidden;background:#000;">
            <div id="detailTrack" style="display:flex;width:100%;transition:transform .3s ease;will-change:transform;">
                ${slides}
            </div>

            <button onclick="detailSlide(-1)" style="
                position:absolute;left:10px;top:50%;transform:translateY(-50%);
                background:rgba(0,0,0,0.4);border:none;color:white;
                width:36px;height:36px;border-radius:50%;font-size:18px;
                cursor:pointer;display:flex;align-items:center;justify-content:center;
                z-index:10;">‹</button>
            <button onclick="detailSlide(1)" style="
                position:absolute;right:10px;top:50%;transform:translateY(-50%);
                background:rgba(0,0,0,0.4);border:none;color:white;
                width:36px;height:36px;border-radius:50%;font-size:18px;
                cursor:pointer;display:flex;align-items:center;justify-content:center;
                z-index:10;">›</button>

            <div id="detailCounter" style="
                position:absolute;top:10px;right:12px;
                background:rgba(0,0,0,0.45);color:white;
                font-size:12px;padding:3px 9px;border-radius:12px;">
                1 / ${images.length}
            </div>

            <div style="position:absolute;bottom:10px;left:50%;transform:translateX(-50%);
                        display:flex;gap:5px;" id="detailDots">${dots}</div>
        </div>`;

    detailSlideIdx = 0;
    detailSlideTotal = images.length;

    const track = wrapper.querySelector('#detailTrack');
    let startX = 0;
    track.parentElement.addEventListener('touchstart', e => {
        startX = e.touches[0].clientX;
    }, { passive: true });
    track.parentElement.addEventListener('touchend', e => {
        const dx = e.changedTouches[0].clientX - startX;
        if (Math.abs(dx) > 40) detailSlide(dx < 0 ? 1 : -1);
    }, { passive: true });
}
let detailSlideIdx = 0;
let detailSlideTotal = 0;

function detailSlide(dir) {
    const track = document.getElementById('detailTrack');
    const dots = document.querySelectorAll('.detail-dot');
    const counter = document.getElementById('detailCounter');
    if (!track) return;

    detailSlideTotal = track.children.length;
    detailSlideIdx = Math.max(0, Math.min(detailSlideIdx + dir, detailSlideTotal - 1));

    track.style.transform = `translateX(-${detailSlideIdx * 100}%)`;
    dots.forEach((d, i) => d.classList.toggle('active', i === detailSlideIdx));
    if (counter) counter.textContent = `${detailSlideIdx + 1} / ${detailSlideTotal}`;
}
function showFullscreen(src) {
    const modal = document.createElement('div');
    modal.className = 'fullscreen-modal';
    modal.style.display = 'block';
    modal.innerHTML = `
        <span class="close-fullscreen">&times;</span>
        <img class="fullscreen-image" alt="全屏图片">
    `;
    document.body.appendChild(modal);
    setCachedSrc(modal.querySelector('.fullscreen-image'), src);
    modal.onclick = () => {
        document.body.removeChild(modal);
    };
}
let vtOpen = false;

function vtToggle() {
    vtOpen = !vtOpen;
    document.getElementById('vtList').classList.toggle('open', vtOpen);
    document.getElementById('vtChev').classList.toggle('open', vtOpen);
}

function vtRelTime(isoStr) {
    const diff = Date.now() - new Date(isoStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1)  return '刚刚来过';
    if (m < 60) return `${m} 分钟前来过`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} 小时前来过`;
    const d = Math.floor(h / 24);
    if (d === 1) return '昨天来过';
    return `${d} 天前来过`;
}

function vtFmtTime(isoStr) {
    const d = new Date(isoStr);
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${mo}-${da} ${hh}:${mm}`;
}

async function loadVisitors(mediaId) {
    try {
        const res = await fetch(`${API_BASE}/media/${mediaId}/visitors?device_id=${encodeURIComponent(DEVICE_ID)}`);
        const result = await res.json();
        if (!result.success || !result.data.length) return;
        if (mediaId !== currentDetailId) return;

        const visitors = result.data;
        const card = document.getElementById('visitorCard');
        const avWrap = document.getElementById('vtAvatars');
        const list = document.getElementById('vtList');

        avWrap.innerHTML = '';
        visitors.slice(0, 4).forEach(v => {
            const el = document.createElement('div');
            el.className = 'vt-av';
            if (v.avatar_url) {
                const img = document.createElement('img');
                img.onerror = () => { el.textContent = v.nickname[0] || '?'; };
                img.dataset.cacheSrc = v.avatar_url.startsWith('/') ? API_BASE + v.avatar_url : v.avatar_url;
                el.appendChild(img);
            } else {
                el.textContent = v.nickname[0] || '?';
            }
            avWrap.appendChild(el);
        });
        if (visitors.length > 4) {
            const more = document.createElement('div');
            more.className = 'vt-av';
            more.style.cssText = 'background:#f0f0f0;color:#aaa;font-size:10px';
            more.textContent = `+${visitors.length - 4}`;
            avWrap.appendChild(more);
        }

        document.getElementById('vtCountLabel').textContent = `${visitors.length} 人来过`;
        document.getElementById('vtLatestLine').textContent =
            `${visitors[0].nickname} ${vtRelTime(visitors[0].last_visit)}`;

        list.innerHTML = '';
        visitors.forEach(v => {
            const row = document.createElement('div');
            row.className = 'vt-row';

            const avEl = document.createElement('div');
            avEl.className = 'vt-row-av';
            if (v.avatar_url) {
                const img = document.createElement('img');
                img.onerror = () => { avEl.textContent = v.nickname[0] || '?'; };
                img.dataset.cacheSrc = v.avatar_url.startsWith('/') ? API_BASE + v.avatar_url : v.avatar_url;
                avEl.appendChild(img);
            } else {
                avEl.textContent = v.nickname[0] || '?';
            }

            row.innerHTML = `
                <div class="vt-row-name">${v.nickname}</div>
                <div style="flex:1"></div>
                <div style="display:flex;align-items:center;gap:8px">
                    <span style="
                        background:linear-gradient(135deg,#ff69b4,#ff1493);
                        color:white;
                        font-size:11px;
                        font-weight:600;
                        padding:2px 8px;
                        border-radius:20px;
                        white-space:nowrap;
                    ">👁 ${v.view_count}次</span>
                    <div>
                        <p class="vt-row-rel" style="text-align:right">${vtRelTime(v.last_visit)}</p>
                        <p class="vt-row-time" style="text-align:right">${vtFmtTime(v.last_visit)}</p>
                    </div>
                </div>
            `;

            row.insertBefore(avEl, row.firstChild);
            list.appendChild(row);
        });

        vtOpen = false;
        document.getElementById('vtList').classList.remove('open');
        document.getElementById('vtChev').classList.remove('open');
        card.style.display = 'block';
    } catch (e) {
        console.error('加载足迹失败', e);
    }
}
function hideDetail() {
    detailRequestSeq++;
    closeMapFrame();
    document.getElementById('visitorCard').style.display = 'none';
    vtOpen = false;
    document.getElementById('detailPage').style.display = 'none';

    const wrapper = document.getElementById('detailMediaWrapper');
    if (wrapper) {
        wrapper.querySelectorAll('video').forEach(v => {
            v.pause();
            v.currentTime = 0;
        });
        wrapper.innerHTML = '';
    }

    currentDetailId = null;
    currentLiked = false;
    detailSlideIdx = 0;
}

let currentLiked = false;

async function toggleLike() {
    if (!currentDetailId) return;
    try {
        const response = await fetch(`${API_BASE}/media/${currentDetailId}/like`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: DEVICE_ID })
        });
        const result = await response.json();
        if (result.success) {
            document.getElementById('likeCount').textContent = result.likes;
            currentLiked = result.liked;
            updateLikeBtnUI();
        }
    } catch (error) {
        console.error('点赞错误:', error);
    }
}

function updateLikeBtnUI() {
    const btn = document.getElementById('likeBtn');
    if (!btn) return;
    btn.classList.toggle('liked', currentLiked);
}

/* ===== 点赞过的 ===== */
let likedCurrentPage = 1;
const likedItemsPerPage = 6;

async function showLikedPosts() {
    hidePetMenu();
    likedCurrentPage = 1;
    document.getElementById('likedModal').style.display = 'flex';
    await loadLikedPage();
}

async function loadLikedPage() {
    const grid = document.getElementById('likedGrid');
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#999;padding:20px;">加载中...</div>';
    document.getElementById('likedPagination').style.display = 'none';
    try {
        const res = await fetch(`${API_BASE}/liked/${DEVICE_ID}?page=${likedCurrentPage}&limit=${likedItemsPerPage}`);
        const result = await res.json();
        if (result.success && result.data.length) {
            grid.innerHTML = '';
            result.data.forEach(item => {
                const isVideo = item.type === 'video';
                const cover = isVideo
                    ? (item.thumbnail ? API_BASE + item.thumbnail : './mr.jpg')
                    : API_BASE + item.url;
                const coverAttr = /^https?:/.test(cover) ? 'data-cache-src' : 'src';
                const card = document.createElement('div');
                card.style.cssText = 'border-radius:12px;overflow:hidden;cursor:pointer;position:relative;background:#fdf2f8;';
                card.innerHTML = `
                    <img ${coverAttr}="${cover}" style="width:100%;height:100px;object-fit:cover;display:block;" onerror="this.src='./mr.jpg'">
                    <div style="padding:6px 8px;font-size:12px;color:#666;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.description || ''}</div>
                    <div style="padding:0 8px 8px;display:flex;align-items:center;gap:4px;font-size:11px;color:#ff69b4;">💖 ${item.likes}</div>
                    ${isVideo ? '<div style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.5);color:white;font-size:10px;padding:2px 6px;border-radius:8px;">▶</div>' : ''}
                `;
                card.onclick = () => {
                    hideLikedPosts();
                    if (document.getElementById('mainPage').style.display !== 'block') {
                        document.getElementById('loginPage').style.display = 'none';
                        document.getElementById('mainPage').style.display = 'block';
                    }
                    showDetail(item.id);
                };
                grid.appendChild(card);
            });

            const totalPages = result.total_pages || 1;
            document.getElementById('likedPageInfo').textContent = `${likedCurrentPage} / ${totalPages}`;
            document.getElementById('likedPrevBtn').disabled = likedCurrentPage <= 1;
            document.getElementById('likedNextBtn').disabled = likedCurrentPage >= totalPages;
            document.getElementById('likedPagination').style.display = totalPages > 1 ? 'flex' : 'none';
        } else {
            grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#999;padding:30px 10px;">还没有点赞过任何内容哦～</div>';
        }
    } catch (e) {
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#dc3545;padding:20px;">加载失败，请稍后重试</div>';
    }
}

function likedPrevPage() {
    if (likedCurrentPage > 1) {
        likedCurrentPage--;
        loadLikedPage();
    }
}

function likedNextPage() {
    likedCurrentPage++;
    loadLikedPage();
}

function hideLikedPosts() {
    document.getElementById('likedModal').style.display = 'none';
}

/* ===== 评论 ===== */
function waitForAiReply(prevCount) {
    const id = currentDetailId;
    let tries = 0;
    const timer = setInterval(async () => {
        tries++;
        if (currentDetailId !== id || tries > 8) { clearInterval(timer); return; }
        try {
            const res = await fetch(`${API_BASE}/media/${id}?device_id=${encodeURIComponent(DEVICE_ID)}`);
            const r = await res.json();
            if (r.success && r.data.comments.length > prevCount) {
                clearInterval(timer);
                LocalCache.writeJSON(`detail_${id}.json`, r.data);
                document.getElementById('commentCount').textContent = r.data.comments.length;
                renderComments(r.data.comments);
                fetch(`${API_BASE}/media/${id}/read`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ device_id: DEVICE_ID })
                }).then(() => loadTotalUnreadCount()).catch(() => {});
            }
        } catch (e) {}
    }, 3000);
}
async function addComment() {
    const input = document.getElementById('commentInput');
    let text = input.value.trim();

    if (!text && !pendingStickerUrl && !pendingVoiceUrl) return;

    const replyTarget = pendingReplyTo;
    if (replyTarget) text = `回复 @${replyTarget.name}：${text}`;

    const loc = await getCurrentLocation();

    try {
        const response = await fetch(`${API_BASE}/media/${currentDetailId}/comment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: text,
                sticker_url: pendingStickerUrl || '',
                device_id: DEVICE_ID,
                parent_id: replyTarget ? replyTarget.id : null,
                voice_url: pendingVoiceUrl || '',
                voice_duration: pendingVoiceDuration || 0,
                lat: loc ? loc.lat : null,
                lon: loc ? loc.lon : null,
            })
        });
        const result = await response.json();

        if (!result.success) {
            alert(result.message || '评论失败');
            return;
        }

        input.value = '';
        clearPendingSticker();
        clearPendingVoice();
        cancelReply();

        if (result.total_comments != null) {
            document.getElementById('commentCount').textContent = result.total_comments;
        }

        let finalComments = null;

        if (Array.isArray(result.comments) && result.comments.length > 0) {
            finalComments = result.comments;
        }

        try {
            const detailRes = await fetch(
                `${API_BASE}/media/${currentDetailId}?device_id=${encodeURIComponent(DEVICE_ID)}`
            );
            const detailData = await detailRes.json();
            if (detailData.success
                && Array.isArray(detailData.data.comments)
                && detailData.data.comments.length > 0) {
                finalComments = detailData.data.comments;
                LocalCache.writeJSON(`detail_${currentDetailId}.json`, detailData.data);
            }
        } catch (e) {
            console.warn('重新拉取详情失败，保留原评论列表', e);
        }

        if (finalComments && finalComments.length > 0) {
            renderComments(finalComments);
            document.getElementById('commentCount').textContent = finalComments.length;
        } else {
            console.warn('未获取到完整评论数据，保留现有列表');
        }

        setTimeout(() => {
            const list = document.getElementById('commentsList');
            if (list) list.scrollTop = 0;
        }, 60);

        if (replyTarget && replyTarget.name === '小芒果') {
            waitForAiReply(finalComments ? finalComments.length : 0);
        }
    } catch (error) {
        console.error('评论错误:', error);
        alert('评论失败，请稍后重试');
    }
}
let pendingStickerUrl = null;
let stickerCache = [];
let pendingReplyTo = null;

function replyToComment(commentId, authorName) {
    pendingReplyTo = { id: commentId, name: authorName || '神秘人' };
    document.getElementById('replyIndicatorName').textContent = '@' + pendingReplyTo.name;
    document.getElementById('replyIndicatorBar').style.display = 'flex';
    document.getElementById('commentInput').focus();
}

function cancelReply() {
    pendingReplyTo = null;
    document.getElementById('replyIndicatorBar').style.display = 'none';
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : str;
    return div.innerHTML;
}

/* ===== 表情包 ===== */
async function showStickerPicker() {
    document.getElementById('stickerModal').classList.add('show');
    await loadStickers();
}

function hideStickerPicker() {
    document.getElementById('stickerModal').classList.remove('show');
    if (stickerManageMode) {
        stickerManageMode = false;
        const btn = document.getElementById('stickerManageBtn');
        if (btn) {
            btn.textContent = '管理';
            btn.style.background = 'rgba(255,105,180,0.15)';
            btn.style.color = '#d63384';
            btn.style.border = '1.5px solid #ffb6c1';
        }
    }
}

async function loadStickers() {
    const grid = document.getElementById('stickerGrid');
    const key = `stickers_${DEVICE_ID}.json`;

    let local = null;
    try {
        local = await LocalCache.readJSON(key);
    } catch (e) {
        console.warn('本地表情包缓存读取失败，跳过', e);
    }
    const hasLocal = Array.isArray(local);
    if (hasLocal) {
        stickerCache = local;
        renderStickerGrid();
    } else {
        grid.innerHTML = '<div class="sticker-grid-empty">加载中...</div>';
    }

    try {
        const res = await fetch(`${API_BASE}/stickers/${DEVICE_ID}`);
        const result = await res.json();
        const fresh = result.success ? result.data : [];
        LocalCache.writeJSON(key, fresh);
        if (!hasLocal || JSON.stringify(fresh) !== JSON.stringify(local)) {
            stickerCache = fresh;
            renderStickerGrid();
        }
    } catch (e) {
        if (!hasLocal) grid.innerHTML = '<div class="sticker-grid-empty">加载失败</div>';
    }
}

let stickerManageMode = false;

function toggleStickerManageMode() {
    stickerManageMode = !stickerManageMode;
    const btn = document.getElementById('stickerManageBtn');
    if (btn) {
        btn.textContent = stickerManageMode ? '完成' : '管理';
        btn.style.background = stickerManageMode
            ? 'linear-gradient(135deg,#ff69b4,#ff1493)'
            : 'rgba(255,105,180,0.15)';
        btn.style.color = stickerManageMode ? 'white' : '#d63384';
        btn.style.border = stickerManageMode ? 'none' : '1.5px solid #ffb6c1';
    }
    renderStickerGrid();
}

function renderStickerGrid() {
    const grid = document.getElementById('stickerGrid');
    if (!stickerCache.length) {
        grid.innerHTML = '<div class="sticker-grid-empty">还没有表情包，点下面上传吧～</div>';
        return;
    }
    grid.innerHTML = '';
    stickerCache.forEach(s => {
        const item = document.createElement('div');
        item.className = 'sticker-grid-item';

        const inner = document.createElement('div');
        inner.className = 'sticker-grid-item-inner';
        inner.style.position = 'relative';
        inner.innerHTML = `<img data-cache-src="${API_BASE}${s.url}" loading="lazy">`;

        if (stickerManageMode) {
            const delBtn = document.createElement('div');
            delBtn.style.cssText = `
                position:absolute;top:-6px;right:-6px;
                width:20px;height:20px;border-radius:50%;
                background:linear-gradient(135deg,#ff69b4,#ff1493);
                color:white;font-size:13px;font-weight:700;
                display:flex;align-items:center;justify-content:center;
                box-shadow:0 2px 6px rgba(0,0,0,0.25);
                cursor:pointer;z-index:20;line-height:1;
                border:1.5px solid white;
            `;
            delBtn.textContent = '×';
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm('删除这个表情包吗？')) {
                    deleteSticker(s.id, item);
                }
            });
            inner.style.border = '2px solid #ffb6c1';
            inner.appendChild(delBtn);
            inner.addEventListener('click', () => {
                if (confirm('删除这个表情包吗？')) {
                    deleteSticker(s.id, item);
                }
            });
        } else {
            inner.addEventListener('click', () => selectSticker(s.url));

            let pressTimer = null;
            const startPress = () => {
                pressTimer = setTimeout(() => {
                    pressTimer = null;
                    if (confirm('删除这个表情包吗？')) {
                        deleteSticker(s.id, item);
                    }
                }, 600);
            };
            const cancelPress = () => {
                if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
            };
            inner.addEventListener('mousedown', startPress);
            inner.addEventListener('touchstart', startPress, { passive: true });
            inner.addEventListener('mouseup', cancelPress);
            inner.addEventListener('mouseleave', cancelPress);
            inner.addEventListener('touchend', cancelPress);
            inner.addEventListener('touchcancel', cancelPress);
        }

        item.appendChild(inner);
        grid.appendChild(item);
    });
}
function finishGroupUpload() {
    if (multiSelectOn && groupFileCount > 0) {
        showStickerToast(`本组共 ${groupFileCount} 个文件已发布为同一帖子`);
    }
    document.getElementById('multiSelectToggle').checked = false;
    multiSelectOn = false;
    currentGroupId = null;
    groupFileCount = 0;
    document.getElementById('multiSelectTrack').style.background = '#ccc';
    document.getElementById('multiSelectThumb').style.transform = 'translateX(0)';
    document.getElementById('multiSelectHint').textContent = '开启后连续上传归为同一帖子';
    hideUploadModal();
    currentPage = 1;
    loadMediaData();
}
async function deleteSticker(stickerId, itemEl) {
    try {
        const res = await fetch(`${API_BASE}/stickers/${DEVICE_ID}/${stickerId}`, {
            method: 'DELETE'
        });
        const result = await res.json();
        if (result.success) {
            stickerCache = stickerCache.filter(s => s.id !== stickerId);
            LocalCache.writeJSON(`stickers_${DEVICE_ID}.json`, stickerCache);
            itemEl.remove();
            if (!stickerCache.length) {
                document.getElementById('stickerGrid').innerHTML =
                    '<div class="sticker-grid-empty">还没有表情包，点下面上传吧～</div>';
            }
            showStickerToast('表情包已删除 🗑️');
        } else {
            showStickerToast(result.message || '删除失败');
        }
    } catch (e) {
        showStickerToast('删除失败，请稍后重试');
    }
}
async function uploadSticker() {
    const file = document.getElementById('stickerFileInput').files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('device_id', DEVICE_ID);
    try {
        const res = await fetch(`${API_BASE}/stickers/upload`, { method: 'POST', body: formData });
        const result = await res.json();
        if (result.success) {
            await loadStickers();
            LocalCache.syncStickers(API_BASE, DEVICE_ID);
        } else {
            alert('上传失败：' + result.message);
        }
    } catch (e) {
        alert('上传失败，请稍后重试');
    }
    document.getElementById('stickerFileInput').value = '';
}

function selectSticker(url) {
    pendingStickerUrl = url;
    setCachedSrc(document.getElementById('stickerPreviewImg'), `${API_BASE}${url}`);
    document.getElementById('stickerPreviewBar').style.display = 'flex';
    hideStickerPicker();
}

function clearPendingSticker() {
    pendingStickerUrl = null;
    document.getElementById('stickerPreviewBar').style.display = 'none';
}

function buildCommentHtml(comment, isReply, rootId) {
    const hasAvatar = !!comment.commenter_avatar;
    const avatarSrc = hasAvatar
        ? (comment.commenter_avatar.startsWith('/') ? API_BASE + comment.commenter_avatar : comment.commenter_avatar)
        : DEFAULT_AVATAR_URL;
    const avatarAttr = (hasAvatar && /^https?:/.test(avatarSrc)) ? 'data-cache-src' : 'src';

    const stickerHtml = comment.sticker_url
        ? `<div class="comment-sticker-wrap" data-sticker-url="${comment.sticker_url}" title="点击收藏到我的表情包">
            <img class="comment-sticker" data-cache-src="${API_BASE}${comment.sticker_url}">
            <span class="comment-sticker-collect-hint">+</span>
           </div>`
        : '';

    const voiceHtml = comment.voice_url
        ? `<div class="voice-row" data-voice-url="${API_BASE}${comment.voice_url}">
            <span class="vr-play">▶</span>
            <span class="vr-bar"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
            <span class="vr-dur">${comment.voice_duration || 0}"</span>
           </div>`
        : '';

    const locHtml = (comment.location || comment.weather)
        ? `<span class="loc-weather">${comment.location ? '📍' + escapeHtml(comment.location) : ''}${comment.weather ? ' <span class="wx">' + escapeHtml(comment.weather) + '</span>' : ''}</span>`
        : '';
    const textHtml = comment.text
        ? `<p class="comment-text">${escapeHtml(comment.text)}</p>`
        : '';

    const deleteBtn = comment.is_mine
        ? `<button class="comment-delete-btn" title="删除评论" onclick="deleteComment(${comment.id}, this)">🗑</button>`
        : '';

    let readersHtml = '';
    if (comment.is_mine && comment.readers && comment.readers.length > 0) {
        const avatarImgs = comment.readers.map(r => {
            const src = r.avatar_url
                ? (r.avatar_url.startsWith('/') ? API_BASE + r.avatar_url : r.avatar_url)
                : DEFAULT_AVATAR_URL;
            const attr = (r.avatar_url && /^https?:/.test(src)) ? 'data-cache-src' : 'src';
            return `<img class="reader-avatar" ${attr}="${src}" data-name="${r.nickname}"
                     title="${r.nickname} 已读"
                     onerror="this.onerror=null;this.src='${defaultAvatarDataUri}'">`;
        }).join('');
        readersHtml = `<div class="comment-readers"><span class="readers-label">已读</span>${avatarImgs}</div>`;
    }

    const unreadDot = comment.is_unread ? `<span class="comment-unread-dot"></span>` : '';

    return `
        <div class="comment-author">
            <img class="comment-avatar" ${avatarAttr}="${avatarSrc}"
                 onerror="this.onerror=null;this.src='${defaultAvatarDataUri}'">
            <span class="comment-author-name">${escapeHtml(comment.commenter_name || '神秘人')}</span>
            ${unreadDot}
            <button class="comment-reply-btn" data-comment-id="${rootId != null ? rootId : comment.id}" data-author-name="${escapeHtml(comment.commenter_name || '神秘人')}">↩ 回复</button>
            ${deleteBtn}
        </div>
        ${textHtml}
        ${voiceHtml}
        ${stickerHtml}
        ${readersHtml}
        <p class="comment-date">${comment.date} ${locHtml}</p>
    `;
}
function updateUnreadBadge(comments) {
    const badge = document.getElementById('unreadBadge');
    if (!badge) return;
    const unreadCount = comments.filter(c => c.is_unread).length;
    if (unreadCount > 0) {
        badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
}

function scrollToFirstUnread() {
    const list = document.getElementById('commentsList');
    if (!list) return;
    const first = list.querySelector('.is-unread');
    if (first) {
        first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}
function renderComments(comments) {
    const list = document.getElementById('commentsList');

    if (!Array.isArray(comments) || comments.length === 0) {
        list.innerHTML = '';
        updateUnreadBadge([]);
        checkDetailBgOverflow();
        return;
    }

    updateUnreadBadge(comments);
    list.innerHTML = '';

    const topLevel = comments.filter(c => !c.parent_id);
    const repliesByParent = {};
    comments.filter(c => c.parent_id).forEach(c => {
        if (!repliesByParent[c.parent_id]) repliesByParent[c.parent_id] = [];
        repliesByParent[c.parent_id].push(c);
    });

    const topLevelSorted = [...topLevel].reverse();

    topLevelSorted.forEach(comment => {
        const commentItem = document.createElement('div');
        commentItem.className = 'comment-item' + (comment.is_unread ? ' is-unread' : '');
        commentItem.dataset.commentId = comment.id;
        commentItem.innerHTML = buildCommentHtml(comment, false, comment.id);

        const replies = repliesByParent[comment.id] || [];
        if (replies.length > 0) {
            const repliesWrap = document.createElement('div');
            repliesWrap.className = 'comment-replies';
            replies.forEach(reply => {
                const replyItem = document.createElement('div');
                replyItem.className = 'comment-reply-item' + (reply.is_unread ? ' is-unread' : '');
                replyItem.dataset.commentId = reply.id;
                replyItem.innerHTML = buildCommentHtml(reply, true, comment.id);
                repliesWrap.appendChild(replyItem);
            });
            repliesWrap.classList.add('collapsed');
            commentItem.appendChild(repliesWrap);

            const toggleBtn = document.createElement('button');
            toggleBtn.className = 'replies-toggle-btn';
            toggleBtn.innerHTML = `<span class="replies-toggle-icon open">▾</span><span class="replies-toggle-text">收起 ${replies.length} 条回复</span>`;
            toggleBtn.addEventListener('click', () => {
                const collapsed = repliesWrap.classList.toggle('collapsed');
                toggleBtn.querySelector('.replies-toggle-icon').classList.toggle('open', !collapsed);
                toggleBtn.querySelector('.replies-toggle-text').textContent = collapsed
                    ? `展开 ${replies.length} 条回复`
                    : `收起 ${replies.length} 条回复`;
            });
            commentItem.appendChild(toggleBtn);
        }

        list.appendChild(commentItem);
    });

    list.querySelectorAll('.comment-sticker-wrap').forEach(wrap => {
        wrap.addEventListener('click', () => {
            collectStickerFromComment(wrap.dataset.stickerUrl, wrap);
        });
    });

    list.querySelectorAll('.voice-row').forEach(row => {
        row.addEventListener('click', () => {
            const url = row.dataset.voiceUrl;

            document.querySelectorAll('.voice-row.playing').forEach(r => {
                if (r !== row) {
                    r.classList.remove('playing');
                    r.querySelector('.vr-play').textContent = '▶';
                    if (r._audio) { r._audio.pause(); r._audio.currentTime = 0; }
                }
            });

            if (row._audio && !row._audio.paused) {
                row._audio.pause();
                row._audio.currentTime = 0;
                row.classList.remove('playing');
                row.querySelector('.vr-play').textContent = '▶';
                return;
            }

            if (!row._audio) {
                row._audio = new Audio(url);
                row._audio.addEventListener('ended', () => {
                    row.classList.remove('playing');
                    row.querySelector('.vr-play').textContent = '▶';
                });
            }
            row._audio.play().catch(() => {});
            row.classList.add('playing');
            row.querySelector('.vr-play').textContent = '⏸';
        });
    });

    list.querySelectorAll('.comment-reply-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            replyToComment(btn.dataset.commentId, btn.dataset.authorName);
        });
    });

    checkDetailBgOverflow();
}
checkDetailBgOverflow();
async function deleteComment(commentId, btnEl) {
    if (!confirm('确定删除这条评论吗？')) return;
    try {
        btnEl.disabled = true;
        const res = await fetch(`${API_BASE}/comment/${commentId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: DEVICE_ID })
        });
        const result = await res.json();
        if (result.success) {
            document.getElementById('commentCount').textContent = result.total_comments;
            renderComments(result.comments);
            if (currentDetailId != null) {
                LocalCache.readJSON(`detail_${currentDetailId}.json`).then(d => {
                    if (d && Array.isArray(result.comments)) {
                        d.comments = result.comments;
                        LocalCache.writeJSON(`detail_${currentDetailId}.json`, d);
                    }
                }).catch(() => {});
            }
        } else {
            alert(result.message || '删除失败');
            btnEl.disabled = false;
        }
    } catch (e) {
        alert('网络错误，请稍后重试');
        btnEl.disabled = false;
    }
}
async function collectStickerFromComment(stickerUrl, triggerEl) {
    if (!stickerUrl) return;
    try {
        if (triggerEl) triggerEl.classList.add('collecting');
        const res = await fetch(`${API_BASE}/stickers/collect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: DEVICE_ID, source_url: stickerUrl })
        });
        const result = await res.json();
        if (result.success) {
            showStickerToast(result.already_collected ? '这个表情包你已经有啦～' : '已收藏到我的表情包 💕');
            LocalCache.syncStickers(API_BASE, DEVICE_ID);
        } else {
            showStickerToast(result.message || '收藏失败，请稍后重试');
        }
    } catch (e) {
        console.error('收藏表情包失败:', e);
        showStickerToast('收藏失败，请稍后重试');
    } finally {
        if (triggerEl) triggerEl.classList.remove('collecting');
    }
}

let stickerToastTimer = null;

function showStickerToast(message) {
    let toast = document.getElementById('stickerToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'stickerToast';
        toast.className = 'sticker-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    requestAnimationFrame(() => toast.classList.add('show'));
    clearTimeout(stickerToastTimer);
    stickerToastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}

function showError(message) {
    const grid = document.getElementById('mediaGrid');
    grid.innerHTML = `<div class="error">${message}</div>`;
    grid.style.display = 'block';
}

/* ===== 搜索 ===== */
async function performSearch() {
    const query = document.getElementById('searchInput').value.trim();
    if (query === '摄像头') {
        window.location.href = './love.html';
        return;
    }
    if (query === '看视频') {
        window.location.href = './hsa.html';
        return;
    }
    if (query === '宝宝') {
        window.location.href = 'http://43.167.237.62:7800';
        return;
    }
    if (!query) {
        window.location.href = "./admin.html";
        return;
    }
    currentPage = 1;
    try {
        document.getElementById('loading').style.display = 'block';
        document.getElementById('mediaGrid').style.display = 'none';
        document.getElementById('pagination').style.display = 'none';
        const response = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}&page=${currentPage}&limit=${itemsPerPage}&device_id=${encodeURIComponent(DEVICE_ID)}`);
        const result = await response.json();
        if (result.success) {
            isSearchMode = true;
            searchQuery = query;
            document.getElementById('clearSearchBtn').style.display = 'block';
            if (result.data.length > 0) {
                mediaData = result.data;
                renderMediaGrid(result.data);
                updatePagination(result.total_pages, result.current_page);
                showSearchInfo(`找到 ${result.total} 条相关记录`);
            } else {
                showNoResults();
            }
        } else {
            showError('搜索失败：' + result.message);
        }
    } catch (error) {
        console.error('搜索错误:', error);
        showError('搜索失败，请稍后重试');
    } finally {
        document.getElementById('loading').style.display = 'none';
    }
}

function showSearch() {
    hidePetMenu();
    window.location.href = 'http://www.lujiandong.cn';
}

function playVideo() {
    hidePetMenu();
    window.location.href = './hsa.html';
}

function openCamera() {
    hidePetMenu();
    window.location.href = './love.html';
}

function changeBg() {
    hidePetMenu();
    const bgVideo = document.getElementById('bgVideo');
    if (!bgVideo) return;
    const bgList = ['./ok.mp4', './bg2.mp4', './bg3.mp4'];
    let currentSrc = bgVideo.querySelector('source')?.src || bgVideo.src;
    if (currentSrc.startsWith(window.location.origin)) {
        currentSrc = currentSrc.replace(window.location.origin, '');
    }
    let currentIndex = bgList.indexOf(currentSrc);
    if (currentIndex === -1) {
        currentIndex = 0;
    }
    const nextIndex = (currentIndex + 1) % bgList.length;
    bgVideo.src = bgList[nextIndex];
    bgVideo.load();
    bgVideo.play();
}

/* ===== 头像 / 资料 ===== */
async function showAvatarModal() {
    hidePetMenu();
    let hasProfile = myProfile.nickname && myProfile.nickname !== '神秘人';
    if (!hasProfile) {
        const ok = await tryPickExistingProfile();
        if (ok) {
            if (isSearchMode) { performSearchWithPage(); } else { loadMediaData(); }
            return;
        }
    }
    document.getElementById('avatarModal').classList.add('show');
    document.getElementById('avatarNameInput').value =
        myProfile.nickname && myProfile.nickname !== '神秘人' ? myProfile.nickname : '';
    const circle = document.getElementById('avatarUploadCircle');
    if (myProfile.avatar_url) {
        const url = myProfile.avatar_url.startsWith('/') ? `${API_BASE}${myProfile.avatar_url}` : myProfile.avatar_url;
        circle.style.backgroundImage = '';
        circle.innerHTML = '';
        cacheImage(url).then(u => { circle.style.backgroundImage = `url(${u})`; });
    } else {
        circle.style.backgroundImage = '';
        circle.innerHTML = '📷';
    }

    const keyInput = document.getElementById('wechatKeyInput');
    const keyHint  = document.getElementById('wechatKeyHint');
    keyInput.value = '';
    if (myProfile.wechat_bound) {
        keyInput.placeholder = `已绑定 ${myProfile.wechat_masked}`;
        keyHint.textContent = '留空则不修改;输入「解绑」可取消微信通知';
    } else {
        keyInput.placeholder = '微信通知密钥(可选)';
        keyHint.textContent = '在 sct.ftqq.com 微信扫码获取 SendKey,并关注"方糖"公众号';
    }

    pendingAvatarFile = null;
}

async function tryPickExistingProfile() {
    try {
        const res = await fetch(`${API_BASE}/profiles?exclude=${DEVICE_ID}`);
        const result = await res.json();
        if (!result.success || !result.data.length) return false;
        const list = result.data.map((p, i) =>
            `${i + 1}. ${p.nickname}`
        ).join('\n');
        const pick = prompt(
            `检测到这些已有身份，输入序号即可共用 ta 的头像和昵称（取消则新建自己的资料）：\n${list}`
        );
        if (!pick) return false;
        const idx = parseInt(pick, 10) - 1;
        const target = result.data[idx];
        if (!target) return false;
        const linkRes = await fetch(`${API_BASE}/profile/link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: DEVICE_ID, target_device_id: target.device_id })
        });
        const linkResult = await linkRes.json();
        if (linkResult.success) {
            myProfile.nickname = linkResult.nickname;
            myProfile.avatar_url = linkResult.avatar_url;
            LocalCache.writeJSON('profile.json', Object.assign({ device_id: DEVICE_ID }, myProfile));
            return true;
        }
        return false;
    } catch (e) {
        console.error('选择已有身份失败:', e);
        return false;
    }
}

function hideAvatarModal() {
    document.getElementById('avatarModal').classList.remove('show');
}

function previewAvatarFile() {
    const file = document.getElementById('avatarFileInput').files[0];
    if (!file) return;
    pendingAvatarFile = file;
    const reader = new FileReader();
    reader.onload = function (e) {
        const circle = document.getElementById('avatarUploadCircle');
        circle.style.backgroundImage = `url(${e.target.result})`;
        circle.innerHTML = '';
    };
    reader.readAsDataURL(file);
}

async function saveProfile() {
    const nickname = document.getElementById('avatarNameInput').value.trim();
    if (!nickname) {
        alert('请给自己起个昵称呀~');
        return;
    }
    const formData = new FormData();
    formData.append('device_id', DEVICE_ID);
    formData.append('nickname', nickname);
    if (pendingAvatarFile) {
        formData.append('avatar', pendingAvatarFile);
    }

    const wechatKey = document.getElementById('wechatKeyInput').value.trim();
    if (wechatKey) {
        formData.append('wechat_key', wechatKey);
    }

    try {
        const response = await fetch(`${API_BASE}/profile`, {
            method: 'POST',
            body: formData
        });
        const result = await response.json();
        if (result.success) {
            myProfile.nickname      = result.nickname;
            myProfile.avatar_url    = result.avatar_url;
            myProfile.wechat_bound  = !!result.wechat_bound;
            myProfile.wechat_masked = result.wechat_masked || '';
            LocalCache.writeJSON('profile.json', Object.assign({ device_id: DEVICE_ID }, myProfile));
            updateAvatarUI();

            if (wechatKey === '解绑') {
                showStickerToast('已取消微信通知');
            } else if (wechatKey && result.wechat_bound) {
                showStickerToast('微信通知已绑定 ✅');
            }

            hideAvatarModal();
            if (isSearchMode) {
                performSearchWithPage();
            } else {
                loadMediaData();
            }
        } else {
            alert('保存失败:' + result.message);
        }
    } catch (error) {
        console.error('保存头像错误:', error);
        alert('保存失败,请稍后重试');
    }
}

function clearSearch() {
    isSearchMode = false;
    searchQuery = '';
    currentPage = 1;
    document.getElementById('searchInput').value = '';
    document.getElementById('clearSearchBtn').style.display = 'none';
    const searchInfo = document.querySelector('.search-results-info');
    if (searchInfo) {
        searchInfo.remove();
    }
    loadMediaData();
}

function showSearchInfo(message) {
    const existingInfo = document.querySelector('.search-results-info');
    if (existingInfo) {
        existingInfo.remove();
    }
    const info = document.createElement('div');
    info.className = 'search-results-info';
    info.textContent = message;
    const content = document.querySelector('.content');
    content.insertBefore(info, content.firstChild);
}

function showNoResults() {
    const grid = document.getElementById('mediaGrid');
    grid.innerHTML = `
        <div class="no-results">
            <div class="no-results-icon">🔍</div>
            <h3>没有找到相关内容</h3>
            <p>试试其他关键词或日期吧🤗</p>
        </div>
    `;
    grid.style.display = 'block';
}

async function performSearchWithPage() {
    try {
        document.getElementById('loading').style.display = 'block';
        document.getElementById('mediaGrid').style.display = 'none';
        const response = await fetch(`${API_BASE}/search?q=${encodeURIComponent(searchQuery)}&page=${currentPage}&limit=${itemsPerPage}&device_id=${encodeURIComponent(DEVICE_ID)}`);
        const result = await response.json();
        if (result.success) {
            mediaData = result.data;
            renderMediaGrid(result.data);
            updatePagination(result.total_pages, result.current_page);
        }
    } catch (error) {
        console.error('搜索分页错误:', error);
        showError('加载失败，请稍后重试');
    } finally {
        document.getElementById('loading').style.display = 'none';
    }
}

/* ===== 滑动手势 ===== */
function initSwipeListeners() {
    const mainPage = document.getElementById('mainPage');
    if (mainPage && !mainPage.dataset.swipeBound) {
        mainPage.dataset.swipeBound = '1';
        mainPage.addEventListener('touchstart', handleTouchStart, { passive: false });
        mainPage.addEventListener('touchend', handleTouchEnd, { passive: false });
    }
    const detailPage = document.getElementById('detailPage');
    if (detailPage && !detailPage.dataset.swipeBound) {
        detailPage.dataset.swipeBound = '1';
        detailPage.addEventListener('touchstart', handleDetailTouchStart, { passive: false });
        detailPage.addEventListener('touchend', handleDetailTouchEnd, { passive: false });
    }
}

function handleTouchStart(e) {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
}

function handleTouchEnd(e) {
    touchEndX = e.changedTouches[0].screenX;
    touchEndY = e.changedTouches[0].screenY;
    handleMainPageSwipe();
}

function handleDetailTouchStart(e) {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
}

function handleDetailTouchEnd(e) {
    touchEndX = e.changedTouches[0].screenX;
    touchEndY = e.changedTouches[0].screenY;
    handleDetailPageSwipe();
}

function handleMainPageSwipe() {
    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > minSwipeDistance) {
        if (deltaX > 0) {
            if (currentPage > 1) {
                previousPage();
            }
        } else {
            const pageInfo = document.getElementById('pageInfo').textContent;
            const totalPages = parseInt(pageInfo.split(' / ')[1]);
            if (currentPage < totalPages) {
                nextPage();
            }
        }
    }
}

function handleDetailPageSwipe() {
    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > minSwipeDistance) {
        if (deltaX > 0) {
            hideDetail();
        }
    }
}

/* ===== 登录 ===== */
async function loginWithSwipe() {
    const name = "陆";
    const errorMsg = document.getElementById('errorMsg');
    try {
        const response = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name: name })
        });
        const result = await response.json();
        if (result.success) {
            enterMainPage();
        } else {
            errorMsg.style.display = 'block';
            setTimeout(() => {
                errorMsg.style.display = 'none';
            }, 3000);
        }
    } catch (error) {
        console.error('登录错误:', error);
        let cached = null;
        try {
            cached = await LocalCache.readJSON('media_p1.json');
        } catch (e) {
            console.warn('本地缓存也读不出来', e);
        }
        if (cached && Array.isArray(cached.data) && cached.data.length) {
            showStickerToast('网络不可用，正在显示本地缓存');
            enterMainPage();
        } else {
            errorMsg.textContent = '网络错误，请稍后重试';
            errorMsg.style.display = 'block';
        }
    }
}

/* ★ 关键：三个任务并行，谁也不等谁 */
async function enterMainPage() {
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('mainPage').style.display = 'block';
    initSwipeListeners();

    // loadMyProfile 里要请求 3800 ZC 服务，慢的话不能拖累帖子列表和周信
    loadMyProfile().catch(e => console.warn('加载资料失败', e));
    loadMediaData();
    checkWeeklyLetter();
}

function initHeaderTitleBounce() {
    const el = document.getElementById('v8');
    if (!el) return;
    const text = el.textContent;
    el.innerHTML = text.split('').map((ch, i) => {
        const displayCh = ch === ' ' ? '&nbsp;' : ch;
        return `<span class="header-title-letter" style="animation-delay:${i * 0.08}s">${displayCh}</span>`;
    }).join('');
}

/* =========================================
   ★ 小芒果的周信（之前被删掉了，现补回）
   ========================================= */
let currentLetter = null;
let letterShowing = false;

async function checkWeeklyLetter() {
    if (letterShowing) return;
    try {
        const res = await fetchTimeout(`${API_BASE}/weekly-letter?test=1`, {}, 10000);
        const r = await res.json();
        if (!r.success || !r.available) return;
        const L = r.letter;
        if (!L || !L.week_start) return;

        // ★ 无论本周有没有开过，先把这封信归档一次（幂等）
        archiveLetterFromData(L);

        if (localStorage.getItem('letter_opened') === L.week_start) return;

        currentLetter = L;
        showEnvelope();
    } catch (e) {
        console.warn('检查周信失败', e);
    }
}
function showEnvelope() {
    if (!currentLetter) return;
    const overlay = document.getElementById('letterOverlay');
    const env = document.getElementById('env');
    const envStage = document.getElementById('envStage');
    const letterCard = document.getElementById('letterCard');
    if (!overlay || !env || !envStage || !letterCard) {
        console.warn('信封 HTML 元素缺失，检查 life2.html 里是否包含 #letterOverlay');
        return;
    }
    letterShowing = true;
    env.classList.remove('open');
    envStage.style.display = 'flex';
    letterCard.classList.remove('show');
    overlay.classList.add('show');
    if (typeof spawnHearts === 'function') spawnHearts(16);
}

function openEnvelope() {
    const env = document.getElementById('env');
    if (!env || env.classList.contains('open') || !currentLetter) return;
    env.classList.add('open');
    if (typeof spawnHearts === 'function') spawnHearts(24);
    if (navigator.vibrate) navigator.vibrate(60);

    document.getElementById('letterBody').textContent = currentLetter.content;
    document.getElementById('letterDate').textContent = currentLetter.date_text;
    localStorage.setItem('letter_opened', currentLetter.week_start);

    // ★ 立刻归档（不等 setTimeout）
    archiveLetterFromData(currentLetter);

    setTimeout(() => {
        document.getElementById('envStage').style.display = 'none';
        document.getElementById('letterCard').classList.add('show');
    }, 1000);
}

function closeLetter() {
    const overlay = document.getElementById('letterOverlay');
    if (overlay) overlay.classList.remove('show');
    letterShowing = false;
}

async function showLatestLetter() {
    hidePetMenu();
    try {
        const r = await (await fetch(`${API_BASE}/weekly-letter?latest=1`)).json();
        if (r.success && r.available) { currentLetter = r.letter; showEnvelope(); }
        else showStickerToast('还没有收到小芒果的信哦');
    } catch (e) { showStickerToast('加载失败，请稍后重试'); }
}

/* ===== 已看帖子 ===== */
function getSeenIds() {
    try { return new Set(JSON.parse(localStorage.getItem('seen_ids') || '[]')); }
    catch(e) { return new Set(); }
}
function markSeen(id) {
    const s = getSeenIds();
    s.add(String(id));
    const arr = [...s];
    try { localStorage.setItem('seen_ids', JSON.stringify(arr)); } catch (e) {}
    LocalCache.writeJSON('seen_ids.json', arr);
}
window.addEventListener('resize', () => {
    if (document.getElementById('detailPage').style.display === 'block') {
        checkDetailBgOverflow();
    }
});

function requestMobilePermissions() {
    const perms = window.cordova?.plugins?.permissions;
    if (!perms) return;
    const list = [
        perms.RECORD_AUDIO,
        perms.ACCESS_FINE_LOCATION,
        perms.ACCESS_COARSE_LOCATION,
    ];
    perms.requestPermissions(list,
        (s) => console.log('权限状态', s),
        () => console.warn('权限请求失败')
    );
}

/* ===== 启动 ===== */
document.getElementById('commentInput').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
        addComment();
    }
});

document.addEventListener('DOMContentLoaded', async function () {
    setupVoiceLongPress();
    requestMobilePermissions();
    initHeaderTitleBounce();
    initSwipeListeners();
    startAvatarStarLoop();
    loadTgBackgroundRatio();

    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
                performSearch();
            }
        });
    }

    await restoreLocalState();
    loadMyProfile();
    LocalCache.syncStickers(API_BASE, DEVICE_ID);

    setTimeout(() => LocalCache.trimImages().catch(() => {}), 5000);
});

document.addEventListener('deviceready', () => {
    setupVoiceLongPress();
    requestMobilePermissions();
}, false);
/* =====================================================
   往日信件：把看过的信存下来，随时回看
   ===================================================== */
const LETTER_HISTORY_KEY = 'letter_history';
const LETTER_HISTORY_MAX = 60;

function letterDateStr(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

function getLetterHistory() {
    try {
        const arr = JSON.parse(localStorage.getItem(LETTER_HISTORY_KEY) || '[]');
        return Array.isArray(arr) ? arr.filter(x => x && x.body) : [];
    } catch (e) { return []; }
}

function saveLetterHistory(arr) {
    try {
        localStorage.setItem(LETTER_HISTORY_KEY, JSON.stringify(arr.slice(0, LETTER_HISTORY_MAX)));
    } catch (e) {}
}
/* 从周信数据对象直接归档（不依赖 DOM） */
function archiveLetterFromData(L) {
    if (!L || !L.content) return;
    const body = String(L.content).trim();
    if (!body) return;

    const date = (L.date_text || '').trim() || letterDateStr(new Date());
    const head = '💌 来自小芒果的周一小信';

    const list = getLetterHistory();
    const idx = list.findIndex(x => x.date === date);

    if (idx >= 0) {
        // 已有同期，保留内容更长的那份
        if ((list[idx].body || '').length >= body.length) return;
        list[idx] = { date, head, body };
    } else {
        list.unshift({ date, head, body });
    }
    saveLetterHistory(list);
}
function archiveCurrentLetter() {
    const bodyEl = document.getElementById('letterBody');
    if (!bodyEl) return;
    const body = (bodyEl.innerText || bodyEl.textContent || '').trim();
    if (!body) return;

    const dateEl = document.getElementById('letterDate');
    const headEl = document.querySelector('#letterCard .letter-head');
    const date = ((dateEl && dateEl.innerText) || '').trim() || letterDateStr(new Date());
    const head = ((headEl && headEl.innerText) || '').trim() || '💌 来自小芒果的小信';

    const list = getLetterHistory();
    const idx = list.findIndex(x => x.date === date);

    if (idx >= 0) {
        if (list[idx].body === body) return;
        if (body.length >= (list[idx].body || '').length) {
            list[idx] = { date, head, body };
            saveLetterHistory(list);
        }
        return;
    }
    list.unshift({ date, head, body });
    saveLetterHistory(list);
}

function showLetterHistory() {
    try {
        const ov = document.getElementById('letterOverlay');
        if (ov) ov.classList.remove('show');
        if (typeof hidePetMenu === 'function') hidePetMenu();

        archiveCurrentLetter();

        const modal = document.getElementById('letterHistoryModal');
        if (!modal) {
            alert('找不到 #letterHistoryModal，请确认 HTML 已正确保存');
            return;
        }
        modal.style.display = 'flex';
        modal.style.zIndex = '999999';
        renderLetterHistory();
    } catch (e) {
        console.error('showLetterHistory 出错:', e);
        alert('打开信件出错：' + e.message);
    }
}

function hideLetterHistory() {
    const m = document.getElementById('letterHistoryModal');
    if (m) m.style.display = 'none';
}

function renderLetterHistory() {
    const listEl = document.getElementById('letterHistoryList');
    if (!listEl) return;

    const list = getLetterHistory();
    if (!list.length) {
        listEl.innerHTML = '<div class="lh-empty">还没有信件哦～<br>拆开一次信封后，信就会留在这里啦 💌</div>';
        return;
    }

    listEl.innerHTML = '';
    list.forEach((item, i) => {
        const preview = (item.body || '').replace(/\s+/g, ' ').trim();
        const card = document.createElement('div');
        card.className = 'lh-item';
        card.innerHTML = `
            <div class="lh-item-top">
                <span class="lh-item-date">${escapeHtml(item.date || '')}</span>
                <span class="lh-item-arrow">›</span>
            </div>
            <div class="lh-item-preview">${escapeHtml(preview.slice(0, 44))}${preview.length > 44 ? '…' : ''}</div>
        `;
        card.addEventListener('click', () => viewHistoryLetter(i));
        listEl.appendChild(card);
    });
}

function viewHistoryLetter(idx) {
    const item = getLetterHistory()[idx];
    if (!item) return;

    const modal  = document.getElementById('letterViewModal');
    const cardEl = document.getElementById('lhViewCard');
    if (!modal || !cardEl) return;

    const headEl = document.getElementById('lhViewHead');
    const bodyEl = document.getElementById('lhViewBody');
    const dateEl = document.getElementById('lhViewDate');
    if (headEl) headEl.textContent = item.head || '💌 来自小芒果的小信';
    if (bodyEl) bodyEl.textContent = item.body || '';
    if (dateEl) dateEl.textContent = item.date || '';

    hideLetterHistory();
    modal.style.display = 'flex';
    cardEl.classList.remove('show');
    void cardEl.offsetWidth;
    cardEl.classList.add('show');
}

function closeLetterView() {
    const modal  = document.getElementById('letterViewModal');
    const cardEl = document.getElementById('lhViewCard');
    if (cardEl) cardEl.classList.remove('show');
    if (modal) modal.style.display = 'none';
}

/* 拆信封后自动归档：包装已有的 openEnvelope */
(function hookOpenEnvelope() {
    if (typeof window.openEnvelope === 'function' && !window.openEnvelope.__lhHooked) {
        const orig = window.openEnvelope;
        window.openEnvelope = function () {
            const r = orig.apply(this, arguments);
            setTimeout(archiveCurrentLetter, 800);   // 等打字机写进去
            setTimeout(archiveCurrentLetter, 3000);  // 再兜底一次
            return r;
        };
        window.openEnvelope.__lhHooked = true;
        console.log('[信件] openEnvelope 已挂钩');
    }
})();
