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

  const THEME_ICON = { auto: '◐', light: '☀', dark: '☾' };
  const THEME_TEXT = { auto: 'Тема: как в системе', light: 'Тема: светлая', dark: 'Тема: тёмная' };

  function themeButton() {
    const btn = h('button', { class: 'icon-btn', title: 'Сменить тему', 'aria-label': 'Сменить тему' }, THEME_ICON[themeStore.get()]);
    btn.addEventListener('click', () => {
      const order = ['auto', 'light', 'dark'];
      const next = order[(order.indexOf(themeStore.get()) + 1) % order.length];
      themeStore.set(next);
      applyTheme(next);
      btn.textContent = THEME_ICON[next];
      toast(THEME_TEXT[next]);
    });
    return btn;
  }

  function topbar(crumbs) {
    return h(
      'header',
      { class: 'topbar' },
      h('a', { class: 'logo', href: '#/' }, 'tasq', h('b', null, 'ly')),
      h(
        'nav',
        { class: 'crumbs' },
        crumbs.map((c) => [h('span', null, '/'), c.href ? h('a', { href: c.href }, c.label) : h('span', { class: 'current' }, c.label)]),
      ),
      themeButton(),
      state.user ? h('span', { class: 'me' }, avatar(state.user.name), h('span', { class: 'name-text' }, state.user.name)) : null,
      state.user ? h('button', { class: 'btn ghost small', onclick: logout }, 'Выйти') : null,
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

  async function viewWorkspace(id) {
    const { workspace, members, projects } = await api.get(`/api/workspaces/${id}`);
    document.title = `${workspace.name} · tasqly`;

    const nameInput = h('input', { type: 'text', placeholder: 'Название проекта', maxlength: 80 });
    const create = async () => {
      if (!nameInput.value.trim()) return;
      try {
        const { project } = await api.post(`/api/workspaces/${id}/projects`, { name: nameInput.value });
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

    render(
      topbar([{ label: 'Пространства', href: '#/' }, { label: workspace.name }]),
      h(
        'div',
        { class: 'container' },
        h('h1', null, workspace.name),
        h('p', { class: 'sub' }, 'Проекты и участники пространства'),
        h('h2', null, 'Проекты'),
        projects.length
          ? h(
              'div',
              { class: 'grid' },
              projects.map((p) =>
                h(
                  'a',
                  { class: 'tile', href: `#/p/${p.id}` },
                  h('div', { class: 'name' }, p.name),
                  h('div', { class: 'meta' }, p.total ? `${p.done} из ${p.total} задач выполнено` : 'Задач пока нет'),
                  h('div', { class: 'progress' }, h('span', { style: `width:${p.total ? Math.round((p.done / p.total) * 100) : 0}%` })),
                ),
              ),
            )
          : h('div', { class: 'card empty' }, 'Проектов пока нет'),
        h('div', { class: 'spacer' }),
        h('div', { class: 'row' }, nameInput, h('button', { class: 'btn', onclick: create }, 'Добавить проект')),
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
      ),
    );
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
        t.label_ids.length ? h('div', { class: 'pills' }, t.label_ids.map(labelPill)) : null,
        h('div', { class: 'title' }, t.title),
        h(
          'div',
          { class: 'meta' },
          prioIcon(t.priority),
          t.due_date ? h('span', { class: isLate(t) ? 'late' : '' }, formatDate(t.due_date)) : null,
          t.check_total ? h('span', { class: t.check_done === t.check_total ? 'ok' : '' }, `☑ ${t.check_done}/${t.check_total}`) : null,
          t.comments ? h('span', null, `💬 ${t.comments}`) : null,
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
          h('div', { class: 'section' }, h('label', { class: 'field', style: 'margin-top:0' }, 'Метки'), labelBox, h('div', { class: 'new-label' }, newName, swatches, h('button', { class: 'btn ghost small', onclick: createLabel }, 'Добавить'))),
          h('div', { class: 'section' }, h('label', { class: 'field', style: 'margin-top:0' }, 'Подзадачи'), checkBox),
          saved,
          h('div', { class: 'comments' }, h('h2', null, 'Комментарии'), commentsBox, commentInput, h('div', { class: 'modal-actions' }, h('button', { class: 'btn danger small', onclick: remove }, 'Удалить задачу'), h('button', { class: 'btn small', onclick: sendComment }, 'Отправить'))),
        ),
      );
      document.body.append(overlay);

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
    document.querySelectorAll('.overlay').forEach((o) => o.remove());
    if (!state.user) return viewAuth();
    const hash = location.hash || '#/';
    const [, kind, id] = hash.match(/^#\/(?:(w|p)\/([\w-]+))?$/) || [];
    try {
      if (kind === 'w') await viewWorkspace(id);
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
