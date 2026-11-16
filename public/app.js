// tasqly: клиент (без сборки, чистый js)
(() => {
  'use strict';

  const app = document.getElementById('app');
  const state = { user: null };
  let cleanup = null; // снимает обработчики текущего экрана при переходе

  const PRIORITIES = ['Без приоритета', 'Низкий', 'Средний', 'Высокий'];
  const LABEL_COLORS = ['#e5484d', '#f76b15', '#f5a524', '#30a46c', '#12a594', '#3e63dd', '#8e4ec6', '#d6409f'];
  const AVATAR_COLORS = ['#5b5bd6', '#30a46c', '#e5484d', '#f76b15', '#12a594', '#8e4ec6', '#d6409f', '#3e63dd'];

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

  function applyTheme(theme) {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }
  applyTheme(themeStore.get());

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
  const API_BASE = String(window.TASQLY_API || '').replace(/\/$/, '');

  async function api(method, path, body) {
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
    menu: '<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 5.5h14M3 10h14M3 14.5h14"/></svg>',
    mail: '<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="2.5" y="4.5" width="15" height="11" rx="2.5"/><path d="m3.5 6 6.5 5 6.5-5" stroke-linecap="round"/></svg>',
    home: '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3.5 9 10 3.5 16.5 9v7a1 1 0 0 1-1 1h-3.5v-5h-4v5H4.5a1 1 0 0 1-1-1z"/></svg>',
    folder: '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M2.5 6a1.5 1.5 0 0 1 1.5-1.5h3.2l1.6 1.8H16A1.5 1.5 0 0 1 17.5 7.8v6.7A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5z"/></svg>',
  };
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

  // ---------- левая панель ----------

  function openDrawer() {
    document.querySelectorAll('.drawer-wrap').forEach((d) => d.remove());
    const list = h('div', { class: 'drawer-list' }, h('div', { class: 'drawer-note' }, 'Загрузка…'));
    const close = () => {
      wrap.classList.remove('open');
      setTimeout(() => wrap.remove(), 220);
    };
    const go = (href) => () => {
      close();
      location.hash = href;
    };
    const wrap = h(
      'div',
      { class: 'overlay drawer-wrap' },
      h('div', { class: 'scrim', onclick: close }),
      h(
        'aside',
        { class: 'drawer', role: 'dialog', 'aria-label': 'Меню' },
        h('div', { class: 'drawer-head' }, h('a', { class: 'logo', href: '#/', onclick: close }, 'tasq', h('b', null, 'ly')), h('button', { class: 'icon-btn', 'aria-label': 'Закрыть меню', onclick: close }, '✕')),
        h('button', { class: 'drawer-item', onclick: go('#/') }, icon('home'), 'Главная'),
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
              h('div', { class: 'mail-text' }, h('div', { class: 'mail-top' }, h('b', null, c.author || 'Кто-то'), ' в «', c.title, '»'), h('div', { class: 'mail-sub' }, c.body)),
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
      '-',
      {
        label: `Тема: ${names[themeStore.get()]}`,
        onClick() {
          const next = order[(order.indexOf(themeStore.get()) + 1) % order.length];
          themeStore.set(next);
          applyTheme(next);
          toast(THEME_TEXT[next]);
        },
      },
      '-',
      { label: 'Выйти', danger: true, onClick: logout },
    ]);
    if (menuEl) menuEl.classList.add('right');
  }

  function topbar(crumbs) {
    const mail = state.user ? h('button', { class: 'icon-btn mail-btn', title: 'Входящие', 'aria-label': 'Входящие', onclick: (e) => openInbox(e.currentTarget) }, icon('mail')) : null;
    if (mail) loadBadge(mail);
    if (state.user) {
      if (state.timerLoaded) queueMicrotask(paintTimer);
      else refreshTimer();
    }
    const profile = state.user
      ? h('button', { class: 'profile-btn', title: state.user.name, 'aria-label': 'Профиль', onclick: (e) => openProfile(e.currentTarget) }, avatar(state.user.name))
      : null;
    return h(
      'header',
      { class: 'topbar' },
      state.user ? h('button', { class: 'icon-btn', title: 'Меню', 'aria-label': 'Открыть меню', onclick: openDrawer }, icon('menu')) : null,
      h('a', { class: 'logo', href: '#/' }, 'tasq', h('b', null, 'ly')),
      h('nav', { class: 'crumbs' }, crumbs.map((c) => [h('span', null, '/'), c.href ? h('a', { href: c.href }, c.label) : h('span', { class: 'current' }, c.label)])),
      h('div', { class: 'timer-slot' }),
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
    state.user = null;
    state.timer = null;
    state.timerLoaded = false;
    location.hash = '#/';
    route();
  }

  // ---------- вход ----------

  function viewAuth() {
    document.title = 'tasqly';
    let mode = 'login';
    const error = h('div', { class: 'error' });
    const form = h('form', { novalidate: true });
    const tabs = h('div', { class: 'seg' });

    function paint() {
      tabs.replaceChildren(
        h('button', { type: 'button', class: mode === 'login' ? 'active' : '', onclick: () => ((mode = 'login'), paint()) }, 'Вход'),
        h('button', { type: 'button', class: mode === 'register' ? 'active' : '', onclick: () => ((mode = 'register'), paint()) }, 'Регистрация'),
      );
      form.replaceChildren(
        ...(mode === 'register' ? [h('label', { class: 'field' }, 'Имя'), h('input', { type: 'text', name: 'name', autocomplete: 'name', maxlength: 60 })] : []),
        h('label', { class: 'field' }, 'Email'),
        h('input', { type: 'email', name: 'email', autocomplete: 'email' }),
        h('label', { class: 'field' }, 'Пароль'),
        h('input', { type: 'password', name: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password' }),
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
        route();
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
        h('a', { class: 'logo', href: '#/' }, 'tasq', h('b', null, 'ly')),
        h('div', { class: 'tag' }, 'Задачи и проекты для команд'),
        h('div', { class: 'card' }, tabs, form),
      ),
    );
  }

  // ---------- главная: пространства ----------

  async function viewHome() {
    document.title = 'tasqly';
    render(topbar([{ label: 'Пространства' }]), h('div', { class: 'container' }, h('div', { class: 'empty' }, 'Загрузка…')));
    const { workspaces } = await api.get('/api/workspaces');

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

    render(
      topbar([{ label: 'Пространства' }]),
      h(
        'div',
        { class: 'container' },
        h('h1', null, `Привет, ${state.user.name}`),
        h('p', { class: 'sub' }, 'Выбери пространство или создай новое для своей команды'),
        workspaces.length
          ? h(
              'div',
              { class: 'grid' },
              workspaces.map((w) => h('a', { class: 'tile', href: `#/w/${w.id}` }, h('div', { class: 'name' }, w.name), h('div', { class: 'meta' }, w.role === 'owner' ? 'Владелец' : 'Участник'))),
            )
          : h('div', { class: 'card empty' }, 'Пока нет пространств. Создай первое ниже.'),
        h('div', { class: 'spacer' }),
        h(
          'div',
          { class: 'grid' },
          h('div', { class: 'card' }, h('h2', null, 'Новое пространство'), h('div', { class: 'row' }, nameInput, h('button', { class: 'btn', onclick: create }, 'Создать'))),
          h('div', { class: 'card' }, h('h2', null, 'Вступить по коду'), h('div', { class: 'row' }, codeInput, h('button', { class: 'btn ghost', onclick: join }, 'Вступить'))),
        ),
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
    const data = await api.get(`/api/workspaces/${id}`);
    const { workspace } = data;
    document.title = `${workspace.name} · tasqly`;
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
        h('p', { class: 'sub', style: 'margin-bottom:12px' }, 'Отправь этот код: человек вводит его на главной странице'),
        h('div', { class: 'row' }, h('span', { class: 'invite' }, workspace.invite_code), h('button', { class: 'btn ghost small', onclick: copyCode }, 'Копировать')),
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

    api
      .get(`/api/workspaces/${id}/notes`)
      .then((r) => {
        notes = r.notes;
        paintList();
        paintEditor();
      })
      .catch((e) => toast(e.message));

    return h('div', { class: 'notes' }, h('aside', { class: 'notes-side' }, h('button', { class: 'btn', onclick: addNote }, '+ Новая заметка'), listEl), editor);
  }

  // ---------- отчёт по времени ----------

  function panelTime(id) {
    const box = h('div', null, h('div', { class: 'empty' }, 'Загрузка…'));
    let days = 30;
    const bars = (rows, total) =>
      rows.length
        ? rows.map((r) => h('div', { class: 'bar-row' }, h('div', { class: 'bar-label' }, r.name), h('div', { class: 'bar' }, h('span', { style: `width:${total ? Math.max(3, Math.round((r.seconds / total) * 100)) : 0}%` })), h('div', { class: 'bar-val' }, fmtDur(r.seconds))))
        : [h('div', { class: 'drawer-note' }, 'Пока нет записей')];

    async function load() {
      try {
        const r = await api.get(`/api/workspaces/${id}/time?days=${days}`);
        const periods = h('div', { class: 'seg' }, [7, 30, 90].map((d) => h('button', { class: d === days ? 'active' : '', onclick: () => ((days = d), load()) }, `${d} дн.`)));
        box.replaceChildren(
          h('div', { class: 'time-head' }, h('div', null, h('div', { class: 'big' }, fmtDur(r.total_sec)), h('div', { class: 'sub', style: 'margin:0' }, `всего за ${days} дн.`)), periods),
          h('div', { class: 'time-cols' }, h('div', { class: 'card' }, h('h2', null, 'По людям'), bars(r.by_user, r.total_sec)), h('div', { class: 'card' }, h('h2', null, 'По проектам'), bars(r.by_project, r.total_sec))),
          h('h2', { style: 'margin-top:22px' }, 'Последние записи'),
          r.recent.length
            ? h('div', { class: 'card flush' }, r.recent.map((e) => h('a', { class: 'time-row', href: `#/p/${e.project_id}` }, h('span', { class: 'grow' }, h('b', null, e.task_title), e.note ? h('span', { class: 'mail-sub' }, ` · ${e.note}`) : null), h('span', { class: 'mail-sub' }, e.author), h('span', { class: 'mail-sub' }, fmtDateTime(e.started_at)), h('span', { class: 'dur' }, fmtDur(e.seconds)))))
            : h('div', { class: 'card empty' }, 'Включи таймер в окне задачи или добавь время вручную: здесь появится отчёт.'),
        );
      } catch (e) {
        box.replaceChildren(h('div', { class: 'card empty' }, e.message));
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
        const r = await api.get(`/api/workspaces/${id}/messages${last ? `?after=${last}` : ''}`);
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

  function panelAI(id, { projects }) {
    const history = [];
    let projectId = '';
    const list = h('div', { class: 'chat-list' });
    const note = h('div', { class: 'ai-left' });
    const todayStr = () => isoOf(new Date());

    const bubble = (role, content) => {
      const el = h('div', { class: `msg${role === 'user' ? ' mine' : ''}` }, role === 'user' ? null : h('span', { class: 'avatar ai-avatar' }, 'AI'), h('div', { class: 'bubble' }, h('div', { class: 'text' }, content)));
      list.append(el);
      list.scrollTop = list.scrollHeight;
      return el;
    };
    const hello = () =>
      list.replaceChildren(h('div', { class: 'ai-hello' }, h('b', null, 'AI tasqly'), h('span', null, 'Спроси про проекты и задачи пространства: итоги, что горит, план на день. Могу превратить текст в задачи и разбить задачу на подзадачи в её окне.')));
    hello();

    let busy = false;
    async function ask(text) {
      text = text.trim();
      if (!text || busy) return;
      busy = true;
      if (list.querySelector('.ai-hello')) list.replaceChildren();
      bubble('user', text);
      const wait = bubble('assistant', 'Думаю…');
      wait.classList.add('pending');
      try {
        const r = await api.post(`/api/workspaces/${id}/ai/chat`, { message: text, today: todayStr(), history, project_id: projectId || undefined });
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

    const projSel = h('select', { 'aria-label': 'Проект', onchange: () => (projectId = projSel.value) }, h('option', { value: '' }, 'Все проекты'), projects.map((p) => h('option', { value: p.id }, p.name)));
    const chips = [
      ['Итоги по проекту', 'Сделай краткие итоги: что сделано, что в работе, что отстаёт.'],
      ['Что горит', 'Какие задачи просрочены или горят в ближайшие дни? Перечисли с исполнителями.'],
      ['План на сегодня', 'Составь для меня план на сегодня по приоритетам и срокам.'],
      ['Кто перегружен', 'Как распределена нагрузка между участниками? Есть ли перекосы?'],
    ];
    const input = h('textarea', { rows: 1, placeholder: 'Спроси про задачи (Enter отправляет)', maxlength: 1500, 'aria-label': 'Запрос к AI' });
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
      h(
        'div',
        { class: 'ai-main' },
        h('div', { class: 'ai-bar' }, h('span', { class: 'mail-sub' }, 'Контекст:'), projSel, h('span', { class: 'grow' }), note),
        h('div', { class: 'chat' }, list, h('div', { class: 'chips' }, chips.map(([label, q]) => h('button', { class: 'chip-btn', onclick: () => ask(q) }, label))), h('div', { class: 'chat-input' }, input, h('button', { class: 'btn', onclick: send }, 'Спросить'))),
      ),
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
        const r = await api.get(`/api/workspaces/${id}/files`);
        files = r.files;
        info = r;
        paint();
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
    const S = await api.get(`/api/projects/${id}`);
    document.title = `${S.project.name} · tasqly`;

    const F = { q: '', assignee: '', label: '', priority: '', late: false };
    let view = ['board', 'list', 'calendar'].includes(viewStore.get()) ? viewStore.get() : 'board';
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
        const { task: upd } = await api.patch(`/api/tasks/${task.id}`, patch);
        Object.assign(task, upd);
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

    function paint() {
      if (view === 'list') paintList();
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
          const { task: upd } = await api.patch(`/api/tasks/${task.id}`, patch);
          Object.assign(task, upd);
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
      const commentInput = h('textarea', { placeholder: 'Написать комментарий', style: 'min-height:60px', maxlength: 2000 });
      let comments = [];
      const paintComments = () =>
        commentsBox.replaceChildren(
          ...(comments.length
            ? comments.map((c) => h('div', { class: 'comment' }, h('div', { class: 'who' }, `${c.author || 'Удалённый пользователь'} · ${formatDateTime(c.created_at)}`), h('div', { class: 'text' }, c.body)))
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
        overlay.remove();
      };
      overlay.addEventListener('tq-close', close);
      overlay.addEventListener('mousedown', (e) => e.target === overlay && close());

      const remove = async () => {
        if (!confirm('Удалить задачу?')) return;
        try {
          await api.del(`/api/tasks/${task.id}`);
          S.tasks = S.tasks.filter((t) => t.id !== task.id);
          paint();
          overlay.remove();
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
          kind !== 'basic' ? h('div', { class: 'two' }, kind === 'it' ? h('div', null, h('label', { class: 'field' }, 'Тип задачи'), typeSel) : h('div'), h('div', null, h('label', { class: 'field' }, 'Оценка, часов'), estimate)) : null,
          h('div', { class: 'section' }, h('label', { class: 'field', style: 'margin-top:0' }, 'Время'), timeBox),
          h('div', { class: 'section' }, h('label', { class: 'field', style: 'margin-top:0' }, 'Метки'), labelBox, h('div', { class: 'new-label' }, newName, swatches, h('button', { class: 'btn ghost small', onclick: createLabel }, 'Добавить'))),
          h('div', { class: 'section' }, h('label', { class: 'field', style: 'margin-top:0' }, 'Подзадачи'), checkBox, h('div', { style: 'margin-top:8px' }, aiBtn), aiBox),
          saved,
          h('div', { class: 'comments' }, h('h2', null, 'Комментарии'), commentsBox, commentInput, h('div', { class: 'modal-actions' }, h('button', { class: 'btn danger small', onclick: remove }, 'Удалить задачу'), h('button', { class: 'btn small', onclick: sendComment }, 'Отправить'))),
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

    render(
      topbar([{ label: 'Пространства', href: '#/' }, { label: 'Пространство', href: `#/w/${S.project.workspace_id}` }, { label: S.project.name }]),
      h('div', { class: 'project-head' }, titleEl, more, h('span', { class: 'grow' }), viewTabs),
      h('div', { class: 'toolbar' }, search, assigneeFilter, labelFilter, prioFilter, lateToggle, resetBtn),
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

  async function route() {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
    closeMenu();
    closeInbox();
    document.querySelectorAll('.overlay').forEach((o) => o.remove());
    if (!state.user) return viewAuth();
    const hash = location.hash || '#/';
    const [, kind, id, tab] = hash.match(/^#\/(?:(w|p)\/([\w-]+)(?:\/(\w+))?)?$/) || [];
    try {
      if (kind === 'w') await viewWorkspace(id, tab);
      else if (kind === 'p') await viewProject(id);
      else await viewHome();
    } catch (e) {
      if (!state.user) return;
      render(topbar([{ label: 'Ошибка' }]), h('div', { class: 'container' }, h('div', { class: 'card empty' }, e.message, h('div', { class: 'spacer' }), h('a', { class: 'btn', href: '#/' }, 'На главную'))));
    }
  }

  window.addEventListener('hashchange', route);

  (async () => {
    try {
      state.user = (await api.get('/api/me')).user;
    } catch {
      state.user = null;
    }
    route();
  })();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
})();
