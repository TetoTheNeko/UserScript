// ==UserScript==
// @name         力扣提交结果音效（通过 / 未通过）
// @namespace    https://leetcode.cn/
// @version      2.1.0
// @description  为力扣运行 / 提交结果播放鼓励音效；操作后临时监听结果，支持内置音色、自定义链接和本地音频。
// @author       IAmTeto
// @match        https://leetcode.cn/*
// @match        https://*.leetcode.cn/*
// @match        https://leetcode.com/*
// @match        https://*.leetcode.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_addValueChangeListener
// @noframes
// @license      GPL-3.0-only
// @downloadURL https://update.greasyfork.org/scripts/605331/%E5%8A%9B%E6%89%A3%E6%8F%90%E4%BA%A4%E7%BB%93%E6%9E%9C%E9%9F%B3%E6%95%88%EF%BC%88%E9%80%9A%E8%BF%87%20%20%E6%9C%AA%E9%80%9A%E8%BF%87%EF%BC%89.user.js
// @updateURL https://update.greasyfork.org/scripts/605331/%E5%8A%9B%E6%89%A3%E6%8F%90%E4%BA%A4%E7%BB%93%E6%9E%9C%E9%9F%B3%E6%95%88%EF%BC%88%E9%80%9A%E8%BF%87%20%20%E6%9C%AA%E9%80%9A%E8%BF%87%EF%BC%89.meta.js
// ==/UserScript==

