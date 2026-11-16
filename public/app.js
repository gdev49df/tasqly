// tasqly: клиент (без сборки, чистый js)
(() => {
  'use strict';

  const app = document.getElementById('app');
  const state = { user: null };
  let cleanup = null; // снимает обработчики текущего экрана при переходе

  const PRIORITIES = ['Без приоритета', 'Низкий', 'Средний', 'Высокий'];
  const LABEL_COLORS = ['#e5484d', '#f76b15', '#f5a524', '#30a46c', '#12a594', '#3e63dd', '#8e4ec6', '#d6409f'];
  const AVATAR_COLORS = ['#3e3e3a', '#30a46c', '#e5484d', '#f76b15', '#12a594', '#8e4ec6', '#d6409f', '#3e63dd'];

  // ---------- хранилище и тема ----------

  const store = (key, fallback) => ({
    get() {
      try {
        return localStorage.getItem(key) || fallback;
      } catch {
        return fallback;
      }
    },
    set(value) {
      try {
        if (value) localStorage.setItem(key, value);
        else localStorage.removeItem(key);
      } catch {
        /* хранилище недоступно */
      }
    },
  });
  const tokenStore = store('tq_token', '');
  const themeStore = store('tq_theme', 'auto');
  const viewStore = store('tq_view', 'board');

  const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
  const effTheme = (t = themeStore.get()) => (t === 'auto' ? (darkMq.matches ? 'dark' : 'light') : t);
  function applyTheme(theme) {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.eff = effTheme(theme);
  }
  applyTheme(themeStore.get());
  darkMq.addEventListener('change', () => applyTheme(themeStore.get()));

  // плавная смена темы: круг расходится от кнопки (View Transitions), без поддержки — мягкое затухание цветов
  function setTheme(next, from) {
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // выбор запоминаем сразу, а в страницу применяем всегда последний выбор: быстрые клики не расходятся
    themeStore.set(next);
    window.dispatchEvent(new Event('tq-theme'));
    const commit = () => applyTheme(themeStore.get());
    if (calm) return commit();
    const root = document.documentElement;
    if (themeAnim) { try { themeAnim.skipTransition(); } catch { /* уже закончилась */ } themeAnim = null; }
    if (document.startViewTransition && from && from.getBoundingClientRect) {
      const r = from.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const rad = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      root.classList.add('theme-vt');
      const vt = document.startViewTransition(commit);
      themeAnim = vt;
      vt.ready.then(() => root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${rad}px at ${x}px ${y}px)`] },
        { duration: 620, easing: 'cubic-bezier(.22,.8,.24,1)', pseudoElement: '::view-transition-new(root)' },
      )).catch(() => {});
      vt.finished.finally(() => {
        if (themeAnim === vt) themeAnim = null;
        root.classList.remove('theme-vt');
        commit();
      });
      return;
    }
    root.classList.add('theme-fade');
    commit();
    setTimeout(() => root.classList.remove('theme-fade'), 520);
  }
  let themeAnim = null;
  function themeToggle(extra = '') {
    const btn = h('button', { class: `icon-btn theme-toggle ${extra}`.trim(), title: 'Светлая / тёмная тема', 'aria-label': 'Сменить тему' });
    btn.innerHTML = '<svg class="i-sun" viewBox="0 0 20 20" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="10" cy="10" r="3.6"/><path d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M15.3 4.7 14 6M6 14l-1.3 1.3"/></svg><svg class="i-moon" viewBox="0 0 20 20" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 11.6A6.8 6.8 0 0 1 8.4 3.5a6.8 6.8 0 1 0 8.1 8.1z"/></svg>';
    btn.addEventListener('click', () => setTheme(effTheme() === 'dark' ? 'light' : 'dark', btn));
    return btn;
  }

  // ---------- утилиты ----------

  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  let toastTimer;
  function toast(message) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
  }

  // адрес api: пусто = тот же домен (cloudflare), иначе внешний (клиент на github pages)
  const IN_PANEL = /^\/panel(\/|$)/.test(location.pathname);
  const PANEL = '/panel/';
  const API_BASE = String(window.TASQLY_API || '').replace(/\/$/, '');

  async function api(method, path, body) {
    if (method !== 'GET') cacheClear();
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    const token = tokenStore.get();
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: API_BASE ? 'omit' : 'same-origin',
    });
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* пустой ответ */
    }
    if (res.status === 401) {
      tokenStore.set('');
      try { localStorage.removeItem('tq_user'); } catch { /* нет хранилища */ }
      if (state.user) {
        state.user = null;
        route();
      }
    }
    if (!res.ok) throw new Error(data.error || `ошибка ${res.status}`);
    if (data.token) tokenStore.set(data.token);
    return data;
  }
  api.get = (p) => api('GET', p);

  // мгновенный показ: последний ответ берём из памяти браузера, свежий подтягиваем фоном
  let cacheEpoch = 0;
  const cacheKey = (p) => `tq_c:${state.user ? state.user.id : ''}:${p}`;
  const cacheGet = (p) => { try { const v = localStorage.getItem(cacheKey(p)); return v ? JSON.parse(v) : null; } catch { return null; } };
  const cacheSet = (p, d) => { try { const j = JSON.stringify(d); if (j.length < 300000) localStorage.setItem(cacheKey(p), j); } catch { /* хранилище недоступно */ } };
  function cacheClear() {
    cacheEpoch++;
    try { Object.keys(localStorage).filter((k) => k.startsWith('tq_c:')).forEach((k) => localStorage.removeItem(k)); } catch { /* нет хранилища */ }
  }
  const isTyping = () => { const a = document.activeElement; return !!a && (['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName) || a.isContentEditable); };
  let quietRoute = false;
  api.fast = (path) => {
    const hit = cacheGet(path);
    const epoch = cacheEpoch;
    const startHash = location.hash;
    const fresh = api.get(path).then((d) => { if (epoch === cacheEpoch) cacheSet(path, d); return d; });
    if (!hit) return fresh;
    fresh.then((d) => {
      if (epoch === cacheEpoch && JSON.stringify(d) !== JSON.stringify(hit) && location.hash === startHash && !isTyping()) { quietRoute = true; route(); }
    }).catch(() => {});
    return Promise.resolve(hit);
  };
  // то же для вкладок: onData вызывается сразу с кешем (если есть), затем со свежими данными, если они отличаются
  api.swr = async (path, onData) => {
    const hit = cacheGet(path);
    const epoch = cacheEpoch;
    if (hit) onData(hit);
    const d = await api.get(path);
    if (epoch === cacheEpoch) cacheSet(path, d);
    if (!hit || JSON.stringify(d) !== JSON.stringify(hit)) onData(d);
  };
  api.post = (p, b = {}) => api('POST', p, b);
  api.put = (p, b) => api('PUT', p, b);
  api.patch = (p, b) => api('PATCH', p, b);
  api.del = (p) => api('DELETE', p, {});

  function avatar(name) {
    const n = name || '?';
    let hash = 0;
    for (const ch of n) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
    return h('span', { class: 'avatar', title: n, style: `background:${AVATAR_COLORS[hash % AVATAR_COLORS.length]}` }, n.trim().charAt(0).toUpperCase());
  }

  function saveUser() { try { localStorage.setItem('tq_user', JSON.stringify(state.user)); } catch { /* нет хранилища */ } }

  // пробный период «Команды»: 5 дней у новых аккаунтов; null у старых
  function trialState() {
    const end = state.user && state.user.trial_ends_at;
    if (!end) return null;
    const left = Math.ceil((end - Date.now()) / 86400000);
    return left > 0 ? { active: true, left } : { active: false, left: 0 };
  }
  async function startTrial(done) {
    try {
      const { user } = await api.post('/api/me/trial', {});
      state.user = user;
      saveUser();
      cacheClear();
      toast('Пробный период начался: 5 дней «Команды»');
      if (done) done();
      quietRoute = false;
      route();
    } catch (e) {
      toast(e.message);
    }
  }

  // окно после регистрации: предложить пробный период кнопкой
  function maybeOfferTrial() {
    let flag = null;
    try { flag = sessionStorage.getItem('tq_trial_offer'); } catch { /* нет хранилища */ }
    if (!flag || !state.user) return;
    try { sessionStorage.removeItem('tq_trial_offer'); } catch { /* нет хранилища */ }
    if (state.user.plan !== 'start' || state.user.trial_ends_at) return;
    const overlay = h('div', { class: 'overlay' });
    const close = () => closeOverlay(overlay);
    overlay.addEventListener('tq-close', close);
    overlay.addEventListener('mousedown', (e) => e.target === overlay && close());
    const go = h('button', { class: 'btn', type: 'button' }, 'Начать пробный период');
    go.addEventListener('click', () => { go.disabled = true; startTrial(close).then(() => (go.disabled = false)); });
    overlay.append(
      h('div', { class: 'modal narrow trial-offer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Пробный период' },
        h('div', { class: 'head' }, h('h1', { style: 'font-size:20px;flex:1;margin:0' }, `Попробуй «Команду» ${daysWord(5)} бесплатно`), h('button', { class: 'icon-btn', onclick: close, 'aria-label': 'Закрыть' }, '✕')),
        h('p', { class: 'sub', style: 'margin:0 0 12px' }, 'Откроются все возможности: до 30 человек в пространстве, чат, диск, обзор времени и AI. Карта не нужна, после пробного периода ничего не списывается.'),
        h('ul', { class: 'trial-list' }, ['До 30 человек в пространстве', 'Командный чат и общий диск', 'Обзор времени и AI-помощник'].map((x) => h('li', null, x))),
        h('div', { class: 'modal-actions' }, h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Позже'), go),
      ),
    );
    document.body.append(overlay);
  }

  const daysWord = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'день' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'дня' : 'дней'}`;

  const pad = (n) => String(n).padStart(2, '0');
  const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayIso = () => isoOf(new Date());
  function formatDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }
  const formatDateTime = (ts) => new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  // всплывающее меню у кнопки
  let menuEl = null;
  function closeMenu() {
    if (!menuEl) return;
    menuEl.remove();
    menuEl = null;
    document.removeEventListener('mousedown', onMenuOutside, true);
  }
  function onMenuOutside(e) {
    if (menuEl && !menuEl.contains(e.target)) closeMenu();
  }
  function openMenu(anchor, items) {
    closeMenu();
    const rect = anchor.getBoundingClientRect();
    menuEl = h(
      'div',
      { class: 'menu', role: 'menu' },
      items.map((it) =>
        it === '-'
          ? h('hr')
          : h(
              'button',
              {
                class: it.danger ? 'danger' : '',
                disabled: it.disabled,
                onclick: () => {
                  closeMenu();
                  it.onClick();
                },
              },
              it.label,
            ),
      ),
    );
    document.body.append(menuEl);
    menuEl.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - menuEl.offsetHeight - 8))}px`;
    menuEl.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menuEl.offsetWidth - 8))}px`;
    document.addEventListener('mousedown', onMenuOutside, true);
  }

  // редактирование текста прямо на месте
  function inlineEdit(el, initial, save, maxlength = 80) {
    const input = h('input', { type: 'text', value: initial, maxlength });
    el.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const finish = async (commit) => {
      if (finished) return;
      finished = true;
      const v = input.value.trim();
      input.replaceWith(el);
      if (commit && v && v !== initial) await save(v);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  // Esc закрывает верхнее окно
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const top = [...document.querySelectorAll('.overlay')].pop();
    if (top) top.dispatchEvent(new Event('tq-close'));
  });

  // ---------- каркас ----------


  const THEME_TEXT = { auto: 'Тема: как в системе', light: 'Тема: светлая', dark: 'Тема: тёмная' };

  const ICONS = {
    plus: '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M10 4v12M4 10h12"/></svg>',
    clock: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7"/><path d="M10 6v4.2l2.8 1.7"/></svg>',
    menu: '<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 5.5h14M3 10h14M3 14.5h14"/></svg>',
    spark: '<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor"><path d="M10 1.8 11.9 7l5.3 1.9-5.3 1.9L10 16.2 8.1 10.8 2.8 8.9 8.1 7zM16 13.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/></svg>',
    mail: '<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="2.5" y="4.5" width="15" height="11" rx="2.5"/><path d="m3.5 6 6.5 5 6.5-5" stroke-linecap="round"/></svg>',
    home: '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3.5 9 10 3.5 16.5 9v7a1 1 0 0 1-1 1h-3.5v-5h-4v5H4.5a1 1 0 0 1-1-1z"/></svg>',
    folder: '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M2.5 6a1.5 1.5 0 0 1 1.5-1.5h3.2l1.6 1.8H16A1.5 1.5 0 0 1 17.5 7.8v6.7A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5z"/></svg>',
  };
  const FIC = [
    '<rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="11" y="3" width="6" height="6" rx="1.5"/><rect x="3" y="11" width="6" height="6" rx="1.5"/><rect x="11" y="11" width="6" height="6" rx="1.5"/>',
    '<rect x="3" y="3.5" width="14" height="13" rx="2"/><path d="M7.5 3.5v13M12.5 3.5v13"/>',
    '<circle cx="10" cy="10.5" r="6.5"/><path d="M10 7v3.7l2.3 1.4M8 2h4"/>',
    '<path d="M10 3a7 7 0 1 0 7 7"/><path d="M10 3v7h7"/>',
    '<path d="M4 16h3l8-8.5a1.8 1.8 0 0 0-2.5-2.5L4.5 13.5z"/><path d="M12 6l2 2"/>',
    '<path d="M3.5 5.5A2 2 0 0 1 5.5 3.5h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-3.5 3v-3a2 2 0 0 1-2-2z"/>',
    '<path d="M3 6a1.5 1.5 0 0 1 1.5-1.5h3l1.6 1.8h6.4A1.5 1.5 0 0 1 17 7.8v6.7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z"/>',
    '<path d="M10 2.5l1.7 4.6 4.6 1.7-4.6 1.7L10 15.1l-1.7-4.6L3.7 8.8l4.6-1.7z"/>'];
  const icon = (name) => {
    const el = h('span', { class: 'ico' });
    el.innerHTML = ICONS[name];
    return el;
  };

  const SEEN_KEY = 'tq_inbox_seen';
  const lastSeen = () => Number(localStorage.getItem(SEEN_KEY) || 0);


  // ---------- типы проектов и задач ----------

  const KINDS = {
    basic: { name: 'Базовый', hint: 'Три колонки: к выполнению, в работе, готово' },
    advanced: { name: 'Продвинутый', hint: 'Бэклог, проверка, оценка времени по задачам' },
    it: { name: 'IT', hint: 'Спринт, code review, тестирование, типы задач: баг, фича, техдолг' },
  };
  const TASK_TYPES = { task: 'Задача', bug: 'Баг', feature: 'Фича', debt: 'Техдолг' };
  const TASK_TYPE_COLORS = { bug: '#e5484d', feature: '#3e63dd', debt: '#f76b15' };

  // ---------- время ----------

  function fmtDur(sec) {
    sec = Math.max(0, Math.round(sec));
    const hh = Math.floor(sec / 3600);
    const mm = Math.floor((sec % 3600) / 60);
    if (!hh && !mm) return sec ? '< 1 мин' : '0 мин';
    return hh ? `${hh} ч ${pad(mm)} мин` : `${mm} мин`;
  }
  const fmtClock = (sec) => `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(Math.floor(sec % 60))}`;
  const fmtBytes = (n) => (n < 1024 ? `${n} Б` : n < 1048576 ? `${(n / 1024).toFixed(1)} КБ` : `${(n / 1048576).toFixed(1)} МБ`);
  const fmtDateTime = (ts) => new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  let timerOffset = 0;
  const elapsedSec = () => (state.timer ? (Date.now() + timerOffset - state.timer.started_at) / 1000 : 0);

  async function refreshTimer() {
    try {
      const r = await api.get('/api/timer');
      state.timer = r.entry;
      state.timerLoaded = true;
      timerOffset = r.server_time - Date.now();
    } catch {
      /* без таймера */
    }
    paintTimer();
  }

  async function stopTimer() {
    try {
      await api.post('/api/timer/stop');
      state.timer = null;
      paintTimer();
      toast('Таймер остановлен');
      window.dispatchEvent(new Event('tq-timer'));
    } catch (e) {
      toast(e.message);
    }
  }

  function paintTimer() {
    document.querySelectorAll('.timer-slot').forEach((slot) => {
      if (!state.timer) return slot.replaceChildren();
      slot.replaceChildren(
        h(
          'a',
          { class: 'timer-pill', href: `#/p/${state.timer.project_id}`, title: state.timer.task_title },
          h('span', { class: 'rec' }),
          h('span', { class: 'clock' }, fmtClock(elapsedSec())),
          h('span', { class: 'ttl' }, state.timer.task_title),
          h(
            'button',
            {
              class: 'icon-btn',
              title: 'Остановить таймер',
              'aria-label': 'Остановить таймер',
              onclick: (e) => {
                e.preventDefault();
                e.stopPropagation();
                stopTimer();
              },
            },
            '■',
          ),
        ),
      );
    });
  }
  setInterval(() => {
    if (!state.timer) return;
    const t = fmtClock(elapsedSec());
    document.querySelectorAll('.timer-pill .clock, .timer-live').forEach((el) => (el.textContent = t));
  }, 1000);

  // ---------- боковая панель ai (доступна на любой странице) ----------

  const aiOpenStore = store('tq_ai_open', '');
  const lastWsStore = store('tq_ws', '');
  const aiCtx = { workspaceId: '', projectId: '' };
  let aiDock = null;
  let aiLabelEl = null;
  let aiChatObj = null;

  function setAiContext(workspaceId, projectId, label) {
    if (workspaceId) lastWsStore.set(workspaceId);
    aiCtx.workspaceId = workspaceId || lastWsStore.get() || '';
    aiCtx.projectId = projectId || '';
    aiCtx.label = label || (aiCtx.workspaceId ? 'последнее пространство' : 'нет пространства');
    if (aiLabelEl) aiLabelEl.textContent = aiCtx.label;
  }

  function buildDock() {
    aiChatObj = aiChat(aiCtx, { compact: true });
    aiLabelEl = h('span', { class: 'mail-sub' }, aiCtx.label || (aiCtx.workspaceId ? 'последнее пространство' : 'нет пространства'));
    aiDock = h(
      'aside',
      { class: 'ai-dock', 'aria-label': 'AI tasqly' },
      h(
        'div',
        { class: 'ai-dock-head' },
        h('span', { class: 'avatar ai-avatar' }, 'AI'),
        h('div', { class: 'ai-dock-title' }, h('b', null, 'AI tasqly'), aiLabelEl),
        h('button', { class: 'icon-btn', title: 'Новый разговор', 'aria-label': 'Новый разговор', onclick: () => aiChatObj.reset() }, '✎'),
        h('button', { class: 'icon-btn', title: 'На весь экран', 'aria-label': 'На весь экран', onclick: () => document.body.classList.toggle('ai-full') }, '⤢'),
        h('button', { class: 'icon-btn', title: 'Закрыть', 'aria-label': 'Закрыть панель AI', onclick: () => toggleDock(false) }, '✕'),
      ),
      aiChatObj.el,
    );
    document.body.append(aiDock);
  }

  function toggleDock(force, full) {
    document.body.classList.toggle('ai-full', !!full && force !== false);
    const open = force === undefined ? !document.body.classList.contains('ai-open') : force;
    if (open && !state.user) return;
    if (open && !aiDock) buildDock();
    document.body.classList.toggle('ai-open', open);
    aiOpenStore.set(open ? '1' : '');
    document.querySelectorAll('.ai-btn').forEach((b) => b.setAttribute('aria-pressed', String(open)));
    if (open) setTimeout(() => aiChatObj && aiChatObj.input.focus(), 250);
  }

  function destroyDock() {
    document.body.classList.remove('ai-open', 'ai-full');
    if (aiDock) aiDock.remove();
    aiDock = aiLabelEl = aiChatObj = null;
  }

  // ---------- пароль: показать/скрыть, смена пароля ----------

  const EYE = '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1.8 10S5 4.5 10 4.5 18.2 10 18.2 10 15 15.5 10 15.5 1.8 10 1.8 10z"/><circle cx="10" cy="10" r="2.4"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l14 14M8.2 4.8A8 8 0 0 1 10 4.5c5 0 8.2 5.5 8.2 5.5a14 14 0 0 1-2.6 3.2M12.1 12.1A2.4 2.4 0 0 1 7.9 7.9M5 6.2C3 7.7 1.8 10 1.8 10S5 15.5 10 15.5c1.1 0 2.1-.2 3-.6"/></svg>';

  function passwordField(attrs = {}) {
    const input = h('input', { type: 'password', ...attrs });
    const btn = h('button', { type: 'button', class: 'eye', title: 'Показать пароль', 'aria-label': 'Показать пароль', 'aria-pressed': 'false' });
    btn.innerHTML = EYE;
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.innerHTML = show ? EYE_OFF : EYE;
      btn.setAttribute('aria-pressed', String(show));
      const label = show ? 'Скрыть пароль' : 'Показать пароль';
      btn.setAttribute('aria-label', label);
      btn.title = label;
      input.focus();
    });
    return h('div', { class: 'pw' }, input, btn);
  }

  // плавное закрытие окон
  function closeOverlay(overlay) {
    if (!overlay.isConnected || overlay.classList.contains('closing')) return;
    overlay.classList.add('closing');
    setTimeout(() => overlay.remove(), 190);
  }

  function openPasswordModal() {
    const oldPw = passwordField({ name: 'old', autocomplete: 'current-password', 'aria-label': 'Текущий пароль' });
    const newPw = passwordField({ name: 'new', autocomplete: 'new-password', 'aria-label': 'Новый пароль' });
    const repPw = passwordField({ name: 'rep', autocomplete: 'new-password', 'aria-label': 'Повтори новый пароль' });
    const error = h('div', { class: 'error' });
    const overlay = h('div', { class: 'overlay' });
    const close = () => closeOverlay(overlay);
    overlay.addEventListener('tq-close', close);
    overlay.addEventListener('mousedown', (e) => e.target === overlay && close());
    const val = (box) => box.querySelector('input').value;
    const submit = h('button', { class: 'btn', type: 'submit' }, 'Сменить пароль');
    const form = h(
      'form',
      { novalidate: true, class: 'modal narrow', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Смена пароля' },
      h('div', { class: 'head' }, h('h1', { style: 'font-size:18px;flex:1;margin:0' }, 'Смена пароля'), h('button', { type: 'button', class: 'icon-btn', onclick: close, 'aria-label': 'Закрыть' }, '✕')),
      h('label', { class: 'field' }, 'Текущий пароль'),
      oldPw,
      h('label', { class: 'field' }, 'Новый пароль'),
      newPw,
      h('div', { class: 'sub', style: 'margin:6px 0 0;font-size:12px' }, 'Минимум 8 символов. Остальные устройства выйдут из аккаунта.'),
      h('label', { class: 'field' }, 'Повтори новый пароль'),
      repPw,
      error,
      h('div', { class: 'modal-actions' }, h('button', { type: 'button', class: 'btn ghost', onclick: close }, 'Отмена'), submit),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.textContent = '';
      if (val(newPw).length < 8) return (error.textContent = 'Новый пароль: минимум 8 символов');
      if (val(newPw) !== val(repPw)) return (error.textContent = 'Пароли не совпадают');
      submit.disabled = true;
      try {
        await api.post('/api/auth/password', { old_password: val(oldPw), new_password: val(newPw) });
        close();
        toast('Пароль изменён');
      } catch (err) {
        error.textContent = err.message;
        submit.disabled = false;
      }
    });
    overlay.append(form);
    document.body.append(overlay);
    oldPw.querySelector('input').focus();
  }

  // ---------- левая панель ----------

  function openDrawer() {
    document.querySelectorAll('.drawer-wrap').forEach((d) => d.remove());
    const list = h('div', { class: 'drawer-list' }, h('div', { class: 'drawer-note' }, 'Загрузка…'));
    const close = () => {
      wrap.classList.remove('open');
      wrap.classList.add('closing');
      setTimeout(() => wrap.remove(), 520);
    };
    const go = (href) => () => {
      close();
      if (href.startsWith('/')) location.href = href;
      else location.hash = href;
    };
    const wrap = h(
      'div',
      { class: 'overlay drawer-wrap' },
      h('div', { class: 'scrim', onclick: close }),
      h(
        'aside',
        { class: 'drawer', role: 'dialog', 'aria-label': 'Меню' },
        h('div', { class: 'drawer-head' }, logoEl({ onclick: close }), h('button', { class: 'icon-btn', 'aria-label': 'Закрыть меню', onclick: close }, '✕')),
        h('button', { class: 'drawer-item', onclick: go('#/') }, icon('home'), 'Кабинет'),
        h('button', { class: 'drawer-item', onclick: () => { close(); toggleDock(true, true); } }, icon('spark'), 'AI tasqly'),
        h('button', { class: 'drawer-item', onclick: go('/') }, icon('home'), 'О tasqly'),
        h('button', { class: 'drawer-item', onclick: () => (close(), openInbox(document.querySelector('.mail-btn'))) }, icon('mail'), 'Входящие'),
        h('div', { class: 'drawer-title' }, 'Пространства'),
        list,
      ),
    );
    wrap.addEventListener('tq-close', close);
    document.body.append(wrap);
    requestAnimationFrame(() => wrap.classList.add('open'));
    api
      .get('/api/workspaces')
      .then(({ workspaces }) => {
        list.replaceChildren(
          ...(workspaces.length
            ? workspaces.map((w) => h('button', { class: 'drawer-item', onclick: go(`#/w/${w.id}`) }, icon('folder'), h('span', { class: 'grow' }, w.name)))
            : [h('div', { class: 'drawer-note' }, 'Пространств пока нет')]),
        );
      })
      .catch(() => list.replaceChildren(h('div', { class: 'drawer-note' }, 'Не удалось загрузить')));
  }

  // ---------- письма (входящие) ----------

  let inboxEl = null;
  function closeInbox() {
    if (!inboxEl) return;
    inboxEl.remove();
    inboxEl = null;
    document.removeEventListener('mousedown', onInboxOutside, true);
  }
  function onInboxOutside(e) {
    if (inboxEl && !inboxEl.contains(e.target) && !e.target.closest('.mail-btn')) closeInbox();
  }

  async function openInbox(anchor) {
    if (inboxEl) return closeInbox();
    closeMenu();
    const body = h('div', { class: 'inbox-body' }, h('div', { class: 'drawer-note' }, 'Загрузка…'));
    inboxEl = h('div', { class: 'popover inbox', role: 'dialog', 'aria-label': 'Входящие' }, h('div', { class: 'popover-head' }, 'Входящие'), body);
    document.body.append(inboxEl);
    document.addEventListener('mousedown', onInboxOutside, true);
    try {
      const data = await api.get('/api/inbox');
      const today = todayIso();
      const seen = lastSeen();
      const openTo = (href) => {
        closeInbox();
        location.hash = href;
      };
      const rows = [];
      if (data.comments.length) {
        rows.push(h('div', { class: 'popover-title' }, 'Комментарии'));
        data.comments.forEach((c) =>
          rows.push(
            h(
              'button',
              { class: `mail-row${c.created_at > seen ? ' unread' : ''}`, onclick: () => openTo(`#/p/${c.project_id}`) },
              avatar(c.author || '?'),
              h('div', { class: 'mail-text' }, h('div', { class: 'mail-top' }, h('b', null, c.author || 'Кто-то'), c.mentioned ? ' упомянул тебя в «' : ' в «', c.title, '»'), h('div', { class: 'mail-sub' }, c.body)),
              h('span', { class: 'mail-time' }, new Date(c.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })),
            ),
          ),
        );
      }
      if (data.tasks.length) {
        rows.push(h('div', { class: 'popover-title' }, 'Назначено тебе'));
        data.tasks.forEach((t) =>
          rows.push(
            h(
              'button',
              { class: 'mail-row', onclick: () => openTo(`#/p/${t.project_id}`) },
              h('span', { class: `dot${t.due_date && t.due_date < today ? ' late' : ''}` }),
              h('div', { class: 'mail-text' }, h('div', { class: 'mail-top' }, t.title), h('div', { class: 'mail-sub' }, `${t.project_name} · ${t.column_name}`)),
              t.due_date ? h('span', { class: `mail-time${t.due_date < today ? ' late' : ''}` }, formatDate(t.due_date)) : null,
            ),
          ),
        );
      }
      body.replaceChildren(...(rows.length ? rows : [h('div', { class: 'drawer-note empty-inbox' }, 'Писем нет. Здесь появятся задачи, назначенные тебе, и комментарии к ним.')]));
      localStorage.setItem(SEEN_KEY, String(Date.now()));
      const badge = document.querySelector('.mail-btn .badge');
      if (badge) badge.remove();
    } catch {
      body.replaceChildren(h('div', { class: 'drawer-note' }, 'Не удалось загрузить'));
    }
  }

  async function loadBadge(btn) {
    try {
      const data = await api.get('/api/inbox');
      const today = todayIso();
      const n = data.comments.filter((c) => c.created_at > lastSeen()).length + data.tasks.filter((t) => t.due_date && t.due_date < today).length;
      if (n && btn.isConnected && !btn.querySelector('.badge')) btn.append(h('span', { class: 'badge' }, n > 9 ? '9+' : String(n)));
    } catch {
      /* без значка */
    }
  }

  // ---------- профиль ----------

  function openProfile(anchor) {
    const order = ['auto', 'light', 'dark'];
    const names = { auto: 'как в системе', light: 'светлая', dark: 'тёмная' };
    closeInbox();
    openMenu(anchor, [
      { label: state.user.name, disabled: true, onClick() {} },
      { label: 'Мой профиль', onClick() { location.hash = '#/profile'; } },
      '-',
      {
        label: `Тема: ${names[themeStore.get()]}`,
        onClick() {
          const next = order[(order.indexOf(themeStore.get()) + 1) % order.length];
          setTheme(next, anchor);
          toast(THEME_TEXT[next]);
        },
      },
      '-',
      { label: 'Сменить пароль', onClick: openPasswordModal },
      { label: 'О tasqly (главная страница)', onClick() { location.href = '/'; } },
      '-',
      { label: 'Выйти', danger: true, onClick: logout },
    ]);
    if (menuEl) menuEl.classList.add('right');
  }

    // логотип: знак «q» на акцентном фоне + слово
  const PLANS = [
    { name: 'Старт', price: '0 ₸', per: 'навсегда', text: 'Для одиночек и небольших дел.', items: ['Проекты и задачи', 'Заметки', 'Таймер времени', 'До 3 человек'] },
    { name: 'Команда', price: '2 500 ₸', per: 'за человека в мес', text: 'Для команд, где важен контроль. 5 дней бесплатно.', badge: 'Популярный', trial: true, items: ['Всё из «Старт»', 'Чат и диск', 'Обзор и отчёты по времени', 'AI-помощник', 'До 30 человек'] },
    { name: 'Бизнес', price: 'по запросу', per: '', text: 'Для компаний со своими требованиями.', items: ['Всё из «Команда»', 'Помощь с запуском', 'Приоритетная поддержка', 'Свои условия'] },
  ];

  const planCard = (pl, i, extra = {}) => h('div', Object.assign({ class: `pr-card pr-${i}` }, extra),
    h('div', { class: 'pr-head' }, h('h3', null, pl.name), pl.badge ? h('span', { class: 'pr-badge' }, pl.badge) : null),
    h('div', { class: 'pr-price' }, h('b', null, pl.price), pl.per ? h('small', null, pl.per) : null),
    h('p', null, pl.text),
    h('ul', null, pl.items.map((t) => h('li', null, t))),
    h('a', { class: 'btn pr-go', href: i === 2 ? '/contacts' : '/register' }, i === 2 ? 'Связаться' : pl.trial ? 'Попробовать 5 дней' : 'Начать'));
  function logoEl(attrs) {
    return h('a', Object.assign({ class: 'logo', href: IN_PANEL ? '#/' : '/', 'aria-label': 'tasqly' }, attrs), h('span', { class: 'logo-word' }, 'tasqly'));
  }

  // ---------- быстрое создание и учёт времени из верхней панели ----------
  const wsCache = {};
  async function loadWorkspaceFull(id) {
    if (!wsCache[id] || Date.now() - wsCache[id].at > 15000) wsCache[id] = { at: Date.now(), data: await api.get(`/api/workspaces/${id}`) };
    return wsCache[id].data;
  }
  async function pickWorkspaces() {
    const list = (await api.get('/api/workspaces')).workspaces;
    if (!list.length) throw new Error('сначала создай пространство');
    const pre = aiCtx.workspaceId || lastWsStore.get();
    const ordered = [...list].sort((a, b) => (a.id === pre ? -1 : b.id === pre ? 1 : 0));
    return ordered;
  }
  function selectEl(options, value) {
    const sel = h('select', null, options.map(([v, label]) => h('option', { value: v }, label)));
    if (value !== undefined) sel.value = value;
    return sel;
  }
  function openSheet(title, fields, submitLabel, onSubmit, extra) {
    const overlay = h('div', { class: 'overlay' });
    const close = () => closeOverlay(overlay);
    overlay.addEventListener('tq-close', close);
    overlay.addEventListener('mousedown', (e) => e.target === overlay && close());
    const error = h('div', { class: 'error' });
    const submit = h('button', { class: 'btn', type: 'submit' }, submitLabel);
    const form = h('form', { novalidate: true, class: 'modal narrow', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'head' }, h('h1', { style: 'font-size:18px;flex:1;margin:0' }, title), h('button', { type: 'button', class: 'icon-btn', onclick: close, 'aria-label': 'Закрыть' }, '✕')),
      ...fields, extra || null, error,
      h('div', { class: 'modal-actions' }, h('button', { type: 'button', class: 'btn ghost', onclick: close }, 'Отмена'), submitLabel ? submit : null));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.textContent = '';
      submit.disabled = true;
      try {
        await onSubmit(close);
      } catch (err) {
        error.textContent = err.message;
        submit.disabled = false;
      }
    });
    overlay.append(form);
    document.body.append(overlay);
    const first = form.querySelector('input, textarea, select');
    if (first) first.focus();
    return { overlay, close, form };
  }
  const field = (label, control) => [h('label', { class: 'field' }, label), control];

  async function openQuickCreate(kind) {
    let wsList;
    try {
      wsList = await pickWorkspaces();
    } catch (e) {
      return toast(e.message);
    }
    const titles = { task: 'Новая задача', meeting: 'Новая встреча', note: 'Новая заметка', doc: 'Новый документ' };
    const wsSel = selectEl(wsList.map((w) => [w.id, w.name]));
    const projSel = selectEl([]);
    const title = h('input', { type: 'text', maxlength: 200, placeholder: kind === 'meeting' ? 'О чём встреча' : kind === 'task' ? 'Что нужно сделать' : 'Заголовок' });
    const date = h('input', { type: 'date' });
    const time = h('input', { type: 'time', value: '10:00' });
    const text = h('textarea', { rows: 5, placeholder: kind === 'doc' ? 'Текст документа' : 'Текст заметки', maxlength: 20000 });
    let detail = null;
    const loadProjects = async () => {
      detail = await loadWorkspaceFull(wsSel.value);
      projSel.replaceChildren(...detail.projects.map((p) => h('option', { value: p.id }, p.name)));
    };
    const needsProject = kind === 'task' || kind === 'meeting';
    const fields = [
      ...(wsList.length > 1 ? field('Пространство', wsSel) : []),
      ...(needsProject ? field('Проект', projSel) : []),
      ...field(kind === 'doc' || kind === 'note' ? 'Заголовок' : 'Название', title),
      ...(kind === 'task' ? field('Срок (необязательно)', date) : []),
      ...(kind === 'meeting' ? [...field('Дата', date), ...field('Время', time)] : []),
      ...(kind === 'note' || kind === 'doc' ? field('Текст', text) : []),
    ];
    wsSel.addEventListener('change', () => needsProject && loadProjects().catch((e) => toast(e.message)));
    const sheet = openSheet(titles[kind], fields, 'Создать', async (close) => {
      const name = title.value.trim();
      if (!name) throw new Error('введи название');
      if (kind === 'note' || kind === 'doc') {
        await api.post(`/api/workspaces/${wsSel.value}/notes`, { title: name, body: text.value });
        toast(kind === 'doc' ? 'Документ создан' : 'Заметка создана');
        close();
        if (kind === 'doc' || kind === 'note') location.hash = `#/w/${wsSel.value}/notes`;
        return;
      }
      if (!projSel.value) throw new Error('в пространстве нет проектов: создай проект');
      if (kind === 'meeting' && !date.value) throw new Error('выбери дату встречи');
      const body = { title: name };
      if (date.value) body.due_date = date.value;
      if (kind === 'meeting') body.description = `Встреча, ${time.value || 'время не указано'}`;
      const { task } = await api.post(`/api/projects/${projSel.value}/tasks`, body);
      if (kind === 'meeting') {
        try {
          let label = (detail?.labels || []).find((l) => l.name.toLowerCase() === 'встреча');
          if (!label) label = (await api.post(`/api/workspaces/${wsSel.value}/labels`, { name: 'встреча', color: '#3e63dd' })).label;
          await api.put(`/api/tasks/${task.id}/labels`, { label_ids: [label.id] });
          delete wsCache[wsSel.value];
        } catch {
          /* метка не критична */
        }
      }
      toast(kind === 'meeting' ? 'Встреча создана' : 'Задача создана');
      close();
      location.hash = `#/p/${projSel.value}`;
      route();
    });
    if (needsProject) {
      loadProjects().then(() => {
        if (!detail.projects.length) sheet.form.querySelector('.error').textContent = 'в пространстве пока нет проектов: создай проект на странице пространства';
      }).catch((e) => toast(e.message));
    }
  }

  function openQuickMenu(anchor) {
    openMenu(anchor, [
      { label: 'Быстрое создание', disabled: true, onClick() {} },
      '-',
      { label: 'Задача', onClick: () => openQuickCreate('task') },
      { label: 'Встреча', onClick: () => openQuickCreate('meeting') },
      { label: 'Заметка', onClick: () => openQuickCreate('note') },
      { label: 'Документ', onClick: () => openQuickCreate('doc') },
    ]);
    if (menuEl) menuEl.classList.add('right');
  }

  async function openTrackTime() {
    let wsList;
    try {
      wsList = await pickWorkspaces();
    } catch (e) {
      return toast(e.message);
    }
    const wsSel = selectEl(wsList.map((w) => [w.id, w.name]));
    const projSel = selectEl([]);
    const taskSel = selectEl([]);
    let projects = [];
    const loadTasks = async () => {
      if (!projSel.value) return taskSel.replaceChildren(h('option', { value: '' }, 'нет задач'));
      const r = await api.get(`/api/projects/${projSel.value}`);
      const done = new Set(r.columns.filter((c) => c.is_done).map((c) => c.id));
      const open = r.tasks.filter((t) => !done.has(t.column_id));
      taskSel.replaceChildren(...(open.length ? open.map((t) => h('option', { value: t.id }, t.title)) : [h('option', { value: '' }, 'нет открытых задач')]));
    };
    const loadProjects = async () => {
      projects = (await loadWorkspaceFull(wsSel.value)).projects;
      projSel.replaceChildren(...(projects.length ? projects.map((p) => h('option', { value: p.id }, p.name)) : [h('option', { value: '' }, 'нет проектов')]));
      await loadTasks();
    };
    wsSel.addEventListener('change', () => loadProjects().catch((e) => toast(e.message)));
    projSel.addEventListener('change', () => loadTasks().catch((e) => toast(e.message)));
    const running = state.timer
      ? h('div', { class: 'track-now' }, h('span', { class: 'rec' }), h('div', null, h('b', null, state.timer.task_title), h('span', null, 'идёт ')), h('b', { class: 'timer-live' }, fmtClock(elapsedSec())), h('button', { type: 'button', class: 'btn ghost small', onclick: async () => { await stopTimer(); sheet.close(); } }, 'Остановить'))
      : null;
    const sheet = openSheet('Отследить время', [running, ...(wsList.length > 1 ? field('Пространство', wsSel) : []), ...field('Проект', projSel), ...field('Задача', taskSel)].filter(Boolean), state.timer ? 'Переключить' : 'Начать', async (close) => {
      if (!taskSel.value) throw new Error('выбери задачу');
      const r = await api.post(`/api/tasks/${taskSel.value}/timer/start`, {});
      state.timer = r.entry;
      state.timerLoaded = true;
      timerOffset = r.server_time - Date.now();
      paintTimer();
      window.dispatchEvent(new Event('tq-timer'));
      toast('Таймер запущен');
      close();
    });
    loadProjects().catch((e) => toast(e.message));
  }

  function topbar(crumbs) {
    const mail = state.user ? h('button', { class: 'icon-btn mail-btn', title: 'Входящие', 'aria-label': 'Входящие', onclick: (e) => openInbox(e.currentTarget) }, icon('mail')) : null;
    if (mail) loadBadge(mail);
    if (state.user) {
      if (state.timerLoaded) queueMicrotask(paintTimer);
      else refreshTimer();
    }
    const quickBtn = state.user ? h('button', { class: 'icon-btn quick-btn', title: 'Быстрое создание', 'aria-label': 'Быстрое создание', 'aria-haspopup': 'menu', onclick: (e) => openQuickMenu(e.currentTarget) }, icon('plus')) : null;
    const trackBtn = state.user ? h('button', { class: 'track-btn', title: 'Отследить время', 'aria-label': 'Отследить время', onclick: openTrackTime }, icon('clock'), h('span', null, 'Отследить время')) : null;
    const aiBtn = state.user
      ? h('button', { class: 'ai-btn', title: 'AI tasqly', 'aria-label': 'Открыть AI', 'aria-pressed': String(document.body.classList.contains('ai-open')), onclick: () => toggleDock() }, icon('spark'), h('span', null, 'AI'))
      : null;
    const profile = state.user
      ? h('button', { class: 'profile-btn', title: state.user.name, 'aria-label': 'Профиль', onclick: (e) => openProfile(e.currentTarget) }, avatar(state.user.name))
      : null;
    return h(
      'header',
      { class: 'topbar' },
      state.user ? h('button', { class: 'icon-btn', title: 'Меню', 'aria-label': 'Открыть меню', onclick: openDrawer }, icon('menu')) : null,
      logoEl(),
      h('nav', { class: 'crumbs' }, crumbs.map((c) => [h('span', null, '/'), c.href ? h('a', { href: c.href }, c.label) : h('span', { class: 'current' }, c.label)])),
      h('div', { class: 'timer-slot' }),
      quickBtn,
      trackBtn,
      aiBtn,
      themeToggle(),
      mail,
      profile,
    );
  }

  function render(...nodes) {
    app.replaceChildren(...nodes.filter(Boolean));
  }

  async function logout() {
    try {
      await api.post('/api/auth/logout');
    } catch {
      /* всё равно выходим */
    }
    tokenStore.set('');
    try { localStorage.removeItem('tq_user'); } catch { /* нет хранилища */ }
    cacheClear();
    state.user = null;
    state.timer = null;
    state.timerLoaded = false;
    destroyDock();
    lastWsStore.set('');
    location.href = '/';
  }

  // ---------- вход ----------

  // ---------- лендинг: что такое tasqly (для тех, кто не вошёл) ----------

  function viewLanding() {
    document.title = 'tasqly — задачи, время и команда в одном пространстве';
    destroyDock();
    const to = (id) => () => {
      const el = document.getElementById(id);
      if (!el) return;
      const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: el.classList.contains('kind-row') ? 'center' : 'start' });
      if (el.classList.contains('kind-row')) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1800); }
    };
    const logo = logoEl();
    const calmMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const chev = () => { const sp = h('span', { class: 'chev', 'aria-hidden': 'true' }); sp.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5 6 8l3.5-3.5"/></svg>'; return sp; };
    const dd = (label, items) => h('button', { class: 'nav-dd', 'aria-haspopup': 'menu', onclick: (e) => openMenu(e.currentTarget, items.map(([t, id]) => ({ label: t, onClick: to(id) }))) }, label, chev());
    const themeChip = themeToggle('nav-theme');
    function landNav() {
      return h(
        'header',
        { class: 'land-nav' },
        logo,
        h('span', { class: 'grow' }),
        h('nav', { class: 'land-links' }, dd('Возможности', [['Задачи и доски', 'roles'], ['Учёт времени', 'sc-time'], ['AI tasqly', 'ai']]), dd('Проекты', [['Базовый', 'kind-basic'], ['Продвинутый', 'kind-advanced'], ['IT', 'kind-it']]), h('button', { onclick: to('steps') }, 'Как начать'), h('button', { onclick: to('pricing') }, 'Тарифы')),
        ...(state.user
          ? [themeChip, h('a', { class: 'btn small nav-cta', href: PANEL }, 'Кабинет')]
          : [h('span', { class: 'nav-sep' }), h('a', { class: 'nav-link', href: '/login' }, 'Войти'), h('a', { class: 'nav-link nav-reg', href: '/register' }, 'Регистрация'), themeChip, h('a', { class: 'btn small nav-cta', href: PANEL + '#/register' }, 'Начать сейчас')]),
      );
    }

    // демо-доска: одна карточка сама переезжает в «Готово»
    const demoCard = (title, extra = [], cls = '') => h('div', { class: `demo-card ${cls}` }, h('div', { class: 'demo-title' }, title), h('div', { class: 'demo-meta' }, extra));
    const demo = h(
      'div',
      { class: 'demo', 'aria-hidden': 'true' },
      h('div', { class: 'demo-bar' }, h('i'), h('i'), h('i'), h('span', null, 'Запуск сайта')),
      h(
        'div',
        { class: 'demo-cols' },
        h('div', { class: 'demo-col' }, h('div', { class: 'demo-head' }, 'К выполнению', h('b', null, '2')), demoCard('Написать тексты', [h('span', { class: 'pill', style: '--c:#8e4ec6' }, 'контент'), h('span', null, '19 нояб.')]), demoCard('Подключить оплату', [h('span', { class: 'pill', style: '--c:#e5484d' }, 'срочно'), h('span', null, '⏱ 1 ч 20 мин')])),
        h('div', { class: 'demo-col' }, h('div', { class: 'demo-head' }, 'В работе', h('b', null, '1')), demoCard('Нарисовать главную', [h('span', { class: 'pill', style: '--c:#3e63dd' }, 'дизайн'), h('span', null, '☑ 2/3')], 'travel')),
        h('div', { class: 'demo-col' }, h('div', { class: 'demo-head' }, h('span', null, 'Готово ', h('em', null, '✓')), h('b', null, '1')), demoCard('Бриф клиента', [h('span', null, '14 нояб.')], 'is-done')),
      ),
      h('div', { class: 'demo-ai' }, h('span', { class: 'avatar ai-avatar' }, 'AI'), h('span', null, 'Просрочена одна задача: «Подключить оплату». Исполнитель не назначен.')),
    );

    const features = [
      ['Три типа проектов', 'Базовый, продвинутый и IT: каждый со своими колонками под процесс, от «К выполнению» до «Code review».'],
      ['Доска, список, календарь', 'Одни и те же задачи в трёх видах. Перетаскивай карточки и даты, ищи и фильтруй по людям, меткам, срокам.'],
      ['Учёт времени', 'Таймер в задаче и ручной ввод. Видно, сколько ушло, и сравнение с оценкой. Отчёт по людям и проектам.'],
      ['Обзор проекта', 'Процент выполнения, просрочки, нагрузка на команду и ближайшие дедлайны на одном экране.'],
      ['Заметки', 'Общие заметки пространства: договорённости, идеи, детали. Сохраняются сами.'],
      ['Чат команды', 'Быстрые обсуждения рядом с задачами, без отдельного мессенджера.'],
      ['Диск', 'Файлы пространства в одном месте: загрузил, и вся команда скачала.'],
      ['AI tasqly', 'Подскажет, что горит, соберёт план на день, превратит текст встречи в задачи и разобьёт задачу на шаги.'],
    ];

    const kinds = [
      ['Базовый', 'Для небольших дел и личных проектов', ['К выполнению', 'В работе', 'Готово']],
      ['Продвинутый', 'Для команд, которым нужна проверка и оценка времени', ['Бэклог', 'К выполнению', 'В работе', 'На проверке', 'Готово']],
      ['IT', 'Для разработки: спринты, ревью, баги и фичи', ['Бэклог', 'Спринт', 'В работе', 'Code review', 'Тестирование', 'Готово']],
    ];

    const tvMsg = (name, color, text, time) => h('div', { class: `tv-m${name ? '' : ' me'}` }, name ? h('span', { class: 'tv-av', style: `background:${color}` }, name[0]) : null, h('div', { class: 'tv-b' }, name ? h('b', { class: 'tv-n' }, name) : null, h('p', null, text), h('time', null, time)));
    let tabIdx = 0;
    const tabsData = [
      ['Планирование', 'Ставь задачи, назначай исполнителей и сроки, раскладывай по колонкам и меткам. Карточки и даты перетаскиваются мышью.',
        () => h('div', { class: 'tv-board' }, ...[['Бэклог', ['Согласовать макеты', 'Собрать тексты']], ['В работе', ['Нарисовать главную']], ['Готово', ['Бриф клиента']]].map(([n, cs]) => h('div', null, h('em', null, n), ...cs.map((c, i) => h('span', { class: n === 'Готово' ? 'done' : '' }, c)))))],
      ['Время', 'Таймер включается в задаче или время вносится вручную. Отчёт по людям и проектам показывает, куда уходят часы.',
        () => h('div', { class: 'tv-time' }, h('div', { class: 'tv-clock' }, h('span', { class: 'rec' }), h('b', null, '00:42:17')), ...[['Айгерим', 80, '6 ч 40 мин'], ['Данияр', 52, '4 ч 15 мин'], ['Мария', 26, '2 ч 05 мин']].map(([n, w, t]) => h('div', { class: 'tv-row' }, h('span', null, n), h('i', null, h('u', { style: `width:${w}%` })), h('em', null, t))))],
      ['Общение', 'Чат пространства, комментарии к задачам и общие заметки. Договорённости остаются рядом с работой.',
        () => h('div', { class: 'tv-chat' }, tvMsg('Айгерим', '#8e4ec6', 'Макеты готовы, смотрите', '10:12'), tvMsg(null, null, 'Принято, беру вёрстку', '10:14'), tvMsg('Айгерим', '#8e4ec6', 'Бриф лежит на диске', '10:15'), h('div', { class: 'tv-file' }, h('i', null, 'PDF'), 'бриф-клиента.pdf', h('em', null, '184 КБ')))],
      ['AI', 'Помощник знает твои задачи: подскажет, что горит, соберёт план на день и превратит текст встречи в список задач.',
        () => h('div', { class: 'tv-ai' }, tvMsg(null, null, 'Что горит на этой неделе?', '10:20'), h('div', { class: 'tv-m' }, h('span', { class: 'tv-av ai' }, 'AI'), h('div', { class: 'tv-b' }, h('b', { class: 'tv-n' }, 'AI tasqly'), h('p', null, 'Две задачи требуют внимания:', h('span', { class: 'tv-li' }, h('strong', null, 'Подключить оплату'), ' просрочена'), h('span', { class: 'tv-li' }, h('strong', null, 'Согласовать макеты'), ' срок через 5 дней')))), h('div', { class: 'tv-chips' }, h('span', null, 'Назначить Данияра'), h('span', null, 'План на день')))],
    ];
    const tabsBox = h('div', { class: 'ftabs' });
    const tabBtns = tabsData.map(([n, d], i) => h('button', { role: 'tab', onclick: () => selectTab(i) }, h('b', null, n), h('span', null, d)));
    const ind = h('i', { class: 'ft-ind', 'aria-hidden': 'true' });
    const tabList = h('div', { class: 'ft-list', role: 'tablist' }, ind, ...tabBtns);
    const tabHolder = h('div', { class: 'ft-holder' });
    tabsBox.append(tabList, tabHolder);
    // инерционный маркер: пружина тянет лайм-полосу к активной вкладке, пока вкладки раскрываются
    let indY = 0, indH = 0, vY = 0, vH = 0, indRaf = 0, indInit = false;
    const stepInd = () => {
      const b = tabBtns[tabIdx];
      const ty = b.offsetTop, th = b.offsetHeight;
      if (!indInit || calmMotion) { indY = ty; indH = th; vY = vH = 0; indInit = true; }
      else { vY = (vY + (ty - indY) * 0.085) * 0.8; vH = (vH + (th - indH) * 0.085) * 0.8; indY += vY; indH += vH; }
      ind.style.transform = `translateY(${indY.toFixed(2)}px)`;
      ind.style.height = `${Math.max(0, indH).toFixed(2)}px`;
      indRaf = (Math.abs(ty - indY) > 0.3 || Math.abs(th - indH) > 0.3 || Math.abs(vY) > 0.08 || Math.abs(vH) > 0.08) ? requestAnimationFrame(stepInd) : 0;
    };
    const runInd = () => { if (!indRaf) indRaf = requestAnimationFrame(stepInd); };
    const onTabsResize = () => { indInit = false; runInd(); };
    window.addEventListener('resize', onTabsResize);
    function selectTab(i) {
      const dir = i >= tabIdx ? 1 : -1;
      tabIdx = i;
      tabBtns.forEach((b, j) => { b.classList.toggle('active', j === i); b.setAttribute('aria-selected', String(j === i)); });
      const fresh = h('div', { class: 'ft-view', style: `--dir:${dir}` }, tabsData[i][2]());
      const old = tabHolder.querySelector('.ft-view:not(.leaving)');
      if (old && !calmMotion) { old.classList.add('leaving'); old.style.setProperty('--dir', String(dir)); setTimeout(() => old.remove(), 500); }
      else if (old) old.remove();
      tabHolder.append(fresh);
      runInd();
    }
    selectTab(tabIdx);


    // ---------- витрина: живые мини-экраны продукта ----------
    const svgEl = (html, cls, size) => { const sp = h('span', { class: cls, 'aria-hidden': 'true' }); sp.innerHTML = html; return sp; };
    const clockText = (sec) => `${String(Math.floor(sec / 3600)).padStart(2, '0')}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    let tick = 2537;
    const clock = h('b', { class: 'sc-clock' }, clockText(tick));
    const timerId = setInterval(() => { tick += 1; clock.textContent = clockText(tick); }, 1000);

    const people = [['Айгерим', 80, '6 ч 40 мин', '#3e63dd'], ['Данияр', 52, '4 ч 15 мин', '#8e4ec6'], ['Мария', 26, '2 ч 05 мин', '#30a46c']];
    const mockTime = h(
      'div',
      { class: 'sc-mock reveal', 'aria-hidden': 'true' },
      h('div', { class: 'sc-task' }, h('span', { class: 'pill', style: '--c:#3e63dd' }, 'дизайн'), h('b', null, 'Нарисовать главную')),
      h('div', { class: 'sc-timer' }, h('span', { class: 'rec' }), clock, h('span', { class: 'sc-stop' }, 'Стоп'), h('em', null, 'из 4 ч по оценке')),
      h('div', { class: 'sc-sub' }, 'Время по людям за неделю'),
      ...people.map(([n, w, t, c]) => h('div', { class: 'sc-bar' }, h('span', { class: 'sc-name' }, n), h('i', { style: `--w:${w}%;--c:${c}` }), h('span', { class: 'sc-val' }, t))),
    );

    const R = 52, CIRC = 2 * Math.PI * R;
    const mockOverview = h(
      'div',
      { class: 'sc-mock reveal', 'aria-hidden': 'true' },
      h('div', { class: 'sc-ov' },
        svgEl(`<svg viewBox="0 0 120 120" width="132" height="132"><circle cx="60" cy="60" r="${R}" fill="none" stroke="var(--border)" stroke-width="10"/><circle class="ring-fg" cx="60" cy="60" r="${R}" fill="none" stroke="var(--lime)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${CIRC.toFixed(1)}" style="--len:${CIRC.toFixed(1)};--to:${(CIRC * 0.32).toFixed(1)}" transform="rotate(-90 60 60)"/></svg><div class="ring-txt"><b>68%</b><span>готово</span></div>`, 'sc-ring'),
        h('div', { class: 'sc-tiles' },
          ...[['В работе', '7', '#3e63dd'], ['Просрочено', '2', '#e5484d'], ['Завершено', '21', '#30a46c'], ['Без исполнителя', '1', '#a0a0ac']].map(([l, n, c]) => h('div', { class: 'sc-tile', style: `--c:${c}` }, h('b', null, n), h('span', null, l))),
        ),
      ),
      h('div', { class: 'sc-deadlines' }, h('div', null, h('span', { class: 'dot late' }), 'Подключить оплату', h('em', null, 'вчера')), h('div', null, h('span', { class: 'dot' }), 'Написать тексты', h('em', null, '19 нояб.')), h('div', null, h('span', { class: 'dot' }), 'Согласовать макеты', h('em', null, '21 нояб.'))),
    );

    const mockAi = h(
      'div',
      { class: 'sc-mock reveal', 'aria-hidden': 'true' },
      h('div', { class: 'sc-msg me' }, 'Что горит на этой неделе?'),
      h('div', { class: 'sc-msg ai' }, h('span', { class: 'avatar ai-avatar' }, 'AI'), h('div', null, h('p', null, 'Две задачи требуют внимания:'), h('ul', null, h('li', null, h('b', null, 'Подключить оплату'), ' просрочена, нет исполнителя'), h('li', null, h('b', null, 'Согласовать макеты'), ' срок через 5 дней')))),
      h('div', { class: 'sc-chips' }, ['Назначить Данияра', 'Разбить на шаги', 'План на день'].map((t) => h('span', null, t))),
    );

    const showcase = [
      ['Время', 'Видно, куда уходят часы', 'Таймер включается прямо в задаче. По окончании время записывается, и сразу видно, сколько ушло против оценки и кто сколько работал.', mockTime],
      ['Обзор', 'Весь проект на одном экране', 'Процент готовности, просрочки, нагрузка на команду и ближайшие сроки. Открыл и понял, где проект, без отчётов.', mockOverview],
    ].map(([tag, title, text, mock], i) => h('div', { class: `sc-row${i % 2 ? ' flip' : ''}`, id: i === 0 ? 'sc-time' : null }, h('div', { class: 'sc-copy reveal' }, h('span', { class: 'sc-tag' }, tag), h('h3', null, title), h('p', null, text)), mock));

    const aiPrompts = ['Что горит на этой неделе?', 'Собери план на сегодня', 'Кто перегружен?', 'Разбей задачу на шаги', 'Текст встречи в задачи'];
    const aiSection = h('section', { class: 'land-sec', id: 'ai' }, h('div', { class: 'ai-sec' },
      h('div', { class: 'ai-sec-copy reveal' },
        h('span', { class: 'sc-tag' }, 'AI tasqly'),
        h('h2', null, 'Помощник, который знает твои задачи'),
        h('p', null, 'Спроси «что горит» и получишь ответ по данным твоего пространства. Он разобьёт большую задачу на шаги, соберёт план на день и превратит текст встречи в список задач.'),
        h('div', { class: 'ai-chips' }, aiPrompts.map((t) => h('span', null, t))),
        h('ul', { class: 'ai-facts' },
          h('li', null, 'Отвечает только про задачи и проекты, без лишней болтовни'),
          h('li', null, 'До 40 запросов в день на человека'),
          h('li', null, 'Открывается из любого экрана: кнопка AI сверху или на весь экран')),
        h('div', { class: 'ai-sec-cta' }, h('a', { class: 'btn big', href: state.user ? PANEL : '/register' }, state.user ? 'Открыть кабинет' : 'Попробовать')),
      ),
      h('div', { class: 'ai-sec-mock reveal' }, mockAi),
    ));

    // ---------- роли: карусель карточек, сама ходит из стороны в сторону ----------
    const miniRing = (pct, color, num) => { const r = 24, c = 2 * Math.PI * r; return svgEl(`<svg viewBox="0 0 64 64" width="62" height="62"><circle cx="32" cy="32" r="${r}" fill="none" stroke="var(--border)" stroke-width="6"/><circle cx="32" cy="32" r="${r}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - pct / 100)).toFixed(1)}" transform="rotate(-90 32 32)"/></svg><b>${num}</b>`, 'rc-ring'); };
    const roleCards = [
      ['Руководителям', ['Контроль задач', 'Обзор проекта', 'Нагрузка команды', 'AI «что горит»'],
        h('div', { class: 'rc-vis rc-rings' }, miniRing(68, 'var(--lime)', '68%'), miniRing(25, '#e5484d', '2'), miniRing(90, '#30a46c', '21'), h('span', { class: 'rc-leg' }, 'готово · просрочено · завершено'))],
      ['Менеджерам проектов', ['Доска, список, календарь', 'Свои колонки', 'Метки и фильтры', 'Оценка времени'],
        h('div', { class: 'rc-vis rc-gantt' }, ...[['Дизайн', 8, 46, '#8e4ec6'], ['Вёрстка', 30, 40, '#3e63dd'], ['Тесты', 58, 34, '#30a46c'], ['Запуск', 78, 18, '#e5484d']].map(([n, l, w, c]) => h('div', { class: 'g-row' }, h('span', null, n), h('i', null, h('u', { style: `left:${l}%;width:${w}%;background:${c}` })))))],
      ['Разработчикам', ['Колонки спринта', 'Баги и фичи', 'Code review', 'Чек-листы'],
        h('div', { class: 'rc-vis rc-board' }, ...[['Спринт', ['Вход в систему', 'API задач']], ['Review', ['Таймер']], ['Готово', ['Миграции']]].map(([n, cards]) => h('div', null, h('em', null, n), ...cards.map((t) => h('span', null, t)))))],
      ['Фрилансерам', ['Базовый проект', 'Таймер в задаче', 'Заметки', 'Файлы'],
        h('div', { class: 'rc-vis rc-free' }, h('div', { class: 'rf-top' }, h('b', null, '32 ч 15 мин'), h('span', null, 'за неделю')), ...[['Лендинг для клиента', '12 ч'], ['Логотип', '7 ч 30 мин'], ['Правки', '2 ч 45 мин']].map(([n, t]) => h('div', { class: 'rf-row' }, h('span', null, n), h('em', null, t))))],
      ['Небольшим командам', ['Общий чат', 'Диск с файлами', 'Приглашение по коду', 'Роли доступа'],
        h('div', { class: 'rc-vis rc-team' }, h('div', { class: 'rt-msg' }, h('span', { class: 'avatar', style: 'background:#3e63dd' }, 'А'), 'Макеты готовы, смотрите'), h('div', { class: 'rt-msg me' }, 'Принято, беру вёрстку'), h('div', { class: 'rt-file' }, h('i', null, 'PDF'), 'бриф-клиента.pdf', h('em', null, '184 КБ')))],
    ];
    const track = h('div', { class: 'rc-track' }, h('article', { class: 'rc rc-intro' }, h('span', { class: 'rc-brand' }, 'tasqly'), h('h2', null, 'Одно решение для всех ролей'), h('div', { class: 'rc-avatars' }, ...['#3e63dd', '#8e4ec6', '#30a46c', '#e5484d'].map((c, i) => h('span', { class: 'avatar', style: `background:${c}` }, 'АДМС'[i])))), ...roleCards.map(([title, tags, vis]) => h('article', { class: 'rc' }, h('h3', null, title), h('div', { class: 'rc-tags' }, tags.map((t) => h('span', null, t))), vis)));
    const slide = (dir) => track.scrollBy({ left: dir * Math.min(420, track.clientWidth * 0.7), behavior: calmMotion ? 'auto' : 'smooth' });
    const rolesBox = h('div', { class: 'rc-wrap' }, track);
    // автоход: вправо до конца, потом обратно; пауза при наведении и касании
    let autoDir = 1, autoId = null, autoOn = true;
    function stopAuto() { autoOn = false; }
    autoId = !calmMotion ? setInterval(() => {
      if (!autoOn || document.hidden) return;
      const max = track.scrollWidth - track.clientWidth;
      if (autoDir > 0 && track.scrollLeft >= max - 4) autoDir = -1;
      else if (autoDir < 0 && track.scrollLeft <= 4) autoDir = 1;
      slide(autoDir);
    }, 2800) : null;

    // прокрутка зажатием мыши (на телефоне работает обычный свайп)
    let drag = null;
    track.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      drag = { x: e.clientX, left: track.scrollLeft, moved: false };
      autoOn = false;
    });
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    function onDragMove(e) {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) > 4) {
        drag.moved = true;
        track.classList.add('dragging');
      }
      if (drag.moved) track.scrollLeft = drag.left - dx;
    }
    function onDragEnd() {
      if (!drag) return;
      drag = null;
      track.classList.remove('dragging');
    }
    rolesBox.addEventListener('pointerenter', () => { autoOn = false; });
    rolesBox.addEventListener('pointerleave', () => { autoOn = true; });
    rolesBox.addEventListener('touchstart', () => { autoOn = false; }, { passive: true });

    // ---------- тарифы (названия и цены меняются здесь) ----------
    const pricing = h('section', { class: 'land-sec', id: 'pricing' }, h('div', { class: 'pr' },
      h('div', { class: 'pr-copy reveal' }, h('h2', null, 'Тарифы под любой бюджет'), h('p', null, 'Начни бесплатно и переходи дальше, когда команда вырастет.')),
      h('div', { class: 'pr-cards' }, PLANS.map((pl, i) => planCard(pl, i, { style: `transition-delay:${i * 90}ms`, class: `pr-card pr-${i} reveal` }))),
      h('div', { class: 'pr-more reveal' }, h('a', { href: '/pricing' }, 'Сравнить планы подробнее'), h('span', { class: 'pr-arrow', 'aria-hidden': 'true' }, '→')),
    ));

    const col = (title, links) => h('div', { class: 'lf-col' }, h('b', null, title), ...links);
    const lf = (label, id) => h('button', { type: 'button', onclick: to(id) }, label);
    const landFooter = h(
      'footer',
      { class: 'land-foot' },
      h(
        'div',
        { class: 'lf-in' },
        h('div', { class: 'lf-brand' }, logoEl({ class: 'logo' }), h('p', null, 'Задачи, время, заметки, чат и файлы команды в одном пространстве. С AI-помощником, который знает ваши проекты.')),
        col('Продукт', [lf('Возможности', 'features'), lf('Проекты', 'kinds'), lf('Как начать', 'steps'), lf('Тарифы', 'pricing')]),
        col('Аккаунт', state.user ? [h('a', { href: PANEL }, 'Кабинет')] : [h('a', { href: '/login' }, 'Войти'), h('a', { href: '/register' }, 'Создать пространство')]),
        col('Документы', [h('a', { href: '/pricing' }, 'Тарифы'), h('a', { href: '/contacts' }, 'Контакты'), h('a', { href: '/privacy' }, 'Конфиденциальность'), h('a', { href: '/terms' }, 'Условия')]),
      ),
      h('div', { class: 'lf-bottom' }, h('span', null, `© ${new Date().getFullYear()} tasqly`), h('span', null, 'Сделано в Казахстане')),
    );

    // «как начать»: три шага с мини-иллюстрациями
    let kindIdx = 1;
    const kindCols = [['К выполнению', 'В работе', 'Готово'], ['Бэклог', 'К выполнению', 'В работе', 'На проверке', 'Готово'], ['Бэклог', 'Спринт', 'В работе', 'Code review', 'Тестирование', 'Готово']];
    const kindNames = ['Базовый', 'Продвинутый', 'IT'];
    const colsRow = h('div', { class: 'st-cols' });
    const kindBtns = h('div', { class: 'st-kinds', role: 'tablist' });
    const paintKind = () => {
      kindBtns.replaceChildren(...kindNames.map((n, i) => h('button', { type: 'button', role: 'tab', class: i === kindIdx ? 'active' : '', 'aria-selected': String(i === kindIdx), onclick: () => { kindIdx = i; paintKind(); } }, n)));
      colsRow.replaceChildren(...kindCols[kindIdx].map((c, i, a) => h('span', { class: i === a.length - 1 ? 'done' : '' }, c)));
    };
    paintKind();
    const code = 'K7P2QX'.split('').map((ch) => h('i', null, ch));
    const stepsData = [
      ['Создай пространство', 'Место для команды. Другие входят по коду из шести символов.', h('div', { class: 'st-vis' }, h('div', { class: 'st-code' }, ...code), h('div', { class: 'st-people' }, ...['#3e63dd', '#8e4ec6', '#30a46c'].map((c, i) => h('span', { class: 'avatar', style: `background:${c}` }, 'АДМ'[i])), h('em', null, '3 человека уже внутри')))],
      ['Заведи проект', 'Выбери тип под свой процесс. Колонки потом можно менять.', h('div', { class: 'st-vis' }, kindBtns, colsRow)],
      ['Веди работу', 'Ставь задачи, включай таймер, спрашивай AI, что горит.', h('div', { class: 'st-vis' }, h('div', { class: 'st-task' }, h('b', null, 'Нарисовать главную'), h('span', { class: 'st-tm' }, '⏱ 00:42'), h('ul', null, h('li', { class: 'ok' }, 'Собрать референсы'), h('li', { class: 'ok' }, 'Набросать структуру'), h('li', null, 'Подготовить макет'))))],
    ];
    const stepsSection = h('section', { class: 'land-sec', id: 'steps' }, h('h2', null, 'Как начать: три шага, меньше минуты'), h('ol', { class: 'st' }, stepsData.map(([t, d, vis], i) => h('li', { class: 'reveal' }, h('span', { class: 'step-n' }, i + 1), h('b', null, t), h('span', { class: 'st-d' }, d), vis))));

    // плавное появление при прокрутке; без анимаций, если система просит меньше движения
    const calm = calmMotion;
    let io = null;
    if (!calm && 'IntersectionObserver' in window) {
      io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: 0.25 });
      setTimeout(() => document.querySelectorAll('.land .reveal').forEach((el) => io.observe(el)), 0);
    } else setTimeout(() => document.querySelectorAll('.land .reveal').forEach((el) => el.classList.add('in')), 0);
    cleanup = () => { cancelAnimationFrame(indRaf); window.removeEventListener('resize', onTabsResize); window.removeEventListener('pointermove', onDragMove); window.removeEventListener('pointerup', onDragEnd); clearInterval(timerId); if (autoId) clearInterval(autoId); if (io) io.disconnect(); };

    render(
      h(
        'div',
        { class: 'land' },
        landNav(),
        h(
          'section',
          { class: 'hero' },
          h(
            'div',
            { class: 'hero-copy' },
            h('h1', null, 'Вся работа команды на ', h('em', { class: 'wave' }, 'одной доске')),
            h('p', null, 'tasqly собирает задачи, учёт времени, заметки, чат и файлы в одном пространстве. AI подскажет, что горит, и разобьёт большую задачу на шаги.'),
            h('div', { class: 'hero-cta' }, state.user ? h('a', { class: 'btn big', href: PANEL }, 'Открыть кабинет') : [h('a', { class: 'btn big', href: PANEL + '#/register' }, 'Создать пространство'), h('a', { class: 'btn ghost big', href: PANEL + '#/login' }, 'Войти')]),
            h('div', { class: 'hero-note' }, '5 дней «Команды» в подарок. Регистрация за минуту, карта не нужна.'),
          ),
          demo,
        ),
        h('section', { class: 'land-sec', id: 'showcase' }, h('h2', null, 'Не просто доска: всё для работы рядом'), h('div', { class: 'sc' }, showcase)),
        aiSection,
        h('section', { class: 'land-sec wide', id: 'roles' }, rolesBox),
        h('section', { class: 'land-sec', id: 'tabs' }, h('h2', null, 'tasqly подстраивается под твои задачи'), tabsBox),
        h('section', { class: 'land-sec', id: 'features' }, h('h2', null, 'Всё, что нужно для работы, в одном месте'), h('div', { class: 'bento' }, features.map(([t, d], i) => h('div', { class: 'bento-cell reveal', style: `transition-delay:${(i % 4) * 70}ms` }, h('span', { class: 'bento-ic', 'aria-hidden': 'true' }, svgEl(`<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${FIC[i]}</svg>`)), h('b', null, t), h('span', null, d))))),
        h(
          'section',
          { class: 'land-sec', id: 'kinds' },
          h('h2', null, 'Проект под твой процесс'),
          h('div', { class: 'kinds-list' }, kinds.map(([name, hint, cols], ki) => h('div', { class: 'kind-row', id: ['kind-basic', 'kind-advanced', 'kind-it'][ki] }, h('div', { class: 'kind-info' }, h('b', null, name), h('span', null, hint)), h('div', { class: 'kind-cols' }, cols.map((c, i) => h('span', { class: `kcol${i === cols.length - 1 ? ' done' : ''}` }, c)))))),
        ),
        stepsSection,
        pricing,
        landFooter,
      ),
    );
  }

  // ---------- отдельные публичные страницы: /pricing, /contacts, /privacy, /terms ----------
  function viewPublicPage(kind) {
    destroyDock();
    const titles = { pricing: 'Тарифы', contacts: 'Контакты', privacy: 'Политика конфиденциальности', terms: 'Условия использования' };
    document.title = `${titles[kind]} · tasqly`;
    const cta = state.user ? h('a', { class: 'btn small nav-cta', href: PANEL }, 'Кабинет') : h('a', { class: 'btn small nav-cta', href: '/register' }, 'Начать сейчас');
    const nav = h('header', { class: 'land-nav' }, logoEl(), h('span', { class: 'grow' }),
      h('nav', { class: 'land-links' }, h('a', { class: 'nav-link', href: '/pricing' }, 'Тарифы'), h('a', { class: 'nav-link', href: '/contacts' }, 'Контакты')),
      ...(state.user ? [] : [h('span', { class: 'nav-sep' }), h('a', { class: 'nav-link', href: '/login' }, 'Войти')]), themeToggle('nav-theme'), cta);
    const foot = h('footer', { class: 'land-foot' },
      h('div', { class: 'lf-in' },
        h('div', { class: 'lf-brand' }, logoEl(), h('p', null, 'Задачи, время, заметки, чат и файлы команды в одном пространстве.')),
        h('div', { class: 'lf-col' }, h('b', null, 'Продукт'), h('a', { href: '/' }, 'Главная'), h('a', { href: '/pricing' }, 'Тарифы'), h('a', { href: '/contacts' }, 'Контакты')),
        h('div', { class: 'lf-col' }, h('b', null, 'Аккаунт'), ...(state.user ? [h('a', { href: PANEL }, 'Кабинет')] : [h('a', { href: '/login' }, 'Войти'), h('a', { href: '/register' }, 'Создать пространство')])),
        h('div', { class: 'lf-col' }, h('b', null, 'Документы'), h('a', { href: '/privacy' }, 'Конфиденциальность'), h('a', { href: '/terms' }, 'Условия')),
      ),
      h('div', { class: 'lf-bottom' }, h('span', null, `© ${new Date().getFullYear()} tasqly`), h('span', null, 'Сделано в Казахстане')));

    let body;
    if (kind === 'pricing') {
      const groups = [
        ['Работа', [['Проекты и задачи', true, true, true], ['Заметки', true, true, true], ['Таймер времени', true, true, true], ['Участников', 'до 3', 'до 30', 'без ограничений']]],
        ['Команда', [['Чат и диск', false, true, true], ['Обзор и отчёты по времени', false, true, true], ['AI-помощник', false, true, true]]],
        ['Сопровождение', [['Помощь с запуском', false, false, true], ['Приоритетная поддержка', false, false, true], ['Свои условия', false, false, true]]],
      ];
      const cell = (v) => (v === true ? h('td', { class: 'yes', 'aria-label': 'есть' }, '✓') : v === false ? h('td', { class: 'no', 'aria-label': 'нет' }, '—') : h('td', null, v));
      const limits = [['10', 'пространств у владельца'], ['30', 'проектов в пространстве'], ['500', 'задач в проекте'], ['100', 'заметок в пространстве'], ['100', 'файлов в пространстве'], ['40', 'запросов к AI в день']];
      const faq = [
        ['Нужна ли карта, чтобы начать?', 'Нет. «Старт» бесплатный и без срока: регистрируешься и работаешь.'],
        ['Как работает пробный период?', 'Новый аккаунт получает 5 дней «Команды» с открытыми чатом, диском, обзором времени и AI. Карта для этого не нужна.'],
        ['Когда появится оплата?', 'Пока её нет, тарифы ориентировочные. Перед запуском оплаты мы заранее напишем об условиях.'],
        ['Что считается человеком в «Команде»?', 'Каждый участник пространства, которому ты дал доступ к проектам. В «Команде» их может быть до 30, а больше — на тарифе «Бизнес».'],
        ['Можно ли перейти с тарифа на тариф?', 'Да, в любой момент: данные и проекты остаются на месте.'],
        ['Что делает AI-помощник?', 'Отвечает только про задачи и проекты: разбивает на шаги, предлагает план дня, помогает назначить исполнителей.'],
      ];
      body = [
        h('div', { class: 'pg-hero' },
          h('h1', null, 'Тарифы под любой бюджет'),
          h('p', { class: 'pg-lead' }, 'Начни бесплатно и переходи дальше, когда команда вырастет. Без карты и скрытых платежей.')),
        h('div', { class: 'pr-cards pg-cards' }, PLANS.map((pl, i) => planCard(pl, i))),
        h('h2', { class: 'pg-h2' }, 'Сравнение планов'),
        h('div', { class: 'cmp-wrap' }, h('table', { class: 'cmp' },
          h('thead', null, h('tr', null, h('th', null, ''), ...PLANS.map((pl) => h('th', null, pl.name)))),
          ...groups.map(([g, rs]) => h('tbody', null,
            h('tr', { class: 'cmp-g' }, h('th', { colspan: 4, scope: 'colgroup' }, g)),
            ...rs.map(([t, ...v]) => h('tr', null, h('th', { scope: 'row' }, t), ...v.map(cell))))))),
        h('p', { class: 'pg-note' }, 'Тарифы пока ориентировочные: условия могут измениться до запуска оплаты.'),
        h('h2', { class: 'pg-h2' }, 'Лимиты сейчас'),
        h('div', { class: 'lim' }, limits.map(([n, t]) => h('div', { class: 'lim-i' }, h('b', null, n), h('span', null, t)))),
        h('h2', { class: 'pg-h2' }, 'Частые вопросы'),
        h('div', { class: 'faq' }, faq.map(([q, an]) => h('details', { class: 'faq-i' }, h('summary', null, q), h('p', null, an)))),
        h('div', { class: 'pg-cta' },
          h('h2', null, 'Попробуй на своих задачах'),
          h('p', null, 'Регистрация занимает меньше минуты.'),
          h('a', { class: 'btn', href: '/register' }, 'Создать пространство')),
      ];
    } else if (kind === 'contacts') {
      body = [
        h('h1', null, 'Контакты'),
        h('p', { class: 'pg-lead' }, 'tasqly делает один человек из Казахстана.'),
        h('div', { class: 'pg-card' }, h('b', null, 'Автор и поддержка'), h('p', null, 'Создано @bauyrzhanov_12_. Пиши с вопросами по сервису, идеями и багами. Для компаний, которым нужны свои условия, тариф «Бизнес» обсуждается лично.')),
        h('div', { class: 'pg-card' }, h('b', null, 'Уже есть аккаунт?'), h('p', null, 'Часть вопросов решается внутри кабинета: код приглашения, участники, пароль.'), h('a', { class: 'btn small', href: state.user ? PANEL : '/login' }, state.user ? 'В кабинет' : 'Войти')),
      ];
    } else {
      body = [
        h('h1', null, titles[kind]),
        h('div', { class: 'pg-card' }, h('b', null, 'Документ в подготовке'), h('p', null, 'Полный текст появится до запуска платных тарифов. Пока в сервисе хранятся только данные, которые ты вводишь сам: имя, email, хэш пароля и содержимое твоих пространств.'), h('a', { class: 'btn small ghost', href: '/contacts' }, 'Вопросы по данным')),
      ];
    }
    render(nav, h('main', { class: 'pg' }, ...body), foot);
  }

  function viewAuth(initialMode = 'login', opts = {}) {
    document.title = initialMode === 'register' ? 'Регистрация · tasqly' : 'Вход · tasqly';
    destroyDock();
    let mode = initialMode;
    const external = !IN_PANEL;
    const setUrl = (m) => (external ? history.replaceState(null, '', m === 'login' ? '/login' : '/register') : history.replaceState(null, '', m === 'login' ? '#/login' : '#/register'));
    const error = h('div', { class: 'error' });
    const form = h('form', { novalidate: true });
    const tabs = h('div', { class: 'seg' });

    function paint() {
      tabs.replaceChildren(
        h('button', { type: 'button', class: mode === 'login' ? 'active' : '', onclick: () => ((mode = 'login'), setUrl('login'), paint()) }, 'Вход'),
        h('button', { type: 'button', class: mode === 'register' ? 'active' : '', onclick: () => ((mode = 'register'), setUrl('register'), paint()) }, 'Регистрация'),
      );
      form.replaceChildren(
        ...(mode === 'register' ? [h('label', { class: 'field' }, 'Имя'), h('input', { type: 'text', name: 'name', autocomplete: 'name', maxlength: 60 })] : []),
        h('label', { class: 'field' }, 'Email'),
        h('input', { type: 'email', name: 'email', autocomplete: 'email' }),
        h('label', { class: 'field' }, 'Пароль'),
        passwordField({ name: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', 'aria-label': 'Пароль' }),
        ...(mode === 'register' ? [h('div', { class: 'sub', style: 'margin:6px 0 0;font-size:12px' }, 'Минимум 8 символов')] : []),
        error,
        h('button', { class: 'btn', style: 'width:100%;margin-top:6px', type: 'submit' }, mode === 'login' ? 'Войти' : 'Создать аккаунт'),
      );
      error.textContent = '';
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const res = await api.post(mode === 'login' ? '/api/auth/login' : '/api/auth/register', data);
        state.user = res.user;
        saveUser();
        if (mode === 'register') { try { sessionStorage.setItem('tq_trial_offer', '1'); } catch { /* нет хранилища */ } }
        if (external) { location.href = PANEL; return; }
        if (location.hash === '#/') route();
        else location.hash = '#/';
        setTimeout(maybeOfferTrial, 500);
      } catch (err) {
        error.textContent = err.message;
        btn.disabled = false;
      }
    });

    paint();
    render(
      h(
        'div',
        { class: 'auth' },
        logoEl(),
        h('div', { class: 'tag' }, opts.invited ? 'Тебя пригласили в пространство. Создай аккаунт или войди, и ты сразу попадёшь в него' : mode === 'register' ? 'Создай аккаунт и первое пространство' : 'Войди в свой кабинет'),
        h('div', { class: 'card' }, tabs, form),
        h('a', { class: 'auth-back', href: '/' }, '← О сервисе'),
      ),
    );
  }

  // ---------- главная: пространства ----------

  // подсказки для новичка: четыре шага на главной, пока не пройдены или не скрыты
  function onboarding(workspaces, focusCreate) {
    let off = false;
    try { off = localStorage.getItem('tq_onb_off') === '1'; } catch { /* нет хранилища */ }
    if (off) return null;
    const sum = (k) => workspaces.reduce((acc, w) => acc + (w[k] || 0), 0);
    const first = workspaces[0];
    const steps = [
      ['Создай пространство', 'Место для проектов, заметок и чата команды.', workspaces.length > 0, 'Создать', focusCreate],
      ['Создай проект', 'Например «Запуск сайта» или «Контент-план».', sum('projects') > 0, 'Открыть пространство', first ? () => { location.hash = `#/w/${first.id}`; } : null],
      ['Добавь первую задачу', 'Нажми «+» вверху и выбери «Задачу».', sum('tasks') > 0, 'Открыть пространство', first ? () => { location.hash = `#/w/${first.id}`; } : null],
      ['Пригласи человека', 'Ссылка-приглашение лежит на странице пространства.', workspaces.some((w) => (w.members || 0) > 1), 'Получить ссылку', first ? () => { location.hash = `#/w/${first.id}`; } : null],
    ];
    const done = steps.filter((x) => x[2]).length;
    if (done === steps.length) return null;
    const current = steps.findIndex((x) => !x[2]);
    const check = (ok) => { const sp = h('span', { class: `onb-ck${ok ? ' on' : ''}` }); sp.innerHTML = ok ? '<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 10.5l3.2 3.2L15 6.8"/></svg>' : ''; return sp; };
    return h('div', { class: 'onb' },
      h('div', { class: 'onb-head' }, h('div', null, h('b', null, 'Начало работы'), h('span', null, `${done} из ${steps.length} шагов`)),
        h('button', { class: 'btn ghost small', onclick: () => { try { localStorage.setItem('tq_onb_off', '1'); } catch { /* нет хранилища */ } route(); } }, 'Скрыть')),
      h('div', { class: 'progress' }, h('span', { style: `width:${Math.round((done / steps.length) * 100)}%` })),
      h('div', { class: 'onb-list' }, steps.map(([t, d, ok, label, act], i) =>
        h('div', { class: `onb-step${ok ? ' done' : ''}${i === current ? ' now' : ''}` }, check(ok), h('div', { class: 'onb-t' }, h('b', null, t), h('span', null, d)),
          i === current && act ? h('button', { class: 'btn small', onclick: act }, label) : null))));
  }

  async function viewHome() {
    document.title = 'tasqly';
    const warm = cacheGet('/api/workspaces');
    if (!warm) render(topbar([{ label: 'Пространства' }]), h('div', { class: 'container' }));
    const { workspaces } = await api.fast('/api/workspaces');
    if (workspaces.length && !workspaces.some((w) => w.id === lastWsStore.get())) setAiContext(workspaces[0].id, '', `пространство «${workspaces[0].name}»`);

    const nameInput = h('input', { type: 'text', placeholder: 'Название пространства', maxlength: 80 });
    const codeInput = h('input', { type: 'text', placeholder: 'Код приглашения', maxlength: 20 });
    const create = async () => {
      if (!nameInput.value.trim()) return;
      try {
        const { workspace } = await api.post('/api/workspaces', { name: nameInput.value });
        location.hash = `#/w/${workspace.id}`;
      } catch (e) {
        toast(e.message);
      }
    };
    const join = async () => {
      if (!codeInput.value.trim()) return;
      try {
        const { workspace } = await api.post('/api/workspaces/join', { code: codeInput.value });
        location.hash = `#/w/${workspace.id}`;
      } catch (e) {
        toast(e.message);
      }
    };
    nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && create());
    codeInput.addEventListener('keydown', (e) => e.key === 'Enter' && join());

    const hour = new Date().getHours();
    const hello = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
    const plural = (n, one, few, many) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many}`;
    const sum = (k) => workspaces.reduce((acc, w) => acc + (w[k] || 0), 0);
    const arrow = () => { const sp = h('span', { class: 'ws-go', 'aria-hidden': 'true' }); sp.innerHTML = '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 10h10M11 5l5 5-5 5"/></svg>'; return sp; };
    const stat = (n, one, few, many) => h('div', { class: 'home-stat' }, h('b', null, String(n)), h('span', null, plural(n, one, few, many).replace(/^\d+ /, '')));

    render(
      topbar([{ label: 'Пространства' }]),
      h(
        'div',
        { class: 'container home' },
        (() => {
          const t = trialState();
          return t && t.active && state.user.plan === 'start'
            ? h('div', { class: 'trial-banner' }, h('span', { class: 'trial-dot' }), h('div', null, h('b', null, `Пробный период «Команды»: ${t.left === 1 ? 'последний день' : 'осталось ' + daysWord(t.left)}`), h('span', null, 'Все возможности открыты: чат, диск, обзор времени и AI.')), h('a', { class: 'btn small ghost', href: '/pricing' }, 'Тарифы'))
            : null;
        })(),
        h('div', { class: 'home-hero' },
          h('h1', null, `${hello}, `, h('em', { class: 'wave-u' }, state.user.name)),
          h('p', { class: 'sub' }, workspaces.length ? 'Выбери пространство, чтобы продолжить работу.' : 'Создай первое пространство для своей команды.')),
        onboarding(workspaces, () => nameInput.focus()),
        workspaces.length
          ? h('div', { class: 'home-stats' }, stat(workspaces.length, 'пространство', 'пространства', 'пространств'), stat(sum('projects'), 'проект', 'проекта', 'проектов'), stat(sum('my_open'), 'моя открытая задача', 'моих открытых задачи', 'моих открытых задач'))
          : null,
        workspaces.length
          ? h('div', { class: 'ws-grid' }, workspaces.map((w) =>
              h('a', { class: 'ws-card', href: `#/w/${w.id}` },
                h('div', { class: 'ws-top' },
                  h('span', { class: 'ws-ava' }, (w.name.trim()[0] || '?').toUpperCase()),
                  h('span', { class: `pill ws-role${w.role === 'owner' ? ' owner' : ''}` }, w.role === 'owner' ? 'Владелец' : 'Участник')),
                h('div', { class: 'ws-name' }, w.name),
                h('div', { class: 'ws-meta' }, plural(w.projects, 'проект', 'проекта', 'проектов'), h('i', null), plural(w.members, 'участник', 'участника', 'участников')),
                h('div', { class: 'ws-foot' }, w.my_open ? h('span', { class: 'ws-open' }, plural(w.my_open, 'задача', 'задачи', 'задач'), ' у тебя') : h('span', { class: 'ws-clear' }, 'Нет открытых задач'), arrow()))))
          : h('div', { class: 'home-empty' }, h('b', null, 'Пока нет пространств'), h('span', null, 'Пространство — это место, где живут проекты, заметки, чат и файлы команды.')),
        h('h2', { class: 'home-h2' }, 'Новое'),
        h('div', { class: 'home-new' },
          h('div', { class: 'home-act' }, h('div', { class: 'act-ic' }, '+'), h('div', { class: 'act-body' }, h('h3', null, 'Создать пространство'), h('p', null, 'Для команды, клиента или личных дел.'), h('div', { class: 'row' }, nameInput, h('button', { class: 'btn', onclick: create }, 'Создать')))),
          h('div', { class: 'home-act' }, h('div', { class: 'act-ic key' }, '#'), h('div', { class: 'act-body' }, h('h3', null, 'Вступить по коду'), h('p', null, 'Код приглашения пришлёт владелец пространства.'), h('div', { class: 'row' }, codeInput, h('button', { class: 'btn ghost', onclick: join }, 'Вступить')))),
        ),
      ),
    );
  }

  // ---------- профиль ----------

  async function viewProfile() {
    document.title = 'Профиль · tasqly';
    render(topbar([{ label: 'Пространства', href: '#/' }, { label: 'Профиль' }]), h('div', { class: 'container' }, h('div', { class: 'empty' }, 'Загрузка…')));
    const [{ user }, usage, { workspaces }] = await Promise.all([api.get('/api/me'), api.get('/api/me/usage'), api.get('/api/workspaces')]);
    state.user = { ...state.user, ...user };
    saveUser();
    const sum = (k) => workspaces.reduce((acc, w) => acc + (w[k] || 0), 0);
    const since = user.created_at ? new Date(user.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    const hue = (() => { let hs = 0; for (const ch of user.name) hs = (hs * 31 + ch.codePointAt(0)) >>> 0; return hs; })();

    const nameInput = h('input', { type: 'text', value: user.name, maxlength: 60, 'aria-label': 'Имя' });
    const saveBtn = h('button', { class: 'btn', disabled: true }, 'Сохранить');
    nameInput.addEventListener('input', () => { saveBtn.disabled = !nameInput.value.trim() || nameInput.value.trim() === state.user.name; });
    const saveName = async () => {
      if (saveBtn.disabled) return;
      saveBtn.disabled = true;
      try {
        const res = await api.patch('/api/me', { name: nameInput.value });
        state.user.name = res.user.name;
        toast('Имя сохранено');
        viewProfile();
      } catch (e) { toast(e.message); saveBtn.disabled = false; }
    };
    saveBtn.addEventListener('click', saveName);
    nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && saveName());

    const themes = [['light', 'Светлая'], ['dark', 'Тёмная'], ['auto', 'Как в системе']];
    const themeSeg = h('div', { class: 'seg prof-theme' });
    const paintTheme = () => themeSeg.replaceChildren(...themes.map(([k, label]) =>
      h('button', { class: k === themeStore.get() ? 'active' : '', onclick: (e) => setTheme(k, e.currentTarget) }, label)));
    paintTheme();
    const syncTheme = () => (themeSeg.isConnected ? paintTheme() : window.removeEventListener('tq-theme', syncTheme));
    window.addEventListener('tq-theme', syncTheme);

    const pct = Math.min(100, Math.round((usage.ai_used / usage.ai_limit) * 100));
    const row = (title, text, action) => h('div', { class: 'prof-row' }, h('div', null, h('b', null, title), text ? h('span', null, text) : null), action);
    const tile = (n, t) => h('div', { class: 'home-stat' }, h('b', null, String(n)), h('span', null, t));
    const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many);

    const othersBtn = h('button', { class: 'btn ghost small', disabled: usage.devices <= 1, onclick: async () => {
      try { await api.post('/api/auth/logout-others'); toast('Остальные устройства вышли'); viewProfile(); } catch (e) { toast(e.message); }
    } }, 'Выйти на других');

    render(
      topbar([{ label: 'Пространства', href: '#/' }, { label: 'Профиль' }]),
      h('div', { class: 'container prof' },
        h('div', { class: 'prof-hero' },
          h('span', { class: 'prof-ava', style: `background:${AVATAR_COLORS[hue % AVATAR_COLORS.length]}` }, user.name.trim().charAt(0).toUpperCase()),
          h('div', { class: 'prof-id' },
            h('div', { class: 'prof-edit' }, nameInput, saveBtn),
            h('div', { class: 'prof-mail' }, user.email),
            since ? h('div', { class: 'prof-since' }, `В tasqly с ${since}`) : null)),
        h('div', { class: 'home-stats' }, tile(workspaces.length, plural(workspaces.length, 'пространство', 'пространства', 'пространств')), tile(sum('projects'), plural(sum('projects'), 'проект', 'проекта', 'проектов')), tile(sum('my_open'), plural(sum('my_open'), 'моя открытая задача', 'моих открытых задачи', 'моих открытых задач'))),
        (() => {
          const t = trialState();
          const paid = user.plan && user.plan !== 'start';
          const startBtn = h('button', { class: 'btn small', onclick: () => startTrial() }, 'Начать пробный период');
          const cmp = h('a', { class: 'btn ghost small', href: '/pricing' }, 'Сравнить тарифы');
          if (paid) return h('div', { class: 'prof-card' }, h('h2', null, 'Тариф'), row(user.plan === 'business' ? 'Бизнес' : 'Команда', 'Все возможности открыты.', cmp));
          return h('div', { class: 'prof-card' }, h('h2', null, 'Тариф'),
            row(t && t.active ? 'Пробный период «Команда»' : 'Старт', t ? (t.active ? `Осталось ${daysWord(t.left)}. Все возможности открыты.` : 'Пробный период закончился. Оплата пока не подключена, всё продолжает работать.') : 'Бесплатно, до 3 человек в пространстве. Можно попробовать «Команду» 5 дней.', t ? cmp : startBtn));
        })(),
        h('div', { class: 'prof-card' },
          h('h2', null, 'AI на сегодня'),
          h('div', { class: 'prof-ai' }, h('b', null, `${usage.ai_used} из ${usage.ai_limit}`), h('span', null, 'запросов использовано, счётчик обнуляется каждый день')),
          h('div', { class: 'progress' }, h('span', { style: `width:${pct}%` }))),
        h('div', { class: 'prof-card' }, h('h2', null, 'Внешний вид'), row('Тема', 'Светлая, тёмная или как в системе', themeSeg)),
        h('div', { class: 'prof-card' },
          h('h2', null, 'Безопасность'),
          row('Пароль', 'Минимум 8 символов', h('button', { class: 'btn ghost small', onclick: openPasswordModal }, 'Сменить')),
          row('Устройства', `${usage.devices} ${plural(usage.devices, 'активная сессия', 'активные сессии', 'активных сессий')}`, othersBtn)),
        h('div', { class: 'prof-card' }, row('Выйти из аккаунта', 'На этом устройстве', h('button', { class: 'btn danger small', onclick: logout }, 'Выйти'))),
      ),
    );
  }

  // ---------- пространство: проекты и участники ----------

  const WS_TABS = [
    ['projects', 'Проекты'],
    ['notes', 'Заметки'],
    ['time', 'Время'],
    ['chat', 'Чат'],
    ['files', 'Диск'],
    ['ai', 'AI'],
  ];

  async function viewWorkspace(id, tab = 'projects') {
    if (!WS_TABS.some(([k]) => k === tab)) tab = 'projects';
    const data = await api.fast(`/api/workspaces/${id}`);
    const { workspace } = data;
    document.title = `${workspace.name} · tasqly`;
    setAiContext(id, '', `пространство «${workspace.name}»`);
    const panel = { projects: panelProjects, notes: panelNotes, time: panelTime, chat: panelChat, files: panelFiles, ai: panelAI }[tab](id, data);

    render(
      topbar([{ label: 'Пространства', href: '#/' }, { label: workspace.name }]),
      h(
        'div',
        { class: `container${tab === 'projects' ? '' : ' wide'}` },
        h('h1', null, workspace.name),
        h('nav', { class: 'ws-tabs', 'aria-label': 'Разделы пространства' }, WS_TABS.map(([k, label]) => h('a', { class: `ws-tab${k === tab ? ' active' : ''}`, href: k === 'projects' ? `#/w/${id}` : `#/w/${id}/${k}` }, label))),
        panel,
      ),
    );
  }

  function panelProjects(id, { workspace, members, projects }) {
    const nameInput = h('input', { type: 'text', placeholder: 'Название проекта', maxlength: 80 });
    let kind = 'basic';
    const kindBox = h('div', { class: 'kinds' });
    const paintKinds = () =>
      kindBox.replaceChildren(
        ...Object.entries(KINDS).map(([k, v]) =>
          h('button', { type: 'button', class: `kind${k === kind ? ' on' : ''}`, onclick: () => ((kind = k), paintKinds()) }, h('b', null, v.name), h('span', null, v.hint)),
        ),
      );
    paintKinds();
    const create = async () => {
      if (!nameInput.value.trim()) return;
      try {
        const { project } = await api.post(`/api/workspaces/${id}/projects`, { name: nameInput.value, kind });
        location.hash = `#/p/${project.id}`;
      } catch (e) {
        toast(e.message);
      }
    };
    nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && create());

    const inviteLink = `${location.origin}${PANEL}#/join/${workspace.invite_code}`;
    const copyLink = async () => {
      try {
        await navigator.clipboard.writeText(inviteLink);
        toast('Ссылка скопирована');
      } catch {
        toast(inviteLink);
      }
    };
    const copyCode = async () => {
      try {
        await navigator.clipboard.writeText(workspace.invite_code);
        toast('Код скопирован');
      } catch {
        toast(workspace.invite_code);
      }
    };

    return h(
      'div',
      null,
      projects.length
        ? h(
            'div',
            { class: 'grid' },
            projects.map((p) =>
              h(
                'a',
                { class: 'tile', href: `#/p/${p.id}` },
                h('div', { class: 'name' }, p.name, p.kind && p.kind !== 'basic' ? h('span', { class: 'pill kind-pill' }, KINDS[p.kind].name) : null),
                h('div', { class: 'meta' }, p.total ? `${p.done} из ${p.total} задач выполнено` : 'Задач пока нет'),
                h('div', { class: 'progress' }, h('span', { style: `width:${p.total ? Math.round((p.done / p.total) * 100) : 0}%` })),
              ),
            ),
          )
        : h('div', { class: 'card empty' }, 'Проектов пока нет. Создай первый ниже.'),
      h('div', { class: 'spacer' }),
      h('h2', null, 'Новый проект'),
      kindBox,
      h('div', { class: 'row', style: 'margin-top:10px' }, nameInput, h('button', { class: 'btn', onclick: create }, 'Добавить проект')),
      h('div', { class: 'spacer' }),
      h('h2', null, 'Участники'),
      h('div', { class: 'people' }, members.map((m) => h('span', { class: 'chip' }, avatar(m.name), m.name))),
      h('div', { class: 'spacer' }),
      h(
        'div',
        { class: 'card' },
        h('h2', null, 'Пригласить в команду'),
        h('p', { class: 'sub', style: 'margin-bottom:12px' }, 'Отправь ссылку: человек зарегистрируется или войдёт и сразу попадёт в пространство. Или пришли только код'),
        h('div', { class: 'row' }, h('span', { class: 'invite' }, workspace.invite_code), h('button', { class: 'btn small', onclick: copyLink }, 'Копировать ссылку'), h('button', { class: 'btn ghost small', onclick: copyCode }, 'Только код')),
      ),
    );
  }

  // ---------- заметки ----------

  function panelNotes(id) {
    let notes = [];
    let current = null; // полная заметка в редакторе
    let saveTimer = null;
    const listEl = h('div', { class: 'notes-list' });
    const editor = h('div', { class: 'note-editor' });

    const stamp = (ts) => new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    const paintList = () =>
      listEl.replaceChildren(
        ...(notes.length
          ? notes.map((n) =>
              h(
                'button',
                { class: `note-item${current && current.id === n.id ? ' on' : ''}`, onclick: () => openNote(n.id) },
                h('div', { class: 'note-title' }, n.title || 'Без названия'),
                h('div', { class: 'note-prev' }, n.preview || 'Пустая заметка'),
                h('div', { class: 'note-meta' }, `${n.author || '—'} · ${stamp(n.updated_at)}`),
              ),
            )
          : [h('div', { class: 'drawer-note' }, 'Заметок пока нет. Запиши идею, договорённость или детали задачи.')]),
      );

    async function flush() {
      if (!current || !saveTimer) return;
      clearTimeout(saveTimer);
      saveTimer = null;
      try {
        const { note } = await api.patch(`/api/notes/${current.id}`, { title: current.title, body: current.body });
        const item = notes.find((n) => n.id === current.id);
        if (item) Object.assign(item, { title: note.title, preview: note.body.slice(0, 140), updated_at: note.updated_at });
        notes.sort((a, b) => b.updated_at - a.updated_at);
        paintList();
        status.textContent = 'Сохранено';
      } catch (e) {
        toast(e.message);
      }
    }
    const status = h('span', { class: 'saved' });
    const queueSave = () => {
      status.textContent = 'Сохраняю…';
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flush, 700);
    };
    const prevCleanup = cleanup;
    cleanup = () => {
      flush();
      if (prevCleanup) prevCleanup();
    };

    async function openNote(noteId) {
      await flush();
      try {
        const { note } = await api.get(`/api/notes/${noteId}`);
        current = note;
        paintList();
        paintEditor();
      } catch (e) {
        toast(e.message);
      }
    }

    function paintEditor() {
      if (!current) {
        editor.replaceChildren(h('div', { class: 'empty' }, 'Выбери заметку слева или создай новую'));
        return;
      }
      const title = h('input', { type: 'text', class: 'note-title-input', placeholder: 'Название', maxlength: 120, value: current.title });
      const body = h('textarea', { class: 'note-body', placeholder: 'Пиши здесь. Заметка общая для всех участников пространства.', maxlength: 20000 });
      body.value = current.body;
      title.addEventListener('input', () => ((current.title = title.value), queueSave()));
      body.addEventListener('input', () => ((current.body = body.value), queueSave()));
      const del = async () => {
        if (!confirm('Удалить заметку?')) return;
        try {
          await api.del(`/api/notes/${current.id}`);
          notes = notes.filter((n) => n.id !== current.id);
          current = null;
          saveTimer = null;
          paintList();
          paintEditor();
        } catch (e) {
          toast(e.message);
        }
      };
      editor.replaceChildren(title, body, h('div', { class: 'modal-actions' }, h('button', { class: 'btn danger small', onclick: del }, 'Удалить'), status));
    }

    const addNote = async () => {
      try {
        const { note } = await api.post(`/api/workspaces/${id}/notes`, {});
        notes.unshift({ id: note.id, title: '', preview: '', updated_at: note.updated_at, author: note.author });
        await openNote(note.id);
        const t = editor.querySelector('.note-title-input');
        if (t) t.focus();
      } catch (e) {
        toast(e.message);
      }
    };

    let notesShown = false;
    api
      .swr(`/api/workspaces/${id}/notes`, (r) => {
        notes = r.notes;
        paintList();
        if (!notesShown) { notesShown = true; paintEditor(); }
      })
      .catch((e) => toast(e.message));

    return h('div', { class: 'notes' }, h('aside', { class: 'notes-side' }, h('button', { class: 'btn', onclick: addNote }, '+ Новая заметка'), listEl), editor);
  }

  // ---------- отчёт по времени ----------

  function panelTime(id) {
    const box = h('div', null);
    let days = 30;
    const bars = (rows, total) =>
      rows.length
        ? rows.map((r) => h('div', { class: 'bar-row' }, h('div', { class: 'bar-label' }, r.name), h('div', { class: 'bar' }, h('span', { style: `width:${total ? Math.max(3, Math.round((r.seconds / total) * 100)) : 0}%` })), h('div', { class: 'bar-val' }, fmtDur(r.seconds))))
        : [h('div', { class: 'drawer-note' }, 'Пока нет записей')];

    async function load() {
      try {
        await api.swr(`/api/workspaces/${id}/time?days=${days}`, show);
      } catch (e) {
        box.replaceChildren(h('div', { class: 'card empty' }, e.message));
      }
    }
    function show(r) {
      {
        const periods = h('div', { class: 'seg' }, [7, 30, 90].map((d) => h('button', { class: d === days ? 'active' : '', onclick: () => ((days = d), load()) }, `${d} дн.`)));
        box.replaceChildren(
          h('div', { class: 'time-head' }, h('div', null, h('div', { class: 'big' }, fmtDur(r.total_sec)), h('div', { class: 'sub', style: 'margin:0' }, `всего за ${days} дн.`)), periods),
          h('div', { class: 'time-cols' }, h('div', { class: 'card' }, h('h2', null, 'По людям'), bars(r.by_user, r.total_sec)), h('div', { class: 'card' }, h('h2', null, 'По проектам'), bars(r.by_project, r.total_sec))),
          h('h2', { style: 'margin-top:22px' }, 'Последние записи'),
          r.recent.length
            ? h('div', { class: 'card flush' }, r.recent.map((e) => h('a', { class: 'time-row', href: `#/p/${e.project_id}` }, h('span', { class: 'grow' }, h('b', null, e.task_title), e.note ? h('span', { class: 'mail-sub' }, ` · ${e.note}`) : null), h('span', { class: 'mail-sub' }, e.author), h('span', { class: 'mail-sub' }, fmtDateTime(e.started_at)), h('span', { class: 'dur' }, fmtDur(e.seconds)))))
            : h('div', { class: 'card empty' }, 'Включи таймер в окне задачи или добавь время вручную: здесь появится отчёт.'),
        );
      }
    }
    load();
    return box;
  }

  // ---------- чат ----------

  function panelChat(id) {
    const list = h('div', { class: 'chat-list', 'aria-live': 'polite' });
    let last = 0;
    const seen = new Set();
    const nearBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    const timeOf = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

    function add(msgs) {
      const stick = nearBottom() || !last;
      let added = false;
      for (const m of msgs) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        last = Math.max(last, m.created_at);
        added = true;
        const mine = m.user_id === state.user.id;
        list.append(h('div', { class: `msg${mine ? ' mine' : ''}` }, mine ? null : avatar(m.author || '?'), h('div', { class: 'bubble' }, mine ? null : h('div', { class: 'who' }, m.author || 'Кто-то'), h('div', { class: 'text' }, m.body), h('div', { class: 'when' }, timeOf(m.created_at)))));
      }
      if (added && stick) list.scrollTop = list.scrollHeight;
    }
    async function poll() {
      try {
        let r;
        if (!last && !list.childElementCount) {
          // первый показ: прошлые сообщения из кеша сразу, свежие подтягиваем
          const path = `/api/workspaces/${id}/messages`;
          const hit = cacheGet(path);
          if (hit) { add(hit.messages); list.scrollTop = list.scrollHeight; }
          r = await api.get(path);
          if (!hit || r.messages.length !== hit.messages.length) cacheSet(path, r);
        } else {
          r = await api.get(`/api/workspaces/${id}/messages${last ? `?after=${last}` : ''}`);
        }
        add(r.messages);
        if (!last && !r.messages.length) list.replaceChildren(h('div', { class: 'empty', id: 'chat-empty' }, 'Сообщений пока нет. Напиши первым.'));
      } catch {
        /* повторим при следующем опросе */
      }
    }
    const emptyHint = () => {
      const e = list.querySelector('#chat-empty');
      if (e) e.remove();
    };
    const input = h('textarea', { rows: 1, placeholder: 'Сообщение (Enter отправляет, Shift+Enter новая строка)', maxlength: 2000, 'aria-label': 'Сообщение' });
    const send = async () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      try {
        const { message } = await api.post(`/api/workspaces/${id}/messages`, { body: text });
        emptyHint();
        add([message]);
        list.scrollTop = list.scrollHeight;
      } catch (e) {
        input.value = text;
        toast(e.message);
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    });
    poll();
    const timer = setInterval(() => !document.hidden && poll(), 3000);
    const prevCleanup = cleanup;
    cleanup = () => {
      clearInterval(timer);
      if (prevCleanup) prevCleanup();
    };
    return h('div', { class: 'chat' }, list, h('div', { class: 'chat-input' }, input, h('button', { class: 'btn', onclick: send }, 'Отправить')));
  }

  // ---------- ai tasqly ----------

  // чат с ai: общий для вкладки и боковой панели. ctx = { workspaceId, projectId } меняется на лету
  function aiChat(ctx, { compact = false } = {}) {
    const history = [];
    const list = h('div', { class: 'chat-list' });
    const note = h('div', { class: 'ai-left' });
    const todayStr = () => isoOf(new Date());

    const bubble = (role, content) => {
      const el = h('div', { class: `msg${role === 'user' ? ' mine' : ''}` }, role === 'user' ? null : h('span', { class: 'avatar ai-avatar' }, 'AI'), h('div', { class: 'bubble' }, h('div', { class: 'text' }, content)));
      list.append(el);
      list.scrollTop = list.scrollHeight;
      return el;
    };
    const actions = [
      ['Итоги', 'Что сделано, что в работе и что отстаёт', 'Сделай краткие итоги: что сделано, что в работе, что отстаёт.', '#3e63dd'],
      ['Что горит', 'Просроченные задачи и ближайшие сроки', 'Какие задачи просрочены или горят в ближайшие дни? Перечисли с исполнителями.', '#e5484d'],
      ['План на сегодня', 'Приоритеты и сроки на день', 'Составь для меня план на сегодня по приоритетам и срокам.', '#30a46c'],
      ['Нагрузка команды', 'Кто перегружен, а кто свободен', 'Как распределена нагрузка между участниками? Есть ли перекосы?', '#8e4ec6'],
    ];
    const hello = () => {
      chatEl && chatEl.classList.remove('talking');
      list.replaceChildren(
        h(
          'div',
          { class: 'ai-hello' },
          h('span', { class: 'hi-kicker' }, 'Здравствуйте, я AI tasqly'),
          h('h2', { class: 'hi-title' }, 'Чем я могу ', h('em', null, 'помочь'), '?'),
          h('p', { class: 'hi-sub' }, 'Выберите действие ниже или задайте любой вопрос о задачах и проектах'),
          h('div', { class: 'hi-cards' }, actions.map(([t, d, q, c]) => h('button', { class: 'hi-card', style: `--c:${c}`, onclick: () => ask(q) }, h('b', null, t), h('span', null, d)))),
        ),
      );
    };
    let chatEl = null;
    hello();

    let busy = false;
    async function ask(text) {
      text = text.trim();
      if (!text || busy) return;
      if (!ctx.workspaceId) return toast('Сначала открой или создай пространство');
      busy = true;
      if (list.querySelector('.ai-hello')) list.replaceChildren();
      chatEl && chatEl.classList.add('talking');
      bubble('user', text);
      const wait = bubble('assistant', 'Думаю…');
      wait.classList.add('pending');
      try {
        const r = await api.post(`/api/workspaces/${ctx.workspaceId}/ai/chat`, { message: text, today: todayStr(), history, project_id: ctx.projectId || undefined });
        history.push({ role: 'user', content: text }, { role: 'assistant', content: r.reply });
        wait.querySelector('.text').textContent = r.reply;
        wait.classList.remove('pending');
        note.textContent = `Осталось запросов сегодня: ${r.left}`;
      } catch (e) {
        wait.querySelector('.text').textContent = e.message;
        wait.classList.remove('pending');
        wait.classList.add('failed');
      } finally {
        busy = false;
        list.scrollTop = list.scrollHeight;
      }
    }

    const chips = [
      ['Итоги', 'Сделай краткие итоги: что сделано, что в работе, что отстаёт.'],
      ['Что горит', 'Какие задачи просрочены или горят в ближайшие дни? Перечисли с исполнителями.'],
      ['План на сегодня', 'Составь для меня план на сегодня по приоритетам и срокам.'],
      ['Нагрузка', 'Как распределена нагрузка между участниками? Есть ли перекосы?'],
    ];
    const input = h('textarea', { rows: 1, placeholder: 'Спросите или найдите что угодно', maxlength: 1500, 'aria-label': 'Запрос к AI' });
    const send = () => {
      const v = input.value;
      input.value = '';
      ask(v);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    });
    const newBtn = h('button', { class: 'cap-btn', type: 'button', title: 'Новый разговор', 'aria-label': 'Новый разговор', onclick: () => { history.length = 0; note.textContent = ''; hello(); } }, icon('plus'));
    const sendBtn = h('button', { class: 'cap-send', type: 'button', title: 'Отправить', 'aria-label': 'Отправить', onclick: send });
    sendBtn.innerHTML = '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M10 16V4M5 9l5-5 5 5"/></svg>';
    const el = h('div', { class: `chat${compact ? ' compact' : ''}` }, list, h('div', { class: 'chips' }, chips.map(([label, q]) => h('button', { class: 'chip-btn', onclick: () => ask(q) }, label))), h('div', { class: 'chat-input' }, h('div', { class: 'capsule' }, newBtn, input, sendBtn)));
    chatEl = el;
    return {
      el,
      note,
      input,
      reset() {
        history.length = 0;
        note.textContent = '';
        hello();
      },
    };
  }

  function panelAI(id, { projects }) {
    const ctx = { workspaceId: id, projectId: '' };
    const chat = aiChat(ctx);
    const projSel = h('select', { 'aria-label': 'Проект', onchange: () => (ctx.projectId = projSel.value) }, h('option', { value: '' }, 'Все проекты'), projects.map((p) => h('option', { value: p.id }, p.name)));
    const note = chat.note;
    const todayStr = () => isoOf(new Date());

    // задачи из текста
    const textArea = h('textarea', { rows: 5, placeholder: 'Вставь заметки со встречи, переписку или список дел, а AI предложит задачи', maxlength: 4000 });
    const proposals = h('div', { class: 'ai-props' });
    const targetSel = h('select', { 'aria-label': 'В какой проект' }, projects.map((p) => h('option', { value: p.id }, p.name)));
    const extractBtn = h('button', { class: 'btn small' }, 'Предложить задачи');
    extractBtn.addEventListener('click', async () => {
      const text = textArea.value.trim();
      if (!text) return toast('Вставь текст');
      if (!projects.length) return toast('Сначала создай проект');
      extractBtn.disabled = true;
      extractBtn.textContent = 'Думаю…';
      try {
        const r = await api.post(`/api/workspaces/${id}/ai/tasks`, { text, today: todayStr() });
        note.textContent = `Осталось запросов сегодня: ${r.left}`;
        showProposals(r.tasks);
      } catch (e) {
        toast(e.message);
      } finally {
        extractBtn.disabled = false;
        extractBtn.textContent = 'Предложить задачи';
      }
    });
    function showProposals(tasks) {
      const rows = tasks.map((t) => {
        const cb = h('input', { type: 'checkbox', checked: true });
        return { t, cb, el: h('label', { class: 'prop' }, cb, h('span', { class: 'grow' }, t.title), t.priority ? h('span', { class: `prio p${t.priority}` }, h('i'), h('i'), h('i')) : null, t.due_date ? h('span', { class: 'mail-sub' }, formatDate(t.due_date)) : null) };
      });
      const create = h('button', { class: 'btn small' }, 'Создать выбранные');
      create.addEventListener('click', async () => {
        const chosen = rows.filter((r) => r.cb.checked);
        if (!chosen.length) return toast('Ничего не выбрано');
        create.disabled = true;
        let made = 0;
        for (const { t } of chosen) {
          try {
            await api.post(`/api/projects/${targetSel.value}/tasks`, { title: t.title, priority: t.priority, ...(t.due_date ? { due_date: t.due_date } : {}) });
            made++;
          } catch (e) {
            toast(e.message);
          }
        }
        toast(`Создано задач: ${made}`);
        proposals.replaceChildren(h('div', { class: 'drawer-note' }, `Создано задач: ${made}. Они лежат в первой колонке проекта.`));
      });
      proposals.replaceChildren(h('div', { class: 'card flush' }, rows.map((r) => r.el)), h('div', { class: 'row', style: 'margin-top:10px' }, h('span', { class: 'mail-sub' }, 'В проект:'), targetSel, create));
    }

    return h(
      'div',
      { class: 'ai-wrap' },
      h('div', { class: 'ai-main' }, h('div', { class: 'ai-bar' }, h('span', { class: 'mail-sub' }, 'Контекст:'), projSel, h('span', { class: 'grow' }), note), chat.el),
      h('aside', { class: 'ai-side' }, h('div', { class: 'card' }, h('h2', null, 'Задачи из текста'), textArea, h('div', { style: 'margin-top:8px' }, extractBtn), proposals)),
    );
  }

  // ---------- диск ----------

  async function downloadFile(f) {
    try {
      const token = tokenStore.get();
      const res = await fetch(`${API_BASE}/api/files/${f.id}/download`, { headers: token ? { authorization: `Bearer ${token}` } : {}, credentials: API_BASE ? 'omit' : 'same-origin' });
      if (!res.ok) throw new Error(`ошибка ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = h('a', { href: url, download: f.name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {
      toast(`Не удалось скачать: ${e.message}`);
    }
  }

  function fileIcon(mime = '', name = '') {
    if (mime.startsWith('image/')) return '🖼';
    if (mime === 'application/pdf') return '📕';
    if (/\.(docx?|odt|rtf)$/i.test(name)) return '📝';
    if (/\.(xlsx?|csv|ods)$/i.test(name)) return '📊';
    if (/\.(zip|rar|7z|gz)$/i.test(name)) return '🗜';
    return '📄';
  }

  function panelFiles(id) {
    const listEl = h('div', { class: 'card flush' });
    const usage = h('div', { class: 'sub', style: 'margin:0' });
    let files = [];
    let info = { used: 0, limit: 20000000, max_file: 1000000 };

    function paint() {
      usage.textContent = `Занято ${fmtBytes(info.used)} из ${fmtBytes(info.limit)}. Один файл до ${fmtBytes(info.max_file)}.`;
      listEl.replaceChildren(
        ...(files.length
          ? files.map((f) =>
              h(
                'div',
                { class: 'file-row' },
                h('span', { class: 'file-ico' }, fileIcon(f.mime, f.name)),
                h('div', { class: 'file-main' }, h('div', { class: 'file-name' }, f.name), h('div', { class: 'mail-sub' }, `${fmtBytes(f.size)} · ${f.author || '—'} · ${fmtDateTime(f.created_at)}`)),
                h('button', { class: 'btn ghost small', onclick: () => downloadFile(f) }, 'Скачать'),
                f.uploaded_by === state.user.id || canDelete ? h('button', { class: 'icon-btn', title: 'Удалить', 'aria-label': 'Удалить файл', onclick: () => remove(f) }, '✕') : null,
              ),
            )
          : [h('div', { class: 'empty' }, 'Файлов пока нет. Перетащи сюда или нажми «Загрузить».')]),
      );
    }
    let canDelete = false;
    async function load() {
      try {
        await api.swr(`/api/workspaces/${id}/files`, (r) => {
          files = r.files;
          info = r;
          paint();
        });
      } catch (e) {
        toast(e.message);
      }
    }
    async function remove(f) {
      if (!confirm(`Удалить «${f.name}»?`)) return;
      try {
        await api.del(`/api/files/${f.id}`);
        await load();
      } catch (e) {
        toast(e.message);
      }
    }
    const toBase64 = (file) =>
      new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
        fr.onerror = () => reject(new Error('не удалось прочитать файл'));
        fr.readAsDataURL(file);
      });
    async function upload(fileList) {
      for (const file of fileList) {
        if (file.size > info.max_file) {
          toast(`«${file.name}» больше ${fmtBytes(info.max_file)}`);
          continue;
        }
        if (!file.size) {
          toast(`«${file.name}» пустой`);
          continue;
        }
        try {
          await api.post(`/api/workspaces/${id}/files`, { name: file.name, mime: file.type || 'application/octet-stream', data: await toBase64(file) });
        } catch (e) {
          toast(e.message);
        }
      }
      await load();
    }
    const picker = h('input', { type: 'file', multiple: true, hidden: true, onchange: () => (upload([...picker.files]), (picker.value = '')) });
    const drop = h('div', { class: 'dropzone' }, h('span', null, 'Перетащи файлы сюда'), h('button', { class: 'btn small', onclick: () => picker.click() }, 'Загрузить'), picker);
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => (e.preventDefault(), drop.classList.add('over'))));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => (e.preventDefault(), drop.classList.remove('over'))));
    drop.addEventListener('drop', (e) => upload([...e.dataTransfer.files]));

    api.get(`/api/workspaces/${id}`).then((r) => ((canDelete = r.workspace.role === 'owner'), paint())).catch(() => {});
    load();
    return h('div', null, drop, usage, h('div', { class: 'spacer', style: 'height:12px' }), listEl);
  }

  // ---------- проект ----------

  async function viewProject(id) {
    const S = await api.fast(`/api/projects/${id}`);
    document.title = `${S.project.name} · tasqly`;
    setAiContext(S.project.workspace_id, id, `проект «${S.project.name}»`);

    const F = { q: '', assignee: '', label: '', priority: '', late: false };
    let view = 'overview'; // проект всегда открывается на обзоре
    const now = new Date();
    const cal = { y: now.getFullYear(), m: now.getMonth() };
    const calExpanded = new Set();
    let refocusColumn = null;
    const content = h('div', { class: 'content' });

    // --- данные ---
    const sortedCols = () => [...S.columns].sort((a, b) => a.position - b.position);
    const colById = (cid) => S.columns.find((c) => c.id === cid);
    const labelById = (lid) => S.labels.find((l) => l.id === lid);
    const memberName = (uid) => (S.members.find((m) => m.id === uid) || {}).name;
    const colTasks = (cid) => S.tasks.filter((t) => t.column_id === cid).sort((a, b) => a.position - b.position);
    const isDone = (t) => !!(colById(t.column_id) || {}).is_done;
    const isLate = (t) => !!t.due_date && t.due_date < todayIso() && !isDone(t);
    const nextPos = (cid) => Math.max(0, ...colTasks(cid).map((t) => t.position)) + 1000;
    const filtersOn = () => !!(F.q || F.assignee || F.label || F.priority || F.late);

    function matches(t) {
      if (F.q) {
        const hay = `${t.title} ${t.description}`.toLowerCase();
        if (!hay.includes(F.q.toLowerCase())) return false;
      }
      if (F.assignee === 'me') {
        if (t.assignee_id !== state.user.id) return false;
      } else if (F.assignee === 'none') {
        if (t.assignee_id) return false;
      } else if (F.assignee && t.assignee_id !== F.assignee) return false;
      if (F.label && !t.label_ids.includes(F.label)) return false;
      if (F.priority !== '' && String(t.priority) !== F.priority) return false;
      if (F.late && !isLate(t)) return false;
      return true;
    }

    async function reload() {
      Object.assign(S, await api.get(`/api/projects/${id}`));
      fillLabelSelect();
      paint();
    }

    // --- изменения (с откатом при ошибке) ---
    async function moveTask(task, patch) {
      const before = { column_id: task.column_id, position: task.position, due_date: task.due_date };
      Object.assign(task, patch);
      paint();
      try {
        const { task: upd, spawned } = await api.patch(`/api/tasks/${task.id}`, patch);
        Object.assign(task, upd);
        if (spawned) {
          S.tasks.push(spawned);
          paint();
          toast('Следующая повторяющаяся задача создана');
        }
      } catch (e) {
        Object.assign(task, before);
        paint();
        toast(e.message);
      }
    }

    async function addTask(columnId, title) {
      try {
        const { task } = await api.post(`/api/projects/${id}/tasks`, { title, column_id: columnId });
        S.tasks.push(task);
        refocusColumn = columnId;
        paint();
      } catch (e) {
        toast(e.message);
      }
    }

    async function patchColumn(col, patch) {
      try {
        const { column } = await api.patch(`/api/columns/${col.id}`, patch);
        Object.assign(col, column);
        paint();
      } catch (e) {
        toast(e.message);
      }
    }

    function moveColumn(col, dir) {
      const cols = sortedCols();
      const i = cols.findIndex((c) => c.id === col.id);
      const near = cols[i + dir];
      if (!near) return;
      const far = cols[i + dir * 2];
      const position = far ? (near.position + far.position) / 2 : near.position + dir * 1000;
      patchColumn(col, { position });
    }

    async function deleteColumn(col) {
      const n = colTasks(col.id).length;
      const text = n ? `Удалить колонку «${col.name}»? ${n} задач(и) переедут в соседнюю колонку.` : `Удалить колонку «${col.name}»?`;
      if (!confirm(text)) return;
      try {
        await api.del(`/api/columns/${col.id}`);
        await reload();
      } catch (e) {
        toast(e.message);
      }
    }

    // --- карточка на доске ---
    function labelPill(lid) {
      const l = labelById(lid);
      return l ? h('span', { class: 'pill', style: `--c:${l.color}`, title: l.name }, l.name) : null;
    }
    const prioIcon = (n) => (n ? h('span', { class: `prio p${n}`, title: `Приоритет: ${PRIORITIES[n].toLowerCase()}` }, h('i'), h('i'), h('i')) : null);

    function card(t) {
      const el = h(
        'div',
        { class: `task${isDone(t) ? ' done' : ''}`, draggable: 'true', 'data-id': t.id, onclick: () => openTask(t.id) },
        t.label_ids.length || (t.task_type && t.task_type !== 'task') ? h('div', { class: 'pills' }, t.task_type && t.task_type !== 'task' ? h('span', { class: 'pill', style: `--c:${TASK_TYPE_COLORS[t.task_type]}` }, TASK_TYPES[t.task_type].toLowerCase()) : null, t.label_ids.map(labelPill)) : null,
        h('div', { class: 'title' }, t.title),
        h(
          'div',
          { class: 'meta' },
          prioIcon(t.priority),
          t.due_date ? h('span', { class: isLate(t) ? 'late' : '' }, formatDate(t.due_date)) : null,
          t.check_total ? h('span', { class: t.check_done === t.check_total ? 'ok' : '' }, `☑ ${t.check_done}/${t.check_total}`) : null,
          t.comments ? h('span', null, `💬 ${t.comments}`) : null,
          t.tracked_sec || t.estimate_min ? h('span', { class: t.estimate_min && t.tracked_sec > t.estimate_min * 60 ? 'late' : '', title: 'Затрачено / оценка' }, `⏱ ${t.tracked_sec ? fmtDur(t.tracked_sec) : '0'}${t.estimate_min ? ` / ${fmtDur(t.estimate_min * 60)}` : ''}`) : null,
          h('span', { class: 'grow' }),
          t.assignee_id ? avatar(memberName(t.assignee_id)) : null,
        ),
      );
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', t.id);
        e.dataTransfer.effectAllowed = 'move';
        requestAnimationFrame(() => el.classList.add('dragging'));
      });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
      return el;
    }

    // --- доска ---
    function columnEl(col, index, cols) {
      const all = colTasks(col.id);
      const shown = all.filter(matches);
      const name = h('span', { class: 'name', title: 'Нажми, чтобы переименовать' }, col.name);
      name.addEventListener('click', () => inlineEdit(name, col.name, (v) => patchColumn(col, { name: v }), 40));

      const more = h('button', { class: 'icon-btn', 'aria-label': 'Меню колонки' }, '⋯');
      more.addEventListener('click', () =>
        openMenu(more, [
          { label: 'Переименовать', onClick: () => inlineEdit(name, col.name, (v) => patchColumn(col, { name: v }), 40) },
          { label: col.is_done ? 'Убрать отметку «готово»' : 'Считать колонку «готово»', onClick: () => patchColumn(col, { is_done: !col.is_done }) },
          '-',
          { label: 'Сдвинуть влево', disabled: index === 0, onClick: () => moveColumn(col, -1) },
          { label: 'Сдвинуть вправо', disabled: index === cols.length - 1, onClick: () => moveColumn(col, 1) },
          '-',
          { label: 'Удалить колонку', danger: true, disabled: cols.length < 2, onClick: () => deleteColumn(col) },
        ]),
      );

      const list = h('div', { class: 'cards' }, shown.map(card));
      const input = h('input', { type: 'text', placeholder: '+ Новая задача', maxlength: 200, 'data-add': col.id });
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const title = input.value.trim();
        if (title) addTask(col.id, title);
      });

      const el = h(
        'section',
        { class: 'column', 'data-col': col.id },
        h(
          'div',
          { class: 'col-head' },
          name,
          col.is_done ? h('span', { class: 'done-mark', title: 'Задачи в этой колонке считаются выполненными' }, '✓') : null,
          h('span', { class: 'count' }, filtersOn() ? `${shown.length}/${all.length}` : all.length),
          more,
        ),
        list,
        h('div', { class: 'add-task' }, input),
      );

      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        el.classList.add('over');
      });
      el.addEventListener('dragleave', (e) => {
        if (!el.contains(e.relatedTarget)) el.classList.remove('over');
      });
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('over');
        const task = S.tasks.find((x) => x.id === e.dataTransfer.getData('text/plain'));
        if (!task) return;
        // вставляем перед первой карточкой, чья середина ниже курсора
        const others = colTasks(col.id).filter((x) => matches(x) && x.id !== task.id);
        const cards = [...list.querySelectorAll('.task')].filter((c) => c.dataset.id !== task.id);
        let at = cards.findIndex((c) => {
          const r = c.getBoundingClientRect();
          return e.clientY < r.top + r.height / 2;
        });
        if (at === -1) at = others.length;
        const prev = others[at - 1];
        const next = others[at];
        const position = prev && next ? (prev.position + next.position) / 2 : prev ? prev.position + 1000 : next ? next.position - 1000 : 1000;
        moveTask(task, { column_id: col.id, position });
      });
      return el;
    }

    function addColumnEl() {
      const btn = h('button', { class: 'add-column' }, '+ Колонка');
      btn.addEventListener('click', () => {
        const input = h('input', { type: 'text', placeholder: 'Название колонки', maxlength: 40 });
        btn.replaceWith(h('div', { class: 'add-column-form' }, input));
        input.focus();
        let finished = false;
        const finish = async (commit) => {
          if (finished) return;
          finished = true;
          const v = input.value.trim();
          if (commit && v) {
            try {
              const { column } = await api.post(`/api/projects/${id}/columns`, { name: v });
              S.columns.push(column);
            } catch (e) {
              toast(e.message);
            }
          }
          paint();
        };
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') finish(true);
          else if (e.key === 'Escape') finish(false);
        });
        input.addEventListener('blur', () => finish(true));
      });
      return btn;
    }

    function paintBoard() {
      const prev = content.querySelector('.board');
      const cols = sortedCols();
      const board = h('div', { class: 'board' }, cols.map(columnEl), addColumnEl());
      content.replaceChildren(board);
      if (prev) board.scrollLeft = prev.scrollLeft;
      if (refocusColumn) {
        const input = board.querySelector(`input[data-add="${refocusColumn}"]`);
        if (input) input.focus();
        refocusColumn = null;
      }
    }

    // --- список ---
    function toggleDone(t) {
      const cols = sortedCols();
      const target = isDone(t) ? cols.find((c) => !c.is_done) : cols.find((c) => c.is_done);
      if (!target) return toast('Нет колонки «готово»: отметь её в меню колонки');
      moveTask(t, { column_id: target.id, position: nextPos(target.id) });
    }

    function listRow(t) {
      const cb = h('input', { type: 'checkbox', checked: isDone(t), 'aria-label': 'Выполнено' });
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () => toggleDone(t));
      return h(
        'div',
        { class: `list-row${isDone(t) ? ' done' : ''}`, onclick: () => openTask(t.id) },
        cb,
        h('div', { class: 't' }, h('span', { class: 'title' }, t.title), t.check_total ? h('span', { class: 'due' }, `☑ ${t.check_done}/${t.check_total}`) : null),
        h('div', { class: 'pills' }, t.label_ids.map(labelPill)),
        h('div', { class: `due${isLate(t) ? ' late' : ''}` }, t.due_date ? formatDate(t.due_date) : ''),
        h('div', { class: 'end prio-cell' }, prioIcon(t.priority)),
        h('div', { class: 'end' }, t.assignee_id ? avatar(memberName(t.assignee_id)) : null),
      );
    }

    function paintList() {
      const wrap = h('div', { class: 'list' });
      for (const col of sortedCols()) {
        const ts = colTasks(col.id).filter(matches);
        wrap.append(h('div', { class: 'group-head' }, col.name, col.is_done ? h('span', { class: 'done-mark', style: 'color:var(--ok)' }, '✓') : null, h('span', { class: 'count' }, ts.length)));
        if (!ts.length) wrap.append(h('div', { class: 'empty', style: 'padding:8px;text-align:left' }, 'Пусто'));
        ts.forEach((t) => wrap.append(listRow(t)));
      }
      content.replaceChildren(wrap);
    }

    // --- календарь ---
    function calChip(t) {
      const chip = h('button', { class: `cal-chip${isDone(t) ? ' done' : ''}${isLate(t) ? ' late' : ''}`, draggable: 'true', title: t.title, onclick: () => openTask(t.id) }, t.title);
      chip.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', t.id);
        e.dataTransfer.effectAllowed = 'move';
      });
      return chip;
    }

    function paintCalendar() {
      const first = new Date(cal.y, cal.m, 1);
      const offset = (first.getDay() + 6) % 7; // неделя с понедельника
      const days = new Date(cal.y, cal.m + 1, 0).getDate();
      const weeks = Math.ceil((offset + days) / 7);
      const start = new Date(cal.y, cal.m, 1 - offset);
      const today = todayIso();
      const visible = S.tasks.filter(matches);

      const grid = h('div', { class: 'cal-grid' }, ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => h('div', { class: 'cal-dow' }, d)));
      for (let i = 0; i < weeks * 7; i++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        const iso = isoOf(d);
        const items = visible.filter((t) => t.due_date === iso);
        const expanded = calExpanded.has(iso);
        const shown = expanded ? items : items.slice(0, 3);
        const cell = h(
          'div',
          { class: `cal-cell${d.getMonth() !== cal.m ? ' other' : ''}${iso === today ? ' today' : ''}` },
          h('span', { class: 'num' }, d.getDate()),
          shown.map(calChip),
          items.length > 3
            ? h(
                'button',
                {
                  class: 'cal-more',
                  onclick: () => {
                    if (expanded) calExpanded.delete(iso);
                    else calExpanded.add(iso);
                    paint();
                  },
                },
                expanded ? 'Свернуть' : `ещё ${items.length - 3}`,
              )
            : null,
        );
        cell.addEventListener('dragover', (e) => {
          e.preventDefault();
          cell.classList.add('over');
        });
        cell.addEventListener('dragleave', () => cell.classList.remove('over'));
        cell.addEventListener('drop', (e) => {
          e.preventDefault();
          cell.classList.remove('over');
          const task = S.tasks.find((x) => x.id === e.dataTransfer.getData('text/plain'));
          if (task && task.due_date !== iso) moveTask(task, { due_date: iso });
        });
        grid.append(cell);
      }

      const shift = (n) => {
        const d = new Date(cal.y, cal.m + n, 1);
        cal.y = d.getFullYear();
        cal.m = d.getMonth();
        paint();
      };
      const nodate = visible.filter((t) => !t.due_date && !isDone(t));
      content.replaceChildren(
        h(
          'div',
          { class: 'cal' },
          h(
            'div',
            { class: 'cal-head' },
            h('button', { class: 'icon-btn', 'aria-label': 'Предыдущий месяц', onclick: () => shift(-1) }, '‹'),
            h('span', { class: 'month' }, first.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })),
            h('button', { class: 'icon-btn', 'aria-label': 'Следующий месяц', onclick: () => shift(1) }, '›'),
            h(
              'button',
              {
                class: 'btn ghost small',
                onclick: () => {
                  const t = new Date();
                  cal.y = t.getFullYear();
                  cal.m = t.getMonth();
                  paint();
                },
              },
              'Сегодня',
            ),
          ),
          grid,
          nodate.length ? h('div', { class: 'cal-nodate' }, h('h2', null, 'Без срока: перетащи на нужный день'), h('div', { class: 'chips' }, nodate.map(calChip))) : null,
        ),
      );
    }

    // --- обзор проекта ---
    function paintOverview() {
      const cols = sortedCols();
      const firstId = cols[0] && cols[0].id;
      const total = S.tasks.length;
      const done = S.tasks.filter(isDone);
      const late = S.tasks.filter(isLate);
      const open = S.tasks.filter((t) => !isDone(t));
      const waiting = open.filter((t) => !isLate(t) && t.column_id === firstId);
      const doing = open.filter((t) => !isLate(t) && t.column_id !== firstId);
      const pct = total ? Math.round((done.length / total) * 100) : 0;
      const tracked = S.tasks.reduce((n, t) => n + (t.tracked_sec || 0), 0);
      const estimated = S.tasks.reduce((n, t) => n + (t.estimate_min || 0) * 60, 0);
      const unassigned = open.filter((t) => !t.assignee_id).length;

      const stat = (label, n, cls) => h('div', { class: `stat ${cls}` }, h('div', { class: 'stat-name' }, label), h('div', { class: 'stat-num' }, n));

      // кольцо: готово, в работе, ожидает, просрочено
      const segs = [
        [done.length, 'var(--ok)', 'Готово'],
        [doing.length, 'var(--accent)', 'В работе'],
        [waiting.length, 'var(--border-strong)', 'Ожидает'],
        [late.length, 'var(--danger)', 'Просрочено'],
      ];
      const R = 52;
      const C = 2 * Math.PI * R;
      let offset = 0;
      const arcs = total
        ? segs
            .filter(([n]) => n)
            .map(([n, color]) => {
              const len = (n / total) * C;
              const el = `<circle cx="70" cy="70" r="${R}" fill="none" stroke-width="16" style="stroke:${color}" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 70 70)"/>`;
              offset += len;
              return el;
            })
            .join('')
        : '';
      const ring = h('div', { class: 'ring' });
      ring.innerHTML = `<svg viewBox="0 0 140 140" width="150" height="150" role="img" aria-label="Статусы задач"><circle cx="70" cy="70" r="${R}" fill="none" stroke-width="16" style="stroke:var(--hover)"/>${arcs}</svg>`;
      ring.append(h('div', { class: 'ring-num' }, h('b', null, total), h('span', null, 'задач')));

      // команда: открытые задачи по людям
      const people = S.members.map((m) => ({ m, open: open.filter((t) => t.assignee_id === m.id).length, done: done.filter((t) => t.assignee_id === m.id).length }));
      const maxOpen = Math.max(1, ...people.map((x) => x.open));

      // ближайшие незавершённые задачи
      const rows = [...open]
        .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || b.priority - a.priority)
        .slice(0, 8);
      const colName = (id) => (S.columns.find((c) => c.id === id) || {}).name || '';
      const taskPct = (t) => (t.check_total ? Math.round((t.check_done / t.check_total) * 100) : 0);

      content.replaceChildren(
        h(
          'div',
          { class: 'overview' },
          h(
            'div',
            { class: 'ov-top' },
            h('div', { class: 'card' }, h('h2', null, 'Прогресс проекта'), h('div', { class: 'big' }, `${pct}%`), h('div', { class: 'progress', style: 'margin-top:8px' }, h('span', { style: `width:${pct}%` })), h('div', { class: 'mail-sub', style: 'margin-top:8px' }, `${done.length} из ${total} задач выполнено${S.project.kind && S.project.kind !== 'basic' ? ` · проект ${KINDS[S.project.kind].name.toLowerCase()}` : ''}`)),
            h('div', { class: 'card' }, h('h2', null, 'Время'), h('div', { class: 'big' }, fmtDur(tracked)), estimated ? h('div', { class: `progress${tracked > estimated ? ' over' : ''}`, style: 'margin-top:8px' }, h('span', { style: `width:${Math.min(100, Math.round((tracked / estimated) * 100))}%` })) : null, h('div', { class: 'mail-sub', style: 'margin-top:8px' }, estimated ? `оценка: ${fmtDur(estimated)}` : 'оценка не задана')),
            h('div', { class: 'card' }, h('h2', null, `Команда · ${S.members.length}`), h('div', { class: 'team' }, people.map((x) => h('div', { class: 'team-row' }, avatar(x.m.name), h('span', { class: 'team-name' }, x.m.name), h('div', { class: 'bar' }, h('span', { style: `width:${x.open ? Math.max(6, Math.round((x.open / maxOpen) * 100)) : 0}%` })), h('span', { class: 'bar-val' }, `${x.open}`))), h('div', { class: 'mail-sub', style: 'margin-top:6px' }, 'открытых задач у каждого'))),
          ),
          h('div', { class: 'stats' }, stat('В работе', doing.length, 'blue'), stat('Просрочено', late.length, 'red'), stat('Завершено', done.length, 'green'), stat('Без исполнителя', unassigned, 'gray')),
          h(
            'div',
            { class: 'ov-bottom' },
            h('div', { class: 'card' }, h('h2', null, 'Статус задач'), ring, h('div', { class: 'legend' }, segs.map(([n, color, label]) => h('span', null, h('i', { style: `background:${color}` }), `${label} ${n}`)))),
            h(
              'div',
              { class: 'card flush' },
              h('h2', { style: 'padding:14px 16px 0' }, 'Ближайшие задачи'),
              rows.length
                ? h(
                    'div',
                    { class: 'ov-table' },
                    h('div', { class: 'ov-row head' }, h('span', null, 'Задача'), h('span', null, 'Колонка'), h('span', null, 'Чек-лист'), h('span', null, 'Срок')),
                    rows.map((t) =>
                      h(
                        'button',
                        { class: 'ov-row', onclick: () => openTask(t.id) },
                        h('span', { class: 'ov-title' }, t.title),
                        h('span', null, h('span', { class: 'pill', style: '--c:var(--accent)' }, colName(t.column_id))),
                        h('span', { class: 'ov-prog' }, t.check_total ? [h('div', { class: 'bar' }, h('span', { style: `width:${taskPct(t)}%` })), h('span', { class: 'bar-val' }, `${taskPct(t)}%`)] : h('span', { class: 'mail-sub' }, '—')),
                        h('span', { class: isLate(t) ? 'late' : 'mail-sub' }, t.due_date ? formatDate(t.due_date) : '—'),
                      ),
                    ),
                  )
                : h('div', { class: 'empty' }, total ? 'Все задачи выполнены' : 'Задач пока нет. Добавь первую на доске.'),
            ),
          ),
        ),
      );
    }

    function paint() {
      toolbarEl.style.display = view === 'overview' ? 'none' : '';
      if (view === 'overview') paintOverview();
      else if (view === 'list') paintList();
      else if (view === 'calendar') paintCalendar();
      else paintBoard();
      syncReset();
    }

    // --- окно задачи ---
    function openTask(taskId) {
      const task = S.tasks.find((t) => t.id === taskId);
      if (!task) return;

      const saved = h('div', { class: 'saved' });
      let savedTimer;
      const flash = (text = 'Сохранено') => {
        saved.textContent = text;
        clearTimeout(savedTimer);
        savedTimer = setTimeout(() => (saved.textContent = ''), 1600);
      };
      const save = async (patch) => {
        try {
          const { task: upd, spawned } = await api.patch(`/api/tasks/${task.id}`, patch);
          Object.assign(task, upd);
          if (spawned) {
            S.tasks.push(spawned);
            repeatSel.value = task.repeat;
            toast('Следующая повторяющаяся задача создана');
          }
          paint();
          flash();
        } catch (e) {
          toast(e.message);
        }
      };

      const title = h('input', { type: 'text', value: task.title, maxlength: 200, 'aria-label': 'Название задачи' });
      const commitTitle = () => {
        const v = title.value.trim();
        if (!v) title.value = task.title;
        else if (v !== task.title) save({ title: v });
      };
      title.addEventListener('blur', commitTitle);
      title.addEventListener('keydown', (e) => e.key === 'Enter' && title.blur());

      const desc = h('textarea', { maxlength: 5000, placeholder: 'Описание' });
      desc.value = task.description || '';
      desc.addEventListener('blur', () => {
        if (desc.value.trim() !== task.description) save({ description: desc.value });
      });

      const columnSel = h('select', null, sortedCols().map((c) => h('option', { value: c.id, selected: c.id === task.column_id }, c.name)));
      columnSel.addEventListener('change', () => save({ column_id: columnSel.value, position: nextPos(columnSel.value) }));
      const prioSel = h('select', null, PRIORITIES.map((p, i) => h('option', { value: i, selected: i === task.priority }, p)));
      prioSel.addEventListener('change', () => save({ priority: Number(prioSel.value) }));
      const assigneeSel = h('select', null, h('option', { value: '' }, 'Не назначен'), S.members.map((m) => h('option', { value: m.id, selected: m.id === task.assignee_id }, m.name)));
      assigneeSel.addEventListener('change', () => save({ assignee_id: assigneeSel.value || null }));
      const due = h('input', { type: 'date', value: task.due_date || '' });
      due.addEventListener('change', () => save({ due_date: due.value || null }));
      const REPEAT_NAMES = { none: 'Не повторять', daily: 'Каждый день', weekly: 'Каждую неделю', monthly: 'Каждый месяц' };
      const repeatSel = h('select', null, Object.entries(REPEAT_NAMES).map(([k, v]) => h('option', { value: k, selected: k === (task.repeat || 'none') }, v)));
      repeatSel.addEventListener('change', () => save({ repeat: repeatSel.value }));

      const kind = S.project.kind || 'basic';
      const typeSel = h('select', null, Object.entries(TASK_TYPES).map(([k, v]) => h('option', { value: k, selected: k === (task.task_type || 'task') }, v)));
      typeSel.addEventListener('change', () => save({ task_type: typeSel.value }));
      const estimate = h('input', { type: 'number', min: 0, max: 1000, step: 0.5, placeholder: 'часы', value: task.estimate_min ? String(task.estimate_min / 60) : '' });
      estimate.addEventListener('change', () => {
        const v = estimate.value === '' ? null : Math.round(Number(estimate.value) * 60);
        if (v !== null && (!Number.isFinite(v) || v < 0)) return toast('Оценка: число часов');
        save({ estimate_min: v }).then(paintTime);
      });

      // время: таймер, ручной ввод и записи
      const timeBox = h('div', { class: 'time-box' });
      let timeEntries = [];
      let timeTotal = 0;
      const timerHere = () => state.timer && state.timer.task_id === task.id;
      async function loadTime() {
        try {
          const r = await api.get(`/api/tasks/${task.id}/time`);
          timeEntries = r.entries;
          timeTotal = r.total_sec;
          task.tracked_sec = r.total_sec;
          paint();
          paintTime();
        } catch (e) {
          toast(e.message);
        }
      }
      async function toggleTimer() {
        try {
          if (timerHere()) await api.post('/api/timer/stop');
          else {
            const r = await api.post(`/api/tasks/${task.id}/timer/start`);
            state.timer = r.entry;
            timerOffset = r.server_time - Date.now();
          }
          if (!timerHere() || !state.timer) state.timer = null;
          await refreshTimer();
          await loadTime();
        } catch (e) {
          toast(e.message);
        }
      }
      const manualMin = h('input', { type: 'number', min: 1, max: 1440, placeholder: 'минут' });
      const manualNote = h('input', { type: 'text', placeholder: 'Что делал (необязательно)', maxlength: 200 });
      async function addManual() {
        const minutes = Math.round(Number(manualMin.value));
        if (!minutes || minutes < 1) return toast('Укажи минуты, от 1 до 1440');
        try {
          await api.post(`/api/tasks/${task.id}/time`, { minutes, note: manualNote.value });
          manualMin.value = '';
          manualNote.value = '';
          flash('Время добавлено');
          await loadTime();
        } catch (e) {
          toast(e.message);
        }
      }
      function paintTime() {
        const est = task.estimate_min ? task.estimate_min * 60 : 0;
        const pct = est ? Math.min(100, Math.round((timeTotal / est) * 100)) : 0;
        timeBox.replaceChildren(
          h(
            'div',
            { class: 'time-top' },
            h('button', { class: `btn small${timerHere() ? ' danger' : ''}`, onclick: toggleTimer }, timerHere() ? '■ Остановить' : '▶ Запустить таймер'),
            timerHere() ? h('span', { class: 'timer-live' }, fmtClock(elapsedSec())) : null,
            h('span', { class: 'grow' }),
            h('span', { class: 'mail-sub' }, `Затрачено: ${fmtDur(timeTotal)}${est ? ` из ${fmtDur(est)}` : ''}`),
          ),
          est ? h('div', { class: `progress${timeTotal > est ? ' over' : ''}` }, h('span', { style: `width:${pct}%` })) : null,
          h('div', { class: 'row', style: 'margin-top:10px' }, manualMin, manualNote, h('button', { class: 'btn ghost small', onclick: addManual }, 'Добавить')),
          timeEntries.length
            ? h(
                'div',
                { class: 'time-list' },
                timeEntries.slice(0, 5).map((e) =>
                  h(
                    'div',
                    { class: 'time-line' },
                    h('span', { class: 'grow' }, `${e.author || '—'}${e.note ? ` · ${e.note}` : ''}`),
                    h('span', { class: 'mail-sub' }, fmtDateTime(e.started_at)),
                    h('span', { class: 'dur' }, e.ended_at ? fmtDur(e.seconds) : 'идёт'),
                    e.user_id === state.user.id && e.ended_at
                      ? h('button', { class: 'icon-btn', title: 'Удалить запись', 'aria-label': 'Удалить запись', onclick: async () => (await api.del(`/api/time/${e.id}`).catch((er) => toast(er.message)), loadTime()) }, '✕')
                      : null,
                  ),
                ),
              )
            : null,
        );
      }
      const aiBtn = h('button', { class: 'btn ghost small', title: 'AI предложит шаги, а ты подтвердишь' }, '✦ Разбить с AI');
      const aiBox = h('div', { class: 'ai-props' });
      aiBtn.addEventListener('click', async () => {
        aiBtn.disabled = true;
        aiBtn.textContent = 'Думаю…';
        try {
          const r = await api.post(`/api/tasks/${task.id}/ai/subtasks`, {});
          const rows = r.items.map((text) => {
            const cb = h('input', { type: 'checkbox', checked: true });
            return { text, cb, el: h('label', { class: 'prop' }, cb, h('span', { class: 'grow' }, text)) };
          });
          const add = h('button', { class: 'btn small' }, 'Добавить выбранные');
          add.addEventListener('click', async () => {
            add.disabled = true;
            for (const row of rows.filter((x) => x.cb.checked)) {
              try {
                const { item } = await api.post(`/api/tasks/${task.id}/checklist`, { text: row.text });
                items.push(item);
              } catch (e) {
                toast(e.message);
              }
            }
            paintChecklist();
            task.check_total = items.length;
            task.check_done = items.filter((i) => i.done).length;
            paint();
            aiBox.replaceChildren();
          });
          aiBox.replaceChildren(h('div', { class: 'card flush' }, rows.map((x) => x.el)), h('div', { style: 'margin-top:8px' }, add));
        } catch (e) {
          toast(e.message);
        } finally {
          aiBtn.disabled = false;
          aiBtn.textContent = '✦ Разбить с AI';
        }
      });
      const onTimer = () => paintTime();
      window.addEventListener('tq-timer', onTimer);

      // метки
      const labelBox = h('div', { class: 'label-picker' });
      let manage = false;
      let newColor = LABEL_COLORS[0];
      const newName = h('input', { type: 'text', placeholder: 'Новая метка', maxlength: 30 });
      const swatches = h('span', { class: 'row', style: 'gap:4px' });

      async function setLabels(ids) {
        try {
          const { task: upd } = await api.put(`/api/tasks/${task.id}/labels`, { label_ids: ids });
          Object.assign(task, upd);
          paint();
          paintLabels();
        } catch (e) {
          toast(e.message);
        }
      }
      async function removeLabel(l) {
        if (!confirm(`Удалить метку «${l.name}» у всех задач?`)) return;
        try {
          await api.del(`/api/labels/${l.id}`);
          S.labels = S.labels.filter((x) => x.id !== l.id);
          S.tasks.forEach((t) => (t.label_ids = t.label_ids.filter((x) => x !== l.id)));
          if (F.label === l.id) F.label = '';
          fillLabelSelect();
          paint();
          paintLabels();
        } catch (e) {
          toast(e.message);
        }
      }
      async function createLabel() {
        const name = newName.value.trim();
        if (!name) return;
        try {
          const { label } = await api.post(`/api/workspaces/${S.project.workspace_id}/labels`, { name, color: newColor });
          S.labels.push(label);
          newName.value = '';
          fillLabelSelect();
          await setLabels([...task.label_ids, label.id]);
        } catch (e) {
          toast(e.message);
        }
      }
      newName.addEventListener('keydown', (e) => e.key === 'Enter' && createLabel());

      function paintSwatches() {
        swatches.replaceChildren(
          ...LABEL_COLORS.map((c) =>
            h('button', {
              class: `swatch${c === newColor ? ' on' : ''}`,
              style: `background:${c}`,
              'aria-label': 'Цвет метки',
              onclick: () => {
                newColor = c;
                paintSwatches();
              },
            }),
          ),
        );
      }
      function paintLabels() {
        labelBox.replaceChildren(
          ...S.labels.map((l) => {
            const on = task.label_ids.includes(l.id);
            const b = h('button', { class: `label-opt${on ? ' on' : ''}`, style: `--c:${l.color}`, title: manage ? 'Удалить метку' : on ? 'Убрать с задачи' : 'Добавить к задаче' }, l.name, manage ? h('span', { class: 'x' }, '✕') : null);
            b.addEventListener('click', () => (manage ? removeLabel(l) : setLabels(on ? task.label_ids.filter((x) => x !== l.id) : [...task.label_ids, l.id])));
            return b;
          }),
          S.labels.length
            ? h(
                'button',
                {
                  class: 'btn ghost small',
                  onclick: () => {
                    manage = !manage;
                    paintLabels();
                  },
                },
                manage ? 'Готово' : 'Управлять',
              )
            : h('span', { class: 'sub', style: 'margin:0;font-size:12px' }, 'Меток пока нет'),
        );
      }
      paintSwatches();
      paintLabels();

      // подзадачи и чек-лист
      let items = [];
      const checkBox = h('div', { class: 'checklist' });
      const addItem = h('input', { type: 'text', placeholder: '+ Добавить подзадачу', maxlength: 200 });
      const syncCounts = () => {
        task.check_total = items.length;
        task.check_done = items.filter((i) => i.done).length;
        paintChecklist();
        paint();
      };
      function itemRow(item) {
        const cb = h('input', { type: 'checkbox', checked: item.done, 'aria-label': 'Готово' });
        cb.addEventListener('change', async () => {
          try {
            const { item: upd } = await api.patch(`/api/checklist/${item.id}`, { done: cb.checked });
            Object.assign(item, upd);
            syncCounts();
          } catch (e) {
            cb.checked = !cb.checked;
            toast(e.message);
          }
        });
        const text = h('input', { type: 'text', value: item.text, maxlength: 200 });
        text.addEventListener('blur', async () => {
          const v = text.value.trim();
          if (!v) text.value = item.text;
          else if (v !== item.text) {
            try {
              const { item: upd } = await api.patch(`/api/checklist/${item.id}`, { text: v });
              Object.assign(item, upd);
            } catch (e) {
              text.value = item.text;
              toast(e.message);
            }
          }
        });
        text.addEventListener('keydown', (e) => e.key === 'Enter' && text.blur());
        const del = h('button', { class: 'icon-btn', 'aria-label': 'Удалить пункт' }, '✕');
        del.addEventListener('click', async () => {
          try {
            await api.del(`/api/checklist/${item.id}`);
            items = items.filter((i) => i.id !== item.id);
            syncCounts();
          } catch (e) {
            toast(e.message);
          }
        });
        return h('div', { class: `check-row${item.done ? ' done' : ''}` }, cb, text, del);
      }
      function paintChecklist() {
        const done = items.filter((i) => i.done).length;
        checkBox.replaceChildren(
          items.length ? h('div', { class: 'progress bar' }, h('span', { style: `width:${Math.round((done / items.length) * 100)}%` })) : null,
          ...items.map(itemRow),
          addItem,
        );
      }
      addItem.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        const v = addItem.value.trim();
        if (!v) return;
        try {
          const { item } = await api.post(`/api/tasks/${task.id}/checklist`, { text: v });
          items.push(item);
          addItem.value = '';
          syncCounts();
          addItem.focus();
        } catch (err) {
          toast(err.message);
        }
      });
      paintChecklist();

      // комментарии
      const commentsBox = h('div', null, h('div', { class: 'sub' }, 'Загрузка…'));
      const commentInput = h('textarea', { placeholder: 'Написать комментарий. @ — упомянуть коллегу', style: 'min-height:60px', maxlength: 2000 });
      const mentionList = h('div', { class: 'mention-list', hidden: true });
      const mentionNames = () => S.members.filter((m) => m.id !== state.user.id).map((m) => m.name);
      const mentionNodes = (text) => {
        const names = mentionNames().sort((a, b) => b.length - a.length);
        const out = [];
        let rest = text;
        while (rest) {
          let at = -1;
          let hit = '';
          for (let i = rest.indexOf('@'); i !== -1; i = rest.indexOf('@', i + 1)) {
            const n = names.find((x) => rest.slice(i + 1, i + 1 + x.length).toLowerCase() === x.toLowerCase());
            if (n) { at = i; hit = rest.slice(i, i + 1 + n.length); break; }
          }
          if (at === -1) { out.push(rest); break; }
          if (at) out.push(rest.slice(0, at));
          out.push(h('span', { class: 'mention' }, hit));
          rest = rest.slice(at + hit.length);
        }
        return out;
      };
      const hideMentions = () => (mentionList.hidden = true);
      const showMentions = () => {
        const upto = commentInput.value.slice(0, commentInput.selectionStart);
        const m = upto.match(/(?:^|\s)@([^\s@]{0,20})$/);
        if (!m) return hideMentions();
        const q = m[1].toLowerCase();
        const found = mentionNames().filter((n) => n.toLowerCase().includes(q)).slice(0, 5);
        if (!found.length) return hideMentions();
        mentionList.replaceChildren(
          ...found.map((n) =>
            h('button', {
              type: 'button',
              class: 'mention-opt',
              onmousedown: (e) => {
                e.preventDefault();
                const pos = commentInput.selectionStart;
                const start = upto.length - m[1].length - 1;
                commentInput.value = commentInput.value.slice(0, start) + '@' + n + ' ' + commentInput.value.slice(pos);
                const caret = start + n.length + 2;
                commentInput.setSelectionRange(caret, caret);
                hideMentions();
                commentInput.focus();
              },
            }, avatar(n), n),
          ),
        );
        mentionList.hidden = false;
      };
      commentInput.addEventListener('input', showMentions);
      commentInput.addEventListener('blur', () => setTimeout(hideMentions, 100));
      let comments = [];
      const paintComments = () =>
        commentsBox.replaceChildren(
          ...(comments.length
            ? comments.map((c) => h('div', { class: 'comment' }, h('div', { class: 'who' }, `${c.author || 'Удалённый пользователь'} · ${formatDateTime(c.created_at)}`), h('div', { class: 'text' }, mentionNodes(c.body))))
            : [h('div', { class: 'sub', style: 'margin-bottom:12px' }, 'Комментариев пока нет')]),
        );
      const sendComment = async () => {
        const text = commentInput.value.trim();
        if (!text) return;
        try {
          const { comment } = await api.post(`/api/tasks/${task.id}/comments`, { body: text });
          comments.push(comment);
          commentInput.value = '';
          task.comments = comments.length;
          paintComments();
          paint();
        } catch (e) {
          toast(e.message);
        }
      };
      commentInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendComment();
      });

      const overlay = h('div', { class: 'overlay' });
      const close = () => {
        // дописанное поле сохраняется при потере фокуса
        if (overlay.contains(document.activeElement)) document.activeElement.blur();
        window.removeEventListener('tq-timer', onTimer);
        closeOverlay(overlay);
      };
      overlay.addEventListener('tq-close', close);
      overlay.addEventListener('mousedown', (e) => e.target === overlay && close());

      const remove = async () => {
        if (!confirm('Удалить задачу?')) return;
        try {
          await api.del(`/api/tasks/${task.id}`);
          S.tasks = S.tasks.filter((t) => t.id !== task.id);
          paint();
          closeOverlay(overlay);
        } catch (e) {
          toast(e.message);
        }
      };

      overlay.append(
        h(
          'div',
          { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
          h('div', { class: 'head' }, title, h('button', { class: 'icon-btn', onclick: close, 'aria-label': 'Закрыть' }, '✕')),
          h('label', { class: 'field' }, 'Описание'),
          desc,
          h('div', { class: 'two' }, h('div', null, h('label', { class: 'field' }, 'Колонка'), columnSel), h('div', null, h('label', { class: 'field' }, 'Приоритет'), prioSel)),
          h('div', { class: 'two' }, h('div', null, h('label', { class: 'field' }, 'Исполнитель'), assigneeSel), h('div', null, h('label', { class: 'field' }, 'Срок'), due)),
          h('label', { class: 'field' }, 'Повтор'),
          repeatSel,
          kind !== 'basic' ? h('div', { class: 'two' }, kind === 'it' ? h('div', null, h('label', { class: 'field' }, 'Тип задачи'), typeSel) : h('div'), h('div', null, h('label', { class: 'field' }, 'Оценка, часов'), estimate)) : null,
          h('div', { class: 'section' }, h('label', { class: 'field', style: 'margin-top:0' }, 'Время'), timeBox),
          h('div', { class: 'section' }, h('label', { class: 'field', style: 'margin-top:0' }, 'Метки'), labelBox, h('div', { class: 'new-label' }, newName, swatches, h('button', { class: 'btn ghost small', onclick: createLabel }, 'Добавить'))),
          h('div', { class: 'section' }, h('label', { class: 'field', style: 'margin-top:0' }, 'Подзадачи'), checkBox, h('div', { style: 'margin-top:8px' }, aiBtn), aiBox),
          saved,
          h('div', { class: 'comments' }, h('h2', null, 'Комментарии'), commentsBox, h('div', { class: 'mention-wrap' }, commentInput, mentionList), h('div', { class: 'modal-actions' }, h('button', { class: 'btn danger small', onclick: remove }, 'Удалить задачу'), h('button', { class: 'btn small', onclick: sendComment }, 'Отправить'))),
        ),
      );
      document.body.append(overlay);

      loadTime();
      api
        .get(`/api/tasks/${task.id}/comments`)
        .then((r) => ((comments = r.comments), paintComments()))
        .catch((e) => (commentsBox.textContent = e.message));
      api
        .get(`/api/tasks/${task.id}/checklist`)
        .then((r) => ((items = r.items), paintChecklist()))
        .catch((e) => toast(e.message));
    }

    // --- шапка и панель фильтров ---
    const titleEl = h('h1', { title: 'Нажми, чтобы переименовать' }, S.project.name);
    titleEl.addEventListener('click', () =>
      inlineEdit(
        titleEl,
        S.project.name,
        async (v) => {
          try {
            await api.patch(`/api/projects/${id}`, { name: v });
            S.project.name = v;
            titleEl.textContent = v;
            document.title = `${v} · tasqly`;
          } catch (e) {
            toast(e.message);
          }
        },
        80,
      ),
    );

    const viewTabs = h('div', { class: 'seg' });
    const paintTabs = () =>
      viewTabs.replaceChildren(
        ...[
          ['overview', 'Обзор'],
          ['board', 'Доска'],
          ['list', 'Список'],
          ['calendar', 'Календарь'],
        ].map(([key, label]) =>
          h(
            'button',
            {
              class: key === view ? 'active' : '',
              onclick: () => {
                view = key;
                viewStore.set(key);
                paintTabs();
                paint();
              },
            },
            label,
          ),
        ),
      );
    paintTabs();

    const more = h('button', { class: 'icon-btn', 'aria-label': 'Меню проекта' }, '⋯');
    more.addEventListener('click', () =>
      openMenu(more, [
        { label: 'Переименовать проект', onClick: () => titleEl.click() },
        { label: 'Удалить проект', danger: true, disabled: S.project.role !== 'owner', onClick: deleteProject },
      ]),
    );
    async function deleteProject() {
      if (!confirm(`Удалить проект «${S.project.name}» со всеми задачами?`)) return;
      try {
        await api.del(`/api/projects/${id}`);
        location.hash = `#/w/${S.project.workspace_id}`;
      } catch (e) {
        toast(e.message);
      }
    }

    const search = h('input', { type: 'search', class: 'search', placeholder: 'Поиск по задачам ( / )', 'aria-label': 'Поиск' });
    search.addEventListener('input', () => {
      F.q = search.value.trim();
      paint();
    });
    const assigneeFilter = h(
      'select',
      { 'aria-label': 'Исполнитель' },
      h('option', { value: '' }, 'Все исполнители'),
      h('option', { value: 'me' }, 'Мои задачи'),
      h('option', { value: 'none' }, 'Без исполнителя'),
      S.members.map((m) => h('option', { value: m.id }, m.name)),
    );
    assigneeFilter.addEventListener('change', () => ((F.assignee = assigneeFilter.value), paint()));
    const labelFilter = h('select', { 'aria-label': 'Метка' });
    function fillLabelSelect() {
      labelFilter.replaceChildren(h('option', { value: '' }, 'Все метки'), ...S.labels.map((l) => h('option', { value: l.id }, l.name)));
      labelFilter.value = labelById(F.label) ? F.label : '';
      if (!labelById(F.label)) F.label = '';
    }
    fillLabelSelect();
    labelFilter.addEventListener('change', () => ((F.label = labelFilter.value), paint()));
    const prioFilter = h(
      'select',
      { 'aria-label': 'Приоритет' },
      h('option', { value: '' }, 'Любой приоритет'),
      h('option', { value: '3' }, 'Высокий'),
      h('option', { value: '2' }, 'Средний'),
      h('option', { value: '1' }, 'Низкий'),
      h('option', { value: '0' }, 'Без приоритета'),
    );
    prioFilter.addEventListener('change', () => ((F.priority = prioFilter.value), paint()));
    const lateToggle = h('button', { class: 'toggle' }, 'Просрочено');
    lateToggle.addEventListener('click', () => {
      F.late = !F.late;
      lateToggle.classList.toggle('on', F.late);
      paint();
    });
    const resetBtn = h('button', { class: 'btn ghost small', style: 'display:none' }, 'Сбросить');
    resetBtn.addEventListener('click', () => {
      Object.assign(F, { q: '', assignee: '', label: '', priority: '', late: false });
      search.value = '';
      assigneeFilter.value = '';
      labelFilter.value = '';
      prioFilter.value = '';
      lateToggle.classList.remove('on');
      paint();
    });
    function syncReset() {
      resetBtn.style.display = filtersOn() ? '' : 'none';
    }

    const toolbarEl = h('div', { class: 'toolbar' }, search, assigneeFilter, labelFilter, prioFilter, lateToggle, resetBtn);
    render(
      topbar([{ label: 'Пространства', href: '#/' }, { label: S.project.workspace_name || 'Пространство', href: `#/w/${S.project.workspace_id}` }, { label: S.project.name }]),
      h('div', { class: 'project-head' }, titleEl, more, h('span', { class: 'grow' }), viewTabs, S.project.role === 'owner' ? h('button', { class: 'btn danger small del-project', onclick: deleteProject }, 'Удалить проект') : null),
      toolbarEl,
      content,
    );
    paint();

    // --- горячие клавиши и автообновление ---
    const onKey = (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (e.key === '/' && !['input', 'textarea', 'select'].includes(tag) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        search.focus();
      }
    };
    let refreshing = false;
    const onVisible = async () => {
      if (document.visibilityState !== 'visible' || refreshing || document.querySelector('.overlay')) return;
      refreshing = true;
      try {
        Object.assign(S, await api.get(`/api/projects/${id}`));
        fillLabelSelect();
        paint();
      } catch {
        /* следующая попытка при следующем возврате на вкладку */
      }
      refreshing = false;
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisible);
    cleanup = () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }

  // ---------- маршрутизация ----------

  let firstShow = true;
  async function route() {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
    closeMenu();
    closeInbox();
    document.querySelectorAll('.overlay').forEach((o) => o.remove());
    // плавное появление нового экрана
    app.classList.remove('page-enter');
    if (firstShow || quietRoute) { firstShow = false; quietRoute = false; } else {
      void app.offsetWidth;
      app.classList.add('page-enter');
    }
    const hash = location.hash || '#/';
    if (!IN_PANEL) {
      const path = location.pathname.replace(/\/+$/, '');
      if (path === '/login' || path === '/register') {
        if (state.user) return location.replace(PANEL);
        return viewAuth(path === '/login' ? 'login' : 'register');
      }
      if (['/pricing', '/contacts', '/privacy', '/terms'].includes(path)) return viewPublicPage(path.slice(1));
      return viewLanding();
    }
    const joinHash = hash.match(/^#\/join\/([A-Za-z0-9]{3,20})$/);
    if (!state.user) {
      if (joinHash) {
        try { sessionStorage.setItem('tq_join', joinHash[1].toUpperCase()); } catch { /* нет хранилища */ }
        return viewAuth('register', { invited: true });
      }
      if (hash === '#/login') return viewAuth('login');
      if (hash === '#/register') return viewAuth('register');
      return viewAuth(hash === '#/register' ? 'register' : 'login');
    }
    {
      let pending = joinHash ? joinHash[1].toUpperCase() : '';
      try { pending = pending || sessionStorage.getItem('tq_join') || ''; sessionStorage.removeItem('tq_join'); } catch { /* нет хранилища */ }
      if (pending) {
        try {
          const { workspace } = await api.post('/api/workspaces/join', { code: pending });
          toast(`Ты в пространстве «${workspace.name}»`);
          location.hash = `#/w/${workspace.id}`;
        } catch (e) {
          toast(e.message);
          location.hash = '#/';
        }
        return;
      }
    }
    if (hash === '#/login' || hash === '#/register') {
      location.hash = '#/';
      return;
    }
    if (hash === '#/profile') {
      try { return await viewProfile(); } catch (e) { return render(topbar([{ label: 'Ошибка' }]), h('div', { class: 'container' }, h('div', { class: 'card empty' }, e.message))); }
    }
    const [, kind, id, tab] = hash.match(/^#\/(?:(w|p)\/([\w-]+)(?:\/(\w+))?)?$/) || [];
    try {
      if (kind === 'w') await viewWorkspace(id, tab);
      else if (kind === 'p') await viewProject(id);
      else await viewHome();
      if (aiOpenStore.get() && !document.body.classList.contains('ai-open')) toggleDock(true);
    } catch (e) {
      if (!state.user) return;
      render(topbar([{ label: 'Ошибка' }]), h('div', { class: 'container' }, h('div', { class: 'card empty' }, e.message, h('div', { class: 'spacer' }), h('a', { class: 'btn', href: '#/' }, 'На главную'))));
    }
  }

  // ---------- инерционная прокрутка на публичных страницах ----------
  (function smoothScroll() {
    if (IN_PANEL || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !window.matchMedia('(pointer: fine)').matches) return;
    const root = document.documentElement;
    root.style.scrollBehavior = 'auto';
    let target = window.scrollY, cur = window.scrollY, raf = 0;
    const limit = () => Math.max(0, root.scrollHeight - window.innerHeight);
    const frame = () => {
      cur += (target - cur) * 0.085;
      if (Math.abs(target - cur) < 0.4) { cur = target; raf = 0; window.scrollTo(0, cur); return; }
      window.scrollTo(0, cur);
      raf = requestAnimationFrame(frame);
    };
    const scrollable = (el) => {
      for (; el && el !== document.body; el = el.parentElement) {
        const o = getComputedStyle(el).overflowY;
        if ((o === 'auto' || o === 'scroll') && el.scrollHeight > el.clientHeight + 1) return true;
      }
      return false;
    };
    window.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.defaultPrevented || Math.abs(e.deltaX) > Math.abs(e.deltaY) || scrollable(e.target)) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? window.innerHeight : 1;
      if (!raf) { cur = window.scrollY; target = cur; }
      target = Math.min(limit(), Math.max(0, target + e.deltaY * unit));
      if (!raf) raf = requestAnimationFrame(frame);
    }, { passive: false });
    // клавиши, якоря и перетаскивание ползунка двигают страницу сами: подхватываем позицию
    window.addEventListener('scroll', () => { if (!raf) { cur = window.scrollY; target = cur; } }, { passive: true });
  })();

  // ---------- свои выпадающие списки вместо системных ----------
  (function customSelects() {
    const valueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    const indexDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
    let pop = null;
    let popOwner = null;
    const closePop = () => {
      if (!pop) return;
      const el = pop;
      pop = null;
      if (popOwner) popOwner.btn.setAttribute('aria-expanded', 'false');
      popOwner = null;
      el.classList.add('out');
      setTimeout(() => el.remove(), 140);
      document.removeEventListener('pointerdown', onOutside, true);
      window.removeEventListener('resize', closePop);
      window.removeEventListener('scroll', onScroll, true);
    };
    const onOutside = (e) => { if (pop && !pop.contains(e.target) && !(popOwner && popOwner.btn.contains(e.target))) closePop(); };
    const onScroll = (e) => { if (pop && !pop.contains(e.target)) closePop(); };

    function enhance(select) {
      if (select.dataset.sel || select.multiple || select.hasAttribute('data-native')) return;
      select.dataset.sel = '1';
      const btn = h('button', { type: 'button', class: 'sel-btn', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' });
      const label = select.getAttribute('aria-label');
      if (label) btn.setAttribute('aria-label', label);
      const wrap = h('div', { class: 'sel' }, btn);
      select.before(wrap);
      select.classList.add('sel-native');
      select.tabIndex = -1;
      const owner = { btn, select };
      const paint = () => {
        const o = select.options[select.selectedIndex];
        btn.textContent = o ? o.textContent : '';
        btn.disabled = select.disabled;
        btn.classList.toggle('empty', !o || o.value === '');
      };
      // значения, выставленные из кода, тоже обновляют подпись
      Object.defineProperty(select, 'value', { configurable: true, get() { return valueDesc.get.call(this); }, set(v) { valueDesc.set.call(this, v); paint(); } });
      Object.defineProperty(select, 'selectedIndex', { configurable: true, get() { return indexDesc.get.call(this); }, set(v) { indexDesc.set.call(this, v); paint(); } });
      new MutationObserver(paint).observe(select, { childList: true, subtree: true, characterData: true, attributes: true });
      select.addEventListener('change', paint);
      paint();

      const choose = (i) => {
        if (i < 0 || i >= select.options.length || select.options[i].disabled) return;
        const changed = select.selectedIndex !== i;
        indexDesc.set.call(select, i);
        paint();
        closePop();
        btn.focus();
        if (changed) { select.dispatchEvent(new Event('input', { bubbles: true })); select.dispatchEvent(new Event('change', { bubbles: true })); }
      };
      const open = () => {
        if (pop && popOwner === owner) return closePop();
        closePop();
        const list = h('div', { class: 'sel-pop', role: 'listbox' });
        let active = Math.max(0, select.selectedIndex);
        const items = [...select.options].map((o, i) => {
          const it = h('div', { class: `sel-opt${i === select.selectedIndex ? ' on' : ''}${o.disabled ? ' dis' : ''}`, role: 'option', 'aria-selected': String(i === select.selectedIndex) }, h('span', null, o.textContent), h('i', { class: 'sel-ck', 'aria-hidden': 'true' }, '✓'));
          it.addEventListener('pointerdown', (e) => e.preventDefault());
          it.addEventListener('click', () => choose(i));
          it.addEventListener('pointermove', () => setActive(i, false));
          return it;
        });
        const setActive = (i, scroll = true) => {
          active = i;
          items.forEach((it, j) => it.classList.toggle('hot', j === i));
          if (scroll) items[i].scrollIntoView({ block: 'nearest' });
        };
        list.append(...items);
        document.body.append(list);
        const r = btn.getBoundingClientRect();
        list.style.minWidth = `${Math.max(r.width, 160)}px`;
        const ph = Math.min(list.scrollHeight, 288);
        const below = window.innerHeight - r.bottom - 12;
        const up = below < ph && r.top > below;
        list.style.maxHeight = `${Math.max(120, Math.min(288, up ? r.top - 12 : below))}px`;
        list.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - list.offsetWidth - 8))}px`;
        list.style.top = up ? `${Math.max(8, r.top - Math.min(ph, r.top - 12) - 6)}px` : `${r.bottom + 6}px`;
        list.style.transformOrigin = up ? 'bottom left' : 'top left';
        pop = list; popOwner = owner;
        btn.setAttribute('aria-expanded', 'true');
        setActive(active);
        document.addEventListener('pointerdown', onOutside, true);
        window.addEventListener('resize', closePop);
        window.addEventListener('scroll', onScroll, true);
        list.__move = (d) => setActive(Math.min(items.length - 1, Math.max(0, active + d)));
        list.__pick = () => choose(active);
      };
      btn.addEventListener('click', open);
      btn.addEventListener('keydown', (e) => {
        const isOpen = pop && popOwner === owner;
        if (e.key === 'Escape' && isOpen) { e.preventDefault(); e.stopPropagation(); closePop(); }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!isOpen) open(); else pop.__move(e.key === 'ArrowDown' ? 1 : -1); }
        else if ((e.key === 'Enter' || e.key === ' ') && isOpen) { e.preventDefault(); pop.__pick(); }
        else if (e.key === 'Tab' && isOpen) closePop();
      });
    }
    const scan = (root) => (root.nodeType === 1 ? [...(root.matches('select') ? [root] : []), ...root.querySelectorAll('select')] : []).forEach(enhance);
    new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach(scan))).observe(document.body, { childList: true, subtree: true });
    scan(document.body);
  })();

  window.addEventListener('hashchange', route);

  (async () => {
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem('tq_user') || 'null'); } catch { /* нет хранилища */ }
    const token = tokenStore.get();
    if (!token) { state.user = null; return route(); } // гость: ждать сеть незачем
    if (cached) {
      // уже входили: показываем сразу, а профиль сверяем фоном
      state.user = cached;
      route();
      maybeOfferTrial();
      api.get('/api/me').then(({ user }) => {
        const changed = JSON.stringify(user) !== JSON.stringify(state.user);
        state.user = user;
        saveUser();
        if (changed && !isTyping()) { quietRoute = true; route(); }
      }).catch(() => {});
      return;
    }
    try {
      state.user = (await api.get('/api/me')).user;
      saveUser();
    } catch {
      state.user = null;
    }
    route();
    maybeOfferTrial();
  })();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
})();