(function () {
  'use strict';

  /* =======================================================================
   * 0. 基础工具
   * ===================================================================== */

  const LOG_PREFIX = '[LC音效]';
  let DEBUG = false;
  const log = (...a) => { if (DEBUG) console.log(LOG_PREFIX, ...a); };
  const warn = (...a) => console.warn(LOG_PREFIX, ...a);
  const now = () => Date.now();

  const store = {
    get(key, def) {
      try {
        if (typeof GM_getValue === 'function') {
          const v = GM_getValue(key, undefined);
          return v === undefined ? def : v;
        }
      } catch (e) { /* ignore */ }
      try {
        const raw = localStorage.getItem('lcsound:' + key);
        return raw === null ? def : JSON.parse(raw);
      } catch (e) { return def; }
    },
    set(key, val) {
      try {
        if (typeof GM_setValue === 'function') { GM_setValue(key, val); return true; }
      } catch (e) { /* ignore */ }
      try { localStorage.setItem('lcsound:' + key, JSON.stringify(val)); return true; }
      catch (e) { warn('保存设置或文件失败', e); return false; }
    },
  };

  const DEFAULT_SETTINGS = {
    enabled: true,
    successEnabled: true,
    errorEnabled: true,
    successSrc: 'tone:success',
    errorSrc: 'tone:error',
    volume: 80,
  };

  let settings = Object.assign({}, DEFAULT_SETTINGS, store.get('settings', {}));

  function coerceSettings() {
    const bool = (v, def) => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : def);
    const num = (v, def, lo, hi) => {
      const n = typeof v === 'number' ? v : parseFloat(v);
      return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
    };
    settings.enabled = bool(settings.enabled, true);
    settings.successEnabled = bool(settings.successEnabled, true);
    settings.errorEnabled = bool(settings.errorEnabled, true);
    settings.volume = num(settings.volume, 80, 0, 100);
    if (typeof settings.successSrc !== 'string') settings.successSrc = DEFAULT_SETTINGS.successSrc;
    if (typeof settings.errorSrc !== 'string') settings.errorSrc = DEFAULT_SETTINGS.errorSrc;
    for (const kind of ['success', 'error']) {
      const key = kind + 'Src';
      if (settings[key].startsWith('tone:') && settings[key] !== 'tone:' + kind) settings[key] = DEFAULT_SETTINGS[key];
    }
    // 清理已退役的设置项，并把设置对象收敛成固定字段
    settings = {
      enabled: settings.enabled,
      successEnabled: settings.successEnabled,
      errorEnabled: settings.errorEnabled,
      successSrc: settings.successSrc,
      errorSrc: settings.errorSrc,
      volume: settings.volume,
    };
  }
  const saveSettings = () => store.set('settings', settings);
  coerceSettings();
  saveSettings();


  /* =======================================================================
   * 1. 内置合成音（Apple 风格：纯正弦钟琴音色 + click-free 包络 + 空间感）
   *    手工合成后编码成 WAV data URL，不依赖任何外部文件或网络请求。
   * ===================================================================== */

  const SAMPLE_RATE = 44100;
  const HEAD_SILENCE = 0.006;          // 起振前沿留白：避免"啪"的一声
  const PEAK_CEIL = 0.70;              // 峰值安全上限 ≈ -3.1 dBFS
  const RMS_TARGET = {                 // 各音的目标响度（dBFS）
    success: -17.5,
    error: -16.0,
  };

  // 音色配方：A 起振、D 指数衰减、R 收尾时长；h = 泛音权重（基频/八度/十二度）
  const TIMBRE = {
    chime: { A: 0.014, D: 0.40, R: 0.28, h: [1, 0.24, 0.08, 0.03] },
    soft:  { A: 0.028, D: 0.62, R: 0.42, h: [1, 0.13, 0.03] },
  };

  // 成功：C6-E6-G6-C7 上行大三和弦琶音 + 高八度泛音轻点
  const SUCCESS_NOTES = [
    { t: 0.000, d: 0.95, f: 1046.50, g: 0.42, v: 'chime' },  // C6
    { t: 0.068, d: 1.00, f: 1318.51, g: 0.44, v: 'chime' },  // E6
    { t: 0.136, d: 1.05, f: 1567.98, g: 0.46, v: 'chime' },  // G6
    { t: 0.235, d: 1.35, f: 2093.00, g: 0.50, v: 'chime' },  // C7
    { t: 0.375, d: 0.90, f: 3135.96, g: 0.10, v: 'chime' },  // G7 轻点
  ];

  // 失败：A4 -> E4 下行纯五度，柔和温暖，明确但不尖锐
  const ERROR_NOTES = [
    { t: 0.055, d: 0.80, f: 440.00, g: 0.46, v: 'soft' },
    { t: 0.205, d: 1.05, f: 329.63, g: 0.50, v: 'soft' },
    { t: 0.205, d: 1.05, f: 164.81, g: 0.16, v: 'soft' },
  ];

  /** 升余弦淡入淡出：避免任何波形突变（爆音） */
  function smoothFade(x, fade) {
    if (x <= 0) return 0;
    if (x >= fade) return 1;
    return 0.5 - 0.5 * Math.cos((Math.PI * x) / fade);
  }

  /** 逐音符振荡器叠加：每层泛音都有完整的起振/指数衰减/收尾包络 */
  function renderNotes(notes, pad) {
    let end = 0;
    for (const n of notes) end = Math.max(end, n.t + n.d + (TIMBRE[n.v] || TIMBRE.chime).R);
    const total = Math.ceil((HEAD_SILENCE + end + pad) * SAMPLE_RATE);
    const out = new Float32Array(total);

    for (const n of notes) {
      const cfg = TIMBRE[n.v] || TIMBRE.chime;
      const start = Math.floor((HEAD_SILENCE + n.t) * SAMPLE_RATE);
      const len = Math.floor((n.d + cfg.R) * SAMPLE_RATE);
      const inc = (Math.PI * 2 * n.f) / SAMPLE_RATE;
      const h = cfg.h;

      for (let i = 0; i < len; i++) {
        const idx = start + i;
        if (idx >= total) break;
        const s = i / SAMPLE_RATE;

        const env =
          smoothFade(s, cfg.A) *
          Math.exp(-s / cfg.D) *
          smoothFade(n.d + cfg.R - s, cfg.R);
        if (env < 1e-5) continue;

        const ph = inc * i;
        let v = 0;
        for (let k = 0; k < h.length; k++) v += h[k] * Math.sin(ph * (k + 1));
        out[idx] += v * env * n.g;
      }
    }
    return out;
  }

  /** 早期反射：给干声一点空间感 */
  function addSpace(buf, taps) {
    const out = Float32Array.from(buf);
    for (const [delay, gain] of taps) {
      const off = Math.floor(delay * SAMPLE_RATE);
      for (let i = off; i < buf.length; i++) out[i] += buf[i - off] * gain;
    }
    return out;
  }

  /** 软限幅（tanh 饱和）：即使叠加也不会硬削波 */
  function softClip(buf) {
    const out = new Float32Array(buf.length);
    for (let i = 0; i < buf.length; i++) out[i] = Math.tanh(buf[i]);
    return out;
  }

  /** 母带：按目标响度归一化 + 峰值上限兜底 + 首尾淡入淡出 */
  function finish(buf, rmsDbfs) {
    let peak = 0, sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const a = Math.abs(buf[i]);
      if (a > peak) peak = a;
      sum += buf[i] * buf[i];
    }
    const rms = Math.sqrt(sum / Math.max(1, buf.length));
    const targetRms = Math.pow(10, rmsDbfs / 20);

    let k = rms > 1e-9 ? targetRms / rms : 1;
    if (peak * k > PEAK_CEIL) k = PEAK_CEIL / Math.max(peak, 1e-9);

    const data = new Int16Array(buf.length);
    const fadeN = Math.max(1, Math.round(SAMPLE_RATE * 0.05));
    for (let i = 0; i < buf.length; i++) {
      const x = Math.min(i, buf.length - 1 - i);
      const fade = x >= fadeN ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * x) / fadeN);
      data[i] = Math.max(-32768, Math.min(32767, Math.round(buf[i] * k * fade * 32767)));
    }
    return data;
  }

  function renderSound(name, notes, taps) {
    return finish(softClip(addSpace(renderNotes(notes, 0.50), taps)), RMS_TARGET[name] || -18);
  }

  const SPACE = {
    success: [[0.026, 0.26], [0.052, 0.16], [0.091, 0.09], [0.137, 0.05]],
    error:   [[0.034, 0.24], [0.071, 0.14], [0.118, 0.07]],
  };
  const NOTE_SETS = { success: SUCCESS_NOTES, error: ERROR_NOTES };
  const toneCache = {};

  function encodeWav(sampleRate, int16) {
    const n = int16.length;
    const buf = new ArrayBuffer(44 + n * 2);
    const view = new DataView(buf);
    const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    str(0, 'RIFF');
    view.setUint32(4, 36 + n * 2, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    str(36, 'data');
    view.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) view.setInt16(44 + i * 2, int16[i], true);
    return buf;
  }

  function bytesToBase64(bytes) {
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(bin);
  }

  function getTone(name) {
    if (toneCache[name]) return toneCache[name];
    const notes = NOTE_SETS[name] || SUCCESS_NOTES;
    const data = renderSound(name, notes, SPACE[name] || SPACE.success);
    const buf = encodeWav(SAMPLE_RATE, data);
    const url = 'data:audio/wav;base64,' + bytesToBase64(new Uint8Array(buf));
    toneCache[name] = { url, buf };
    return toneCache[name];
  }

  /* =======================================================================
   * 2. 播放
   * ===================================================================== */


  // 所有音源复用同一个元素，在真实用户操作中先尝试播放一小段静音。
  // 这能减少首次异步播放被拦截的情况；浏览器仍保留最终的播放权限。
  const audio = new Audio();
  audio.preload = 'auto';
  const SILENCE = 'data:audio/wav;base64,' + bytesToBase64(
    new Uint8Array(encodeWav(SAMPLE_RATE, new Int16Array(441))));
  let audioReady = false;
  let audioPriming = false;
  let audioEpoch = 0;

  function prepareAudio(ev) {
    if (!ev.isTrusted || audioReady || audioPriming || !audio.paused) return;
    audioPriming = true;
    const epoch = ++audioEpoch;
    audio.src = SILENCE;
    audio.volume = settings.volume / 100;
    // play() 必须直接发生在事件回调里，前面不能先 await。
    Promise.resolve(audio.play()).then(() => {
      if (epoch !== audioEpoch) return;
      audioReady = true;
      audio.pause();
    }, (err) => log('音频初始化未完成', err)).finally(() => { audioPriming = false; });
  }

  function stopCurrent() {
    ++audioEpoch;
    audio.pause();
  }

  async function playSource(src) {
    const epoch = ++audioEpoch;
    let timer;
    try {
      if (!src) throw new Error('尚未设置音源');
      let url = src;
      if (src.startsWith('tone:')) url = getTone(src.slice(5)).url;
      else if (src.startsWith('file:')) {
        url = store.get('file:' + src.slice(5), null);
        if (!url) throw new Error('找不到已上传的音频，请重新上传');
      }
      audio.pause();
      audio.src = url;
      audio.volume = settings.volume / 100;
      await Promise.race([
        audio.play(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('音频加载超过 15 秒')), 15000);
        }),
      ]);
      if (epoch === audioEpoch) audioReady = true;
      return true; // 已开始播放，无需等整段音频结束。
    } catch (err) {
      if (epoch !== audioEpoch) return true; // 新播放取代旧播放，不是音源故障。
      audio.pause();
      warn('播放失败', err);
      const blocked = err && err.name === 'NotAllowedError';
      if (blocked) audioReady = false;
      hint(blocked ? '浏览器阻止了声音，点击此提示重试'
        : '播放失败：' + (err.message || '请检查音源'), true, () => playSource(src));
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  function playVerdict(kind) {
    if (!settings.enabled || !settings[kind === 'success' ? 'successEnabled' : 'errorEnabled']) return;
    log('播放', kind);
    void playSource(settings[kind === 'success' ? 'successSrc' : 'errorSrc']);
  }

  /* =======================================================================
   * 3. 结果检测：一次操作对应一次短期监听，不改写页面的网络函数。
   * ===================================================================== */

  const PANELS = {
    run: '[data-e2e-locator="console-result"]',
    submit: '[data-e2e-locator="submission-result"]',
  };
  const norm = (text) => (text || '').replace(/\s+/g, ' ').trim();

  function classify(text) {
    const value = norm(text);
    // 只接受明确的终态。空白、排队、判题中和未知文案都继续等待。
    if (/^(?:未通过|不通过|解答错误|答案错误|编译出错|编译错误|执行出错|执行错误|运行错误|运行时错误|超出时间限制|超时|超出内存限制|超出输出限制|输出超出限制|内部错误|系统错误)/.test(value)
      || /^(?:Wrong Answer|Compile Error|Compilation Error|Runtime Error|Time Limit Exceeded|Memory Limit Exceeded|Output Limit Exceeded|Internal Error)\b/i.test(value)) return 'error';
    if (/^(?:通过|解答成功)(?:$|\s|[（(:：])/.test(value) || /^Accepted\b/i.test(value)) return 'success';
    return null;
  }

  const isPending = (text) => /^(?:判题中|正在判题|运行中|正在运行|执行中|正在执行|提交中|正在提交|排队中|等待中|Pending\b|Judging\b|Running\b|Submitting\b|Queued\b)/i.test(norm(text));
  const visible = (el) => el.getClientRects().length > 0;
  function readPanel(op) {
    const el = Array.from(document.querySelectorAll(PANELS[op])).find(visible) || null;
    return { el, text: el ? norm(el.textContent) : '' };
  }

  function opOfButton(el) {
    const attr = el.getAttribute('data-e2e-locator') || '';
    const text = norm(el.textContent);
    if (/submit/i.test(attr) || /^(?:提交|Submit)$/i.test(text)) return 'submit';
    if (/run-button|run-code|run_code|runcode|console-run/i.test(attr)
      || /^(?:运行|执行代码|运行代码|Run Code|Run)$/i.test(text)) return 'run';
    return null;
  }

  function findButton(op) {
    return Array.from(document.querySelectorAll('button, [role="button"]'))
      .find((el) => visible(el) && opOfButton(el) === op) || null;
  }

  const problemKey = () => location.origin +
    ((location.pathname.match(/\/problems\/[^/]+/) || [location.pathname])[0]);
  const WAIT_MS = 120000;
  const STABLE_MS = 120;
  let pending = null;
  let observer = null;
  let timeoutTimer = 0;
  let settleTimer = 0;

  function cancelPending() {
    if (observer) observer.disconnect();
    observer = null;
    clearTimeout(timeoutTimer);
    clearTimeout(settleTimer);
    timeoutTimer = settleTimer = 0;
    pending = null;
  }

  function checkResult(records = []) {
    const job = pending;
    if (!job) return;
    if (problemKey() !== job.problem) { cancelPending(); return; }
    const panel = readPanel(job.op);
    const button = job.button && job.button.isConnected && visible(job.button)
      ? job.button : findButton(job.op);
    const busy = !!button && (button.disabled || button.getAttribute('aria-disabled') === 'true'
      || button.getAttribute('aria-busy') === 'true');

    // 同一批 DOM 更新可能已完成“禁用 → 启用”或“判题中 → 通过”。
    for (const record of records) {
      if (record.target === button && record.type === 'attributes'
        && ((record.attributeName === 'disabled' && record.oldValue !== null)
          || (/^aria-(?:disabled|busy)$/.test(record.attributeName) && record.oldValue === 'true'))) job.busySeen = true;
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (target && target.closest(PANELS[job.op])) {
        if (record.type === 'characterData' && isPending(record.oldValue)) job.cleared = true;
        if (record.type === 'childList' && Array.from(record.removedNodes).some((n) => isPending(n.textContent))) job.cleared = true;
      }
    }
    if (busy) job.busySeen = true;
    if (button && job.busySeen && !busy) job.cycleComplete = true;
    if (!panel.text || isPending(panel.text)) job.cleared = true;

    const kind = classify(panel.text);
    const fresh = panel.text !== job.baseline.text || panel.el !== job.baseline.el
      || job.cleared || job.cycleComplete;
    clearTimeout(settleTimer);
    settleTimer = 0;
    if (!kind || !fresh || busy) { job.candidate = null; return; }
    if (!job.candidate || job.candidate.el !== panel.el || job.candidate.text !== panel.text) {
      job.candidate = { ...panel, since: now() };
    }
    const remaining = STABLE_MS - (now() - job.candidate.since);
    if (remaining > 0) {
      settleTimer = setTimeout(checkResult, remaining);
      return;
    }
    log('判定结果', job.op, panel.text, kind);
    cancelPending();
    playVerdict(kind);
  }

  function onJudge(op, button = null) {
    cancelPending();
    if (!settings.enabled) return;
    if (!audioPriming) stopCurrent();
    // 必须在操作事件发生时读取实际 DOM，不能拿上次轮询的缓存作快照。
    pending = { op, button, baseline: readPanel(op), problem: problemKey(),
      cleared: false, busySeen: false, cycleComplete: false, candidate: null };
    observer = new MutationObserver(checkResult);
    observer.observe(document, { subtree: true, childList: true, characterData: true,
      characterDataOldValue: true, attributes: true, attributeOldValue: true,
      attributeFilter: ['disabled', 'aria-disabled', 'aria-busy', 'class', 'style'] });
    timeoutTimer = setTimeout(() => {
      log('等待结果超时', op);
      cancelPending();
    }, WAIT_MS);
    log('等待结果', op, pending.baseline.text);
  }

  function installListeners() {
    document.addEventListener('click', (ev) => {
      const button = ev.composedPath().find((el) => el && el.nodeType === 1
        && el.matches('button, [role="button"]'));
      if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true') {
        const op = opOfButton(button);
        if (op) onJudge(op, button);
      }
      prepareAudio(ev);
    }, true);
    document.addEventListener('keydown', (ev) => {
      if (!ev.repeat && !ev.isComposing && !ev.altKey && (ev.ctrlKey || ev.metaKey)
        && ev.target && ev.target.closest('.monaco-editor, .CodeMirror')) {
        // 仅旁听常见快捷键，不阻止事件，也不替用户点击或提交。
        const op = ev.key === 'Enter' ? (ev.shiftKey ? 'run' : 'submit')
          : ev.code === 'Quote' && !ev.shiftKey ? 'run' : null;
        if (op) onJudge(op);
      }
      prepareAudio(ev);
    }, true);
    window.addEventListener('pagehide', () => { cancelPending(); stopCurrent(); });
    window.addEventListener('popstate', cancelPending);
  }

  /* =======================================================================
   * 5. 提示条
   * ===================================================================== */

  let toastHost = null;
  function ensureToastHost() {
    if (toastHost && toastHost.isConnected) return toastHost;
    toastHost = document.createElement('div');
    toastHost.className = 'lc-verdict-toast-host';
    toastHost.attachShadow({ mode: 'open' });
    toastHost.shadowRoot.appendChild(css(`
      :host { all: initial; }
      .wrap { position: fixed; left: 50%; bottom: 46px; transform: translateX(-50%);
              display: flex; flex-direction: column; gap: 8px; align-items: center;
              z-index: 2147483000; pointer-events: none;
              font: 13px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
      .t { background: rgba(24,24,27,.92); color: #fff; padding: 8px 14px; border-radius: 999px;
           box-shadow: 0 6px 20px rgba(0,0,0,.28); opacity: 0; transform: translateY(8px);
           transition: opacity .18s, transform .18s; max-width: 70vw; }
      .t.on { opacity: 1; transform: translateY(0); }
      .t.err { background: rgba(153,27,27,.94); }
      .t.clickable { pointer-events: auto; cursor: pointer; }
      .t.clickable:hover { background: rgba(39,39,42,.96); }
      .t .sub { opacity: .62; margin-left: 6px; font-size: 12px; }
    `));
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    toastHost.shadowRoot.appendChild(wrap);
    (document.body || document.documentElement).appendChild(toastHost);
    return toastHost;
  }

  let lastHint = { el: null, msg: '' };
  function hint(msg, isErr, onClick) {
    try {
      const host = ensureToastHost();
      const wrap = host.shadowRoot.querySelector('.wrap');
      if (lastHint.el && lastHint.msg === msg && lastHint.el.isConnected) {
        lastHint.el.remove();
        lastHint = { el: null, msg: '' };
      }
      const el = h('div', {
        class: 't' + (isErr ? ' err' : '') + (onClick ? ' clickable' : ''),
        text: msg,
      });
      if (onClick) {
        el.appendChild(h('span', { class: 'sub', text: '点击操作' }));
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          try { onClick(); } catch (e) { warn(e); }
          el.remove();
        });
      }
      wrap.appendChild(el);
      lastHint = { el, msg };
      requestAnimationFrame(() => el.classList.add('on'));
      setTimeout(() => {
        el.classList.remove('on');
        setTimeout(() => el.remove(), 250);
      }, onClick ? 5200 : 2600);
    } catch (e) { warn(msg); }
  }

  /* =======================================================================
   * 6. 设置面板（只通过油猴菜单打开）
   * ===================================================================== */

  function css(text) {
    const s = document.createElement('style');
    s.textContent = text;
    return s;
  }

  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === 'class') el.className = attrs[k];
        else if (k === 'text') el.textContent = attrs[k];
        else if (k === 'style') el.setAttribute('style', attrs[k]);
        else if (k.startsWith('on') && typeof attrs[k] === 'function') el.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) el.setAttribute(k, attrs[k]);
      }
    }
    if (children) {
      for (const c of [].concat(children)) {
        if (c === null || c === undefined) continue;
        el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    }
    return el;
  }

  const SOURCE_OPTIONS = [
    ['tone:success', '内置音效 · 成功和弦（Apple 风格）'],
    ['tone:error', '内置音效 · 失败提示（Apple 风格）'],
    ['file:', '上传的本地音频文件'],
    ['__custom__', '自定义音频链接…'],
  ];

  let panelRoot = null;

  function slotRow(kind, label, colorClass) {
    const isSuccess = kind === 'success';
    const srcKey = isSuccess ? 'successSrc' : 'errorSrc';
    const enKey = isSuccess ? 'successEnabled' : 'errorEnabled';

    const fileInput = h('input', { type: 'file', accept: 'audio/*', style: 'display:none' });
    const select = h('select', { class: 'sel' });
    const ownTone = 'tone:' + kind;
    for (const [v, t] of SOURCE_OPTIONS) {
      if (v.startsWith('tone:') && v !== ownTone) continue;
      select.appendChild(h('option', { value: v, text: t }));
    }

    const urlInput = h('input', {
      class: 'url', type: 'text',
      placeholder: 'https://… 或 data:audio/… （mp3 / wav / ogg 均可）',
    });
    const fileInfo = h('span');

    function currentSelectValue() {
      const v = settings[srcKey];
      if (v.startsWith('file:')) return 'file:';
      if (v.startsWith('tone:')) return v;
      return '__custom__';
    }

    function sync() {
      select.value = currentSelectValue();
      urlInput.style.display = select.value === '__custom__' ? '' : 'none';
      urlInput.value = select.value === '__custom__' ? settings[srcKey] : '';
      fileInput.style.display = select.value === 'file:' ? '' : 'none';
      fileInfo.textContent = settings[srcKey].startsWith('file:')
        ? '已使用本地上传的音频（保存在脚本存储中）' : '';
    }

    select.addEventListener('change', () => {
      const v = select.value;
      if (v === 'file:') {
        fileInput.click();
        sync();
        return;
      } else if (v === '__custom__') {
        settings[srcKey] = urlInput.value.trim() || '';
        saveSettings();
        setTimeout(() => urlInput.focus(), 0);
      } else {
        settings[srcKey] = v;
        saveSettings();
      }
      sync();
    });

    urlInput.addEventListener('change', () => {
      settings[srcKey] = urlInput.value.trim();
      saveSettings();
    });

    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      if (f.size > 6 * 1024 * 1024) { hint('文件太大（>6MB），建议压缩或使用外链', true); return; }
      const fr = new FileReader();
      fr.onload = () => {
        const key = kind; // 每种结果只占一个上传槽，替换文件不再不断累积新键。
        if (!store.set('file:' + key, String(fr.result))) {
          hint('音频保存失败，请换用较小的文件或音频链接', true);
          return;
        }
        settings[srcKey] = 'file:' + key;
        saveSettings();
        sync();
        hint('已保存音频：' + f.name);
      };
      fr.onerror = () => hint('读取文件失败', true);
      fr.readAsDataURL(f);
    });

    sync();

    return h('div', { class: 'slot' }, [
      fileInput,
      h('div', { class: 'slot-head' }, [
        h('label', { class: 'cb' }, [
          h('input', {
            type: 'checkbox',
            checked: settings[enKey] ? 'checked' : null,
            onchange: (e) => { settings[enKey] = e.target.checked; saveSettings(); },
          }),
          h('span', { class: 'dot ' + colorClass }),
          h('b', { text: label }),
        ]),
        h('div', { class: 'acts' }, [
          h('button', {
            class: 'btn', text: '试听',
            onclick: () => playSource(settings[srcKey]),
          }),
          h('button', { class: 'btn', text: '上传文件', onclick: () => fileInput.click() }),
        ]),
      ]),
      h('div', { class: 'row' }, [select]),
      h('div', { class: 'row' }, [urlInput]),
      h('div', { class: 'row', style: 'font-size:12px;color:#94a3b8' }, [
        fileInfo,
      ]),
    ]);
  }

  function buildPanel() {
    const root = h('div', { id: 'lc-verdict-sound-root' });
    const sr = root.attachShadow({ mode: 'open' });
    sr.appendChild(css(`
      :host { all: initial; }
      * { box-sizing: border-box; }
      .panel { position: fixed; right: 18px; top: 74px; width: 340px; max-height: 76vh; overflow: auto;
               background: #0f172a; color: #e2e8f0; border: 1px solid #1e293b; border-radius: 12px;
               box-shadow: 0 18px 50px rgba(0,0,0,.5); z-index: 2147483200; padding: 14px;
               font: 13px/1.55 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
      .panel[hidden] { display: none; }
      h3 { margin: 0 0 10px; font-size: 14px; display: flex; justify-content: space-between; align-items: center; }
      .muted { color: #94a3b8; font-size: 12px; margin: 0 0 10px; }
      .sec { border-top: 1px solid #1e293b; margin-top: 12px; padding-top: 12px; }
      .slot { background: #111c33; border: 1px solid #1e293b; border-radius: 10px; padding: 10px; margin-bottom: 10px; }
      .slot-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
      .cb { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }
      .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
      .dot.ok { background: #22c55e; box-shadow: 0 0 8px #22c55e; }
      .dot.no { background: #ef4444; box-shadow: 0 0 8px #ef4444; }
      .acts { display: flex; gap: 6px; }
      .btn { background: #1e293b; color: #cbd5e1; border: 1px solid #334155; border-radius: 7px;
             padding: 4px 9px; cursor: pointer; font-size: 12px; }
      .btn:hover { background: #263449; color: #fff; }
      .row { margin-top: 7px; }
      select, input[type=text] { width: 100%; background: #0b1220; color: #e2e8f0; border: 1px solid #334155;
             border-radius: 7px; padding: 6px 8px; font-size: 12px; outline: none; }
      select:focus, input[type=text]:focus { border-color: #3b82f6; }
      input[type=file] { color: #94a3b8; font-size: 12px; width: 100%; }
      input[type=range] { width: 100%; accent-color: #3b82f6; }
      .field { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
      .field > label { min-width: 76px; color: #94a3b8; font-size: 12px; }
      .link { color: #60a5fa; cursor: pointer; font-size: 12px; text-decoration: underline; background: none; border: none; padding: 0; }
      .foot { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
    `));

    const master = h('label', { class: 'cb' }, [
      h('input', {
        type: 'checkbox',
        checked: settings.enabled ? 'checked' : null,
        onchange: (e) => { settings.enabled = e.target.checked; saveSettings(); },
      }),
      h('b', { text: '启用音效' }),
    ]);

    const panelEl = h('div', { class: 'panel', hidden: 'hidden' }, [
      h('h3', {}, [
        h('span', { text: '⚙️ 力扣判定音效' }),
        h('button', { class: 'btn', text: '✕', onclick: () => { panelEl.hidden = true; } }),
      ]),
      h('p', { class: 'muted', text: '明确通过时播放成功音，明确未通过时播放提醒音；排队和判题中保持安静。设置自动保存。' }),
      h('p', { class: 'muted', text: '本面板默认不显示在页面上；关闭后可随时通过 Tampermonkey 菜单「打开音效设置」再次调出。' }),
      master,
      slotRow('success', '通过 / Accepted', 'ok'),
      slotRow('error', '未通过 / Failed', 'no'),

      h('div', { class: 'sec' }, [
        h('div', { class: 'field' }, [
          h('label', { text: '音量' }),
          h('input', {
            type: 'range', min: '0', max: '100', step: '5', value: String(settings.volume),
            oninput: (e) => { settings.volume = Number(e.target.value); saveSettings(); },
          }),
        ]),
        h('div', { class: 'foot' }, [
          h('label', { class: 'cb' }, [
            h('input', {
              type: 'checkbox', checked: DEBUG ? 'checked' : null,
              onchange: (e) => { DEBUG = e.target.checked; log('调试模式', DEBUG); },
            }),
            h('span', { class: 'muted', text: '控制台调试日志' }),
          ]),
          h('button', {
            class: 'link', text: '恢复默认',
            onclick: () => {
              settings = Object.assign({}, DEFAULT_SETTINGS);
              saveSettings();
              hint('已恢复默认设置');
              panelRoot.remove();
              panelRoot = null;
              showPanel(true);
            },
          }),
        ]),
        h('div', { class: 'foot' }, [
          h('button', { class: 'link', text: '立即试听「通过」', onclick: () => playSource(settings.successSrc) }),
          h('button', { class: 'link', text: '立即试听「未通过」', onclick: () => playSource(settings.errorSrc) }),
        ]),
      ]),
    ]);

    sr.appendChild(panelEl);
    root.__panel = panelEl;
    return root;
  }

  function showPanel(open) {
    if (!panelRoot) {
      panelRoot = buildPanel();
      (document.body || document.documentElement).appendChild(panelRoot);
    }
    if (open) panelRoot.__panel.hidden = false;
  }

  /* =======================================================================
   * 7. 启动
   * ===================================================================== */

  // 事件委托在 document-start 就安装；设置界面仅在打开菜单时创建。
  function registerMenu() {
    if (typeof GM_registerMenuCommand !== 'function') {
      warn('缺少脚本管理器菜单 API，请通过 Tampermonkey 安装此脚本');
      return;
    }

    const whenBody = (fn) => {
      if (document.body) { fn(); return; }
      document.addEventListener('DOMContentLoaded', () => fn(), { once: true });
    };

    GM_registerMenuCommand('打开音效设置', () => whenBody(() => showPanel(true)));
    GM_registerMenuCommand('音效开关（开 / 关）', () => {
      settings.enabled = !settings.enabled;
      saveSettings();
      whenBody(() => hint(settings.enabled ? '音效已开启' : '音效已关闭', false, () => showPanel(true)));
      log('音效开关 ->', settings.enabled);
    });
    GM_registerMenuCommand('试听：通过音效', () => whenBody(() => {
      void playSource(settings.successSrc);
    }));
    GM_registerMenuCommand('试听：未通过音效', () => whenBody(() => {
      void playSource(settings.errorSrc);
    }));

  }

  function watchSettingsChanges() {
    if (typeof GM_addValueChangeListener !== 'function') return;
    try {
      GM_addValueChangeListener('settings', (name, oldVal, newVal, remote) => {
        if (!remote || !newVal) return;
        settings = Object.assign({}, DEFAULT_SETTINGS, newVal);
        coerceSettings();
        if (panelRoot) {
          const open = !panelRoot.__panel.hidden;
          panelRoot.remove();
          panelRoot = null;
          if (open) showPanel(true);
        }
        log('已同步其它标签页的设置', settings);
      });
    } catch (e) { /* ignore */ }
  }

  installListeners();
  registerMenu();
  watchSettingsChanges();
})();
