// tasqly: клиент (без сборки, чистый js)
(() => {
  'use strict';

  const app = document.getElementById('app');
  const state = { user: null };

  const STATUS_TITLES = { todo: 'К выполнению', doing: 'В работе', done: 'Готово' };
  const STATUSES = ['todo', 'doing', 'done'];
  const PRIORITIES = ['Без приоритета', 'Низкий', 'Средний', 'Высокий'];

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
    for (const c of children.flat()) {
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

  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* пустой ответ */
    }
    if (res.status === 401 && state.user) {
      state.user = null;
      route();
    }
    if (!res.ok) throw new Error(data.error || `ошибка ${res.status}`);
    return data;
  }

  // методы-обёртки в стиле api.get(...)
  api.get = (p) => api('GET', p);
  api.post = (p, b = {}) => api('POST', p, b);
  api.patch = (p, b) => api('PATCH', p, b);
  api.del = (p) => api('DELETE', p, {});

  const initial = (name) => (name || '?').trim().charAt(0).toUpperCase();
  const avatar = (name) => h('span', { class: 'avatar', title: name }, initial(name));

  function formatDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }
  const todayIso = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const formatDateTime = (ts) =>
    new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  // ---------- каркас ----------

  function topbar(crumbs) {
    return h(
      'header',
      { class: 'topbar' },
      h('a', { class: 'logo', href: '#/' }, 'tasq', h('b', null, 'ly')),
      h(
        'nav',
        { class: 'crumbs' },
        crumbs.map((c, i) => [
          i === 0 ? null : h('span', null, '/'),
          c.href ? h('a', { href: c.href }, c.label) : h('span', { class: 'current' }, c.label),
        ]),
      ),
      state.user ? h('span', { class: 'chip' }, avatar(state.user.name), state.user.name) : null,
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
    state.user = null;
    location.hash = '#/';
    route();
  }

  // ---------- вход ----------

  function viewAuth() {
    let mode = 'login';
    const error = h('div', { class: 'error' });
    const form = h('form', { novalidate: true });
    const tabs = h('div', { class: 'tabs' });

    function paint() {
      tabs.replaceChildren(
        h('button', { type: 'button', class: mode === 'login' ? 'active' : '', onclick: () => ((mode = 'login'), paint()) }, 'Вход'),
        h('button', { type: 'button', class: mode === 'register' ? 'active' : '', onclick: () => ((mode = 'register'), paint()) }, 'Регистрация'),
      );
      form.replaceChildren(
        ...(mode === 'register' ? [h('label', null, 'Имя'), h('input', { type: 'text', name: 'name', autocomplete: 'name', maxlength: 60 })] : []),
        h('label', null, 'Email'),
        h('input', { type: 'email', name: 'email', autocomplete: 'email' }),
        h('label', null, 'Пароль'),
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
        h('div', { class: 'logo' }, 'tasq', h('b', null, 'ly')),
        h('div', { class: 'tag' }, 'Задачи и проекты для команд'),
        h('div', { class: 'card' }, tabs, form),
      ),
    );
  }

  // ---------- главная: пространства ----------

  async function viewHome() {
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
              workspaces.map((w) =>
                h('a', { class: 'tile', href: `#/w/${w.id}` }, h('div', { class: 'name' }, w.name), h('div', { class: 'meta' }, w.role === 'owner' ? 'Владелец' : 'Участник')),
              ),
            )
          : h('div', { class: 'card empty' }, 'Пока нет пространств. Создай первое ниже.'),
        h('div', { class: 'spacer' }),
        h(
          'div',
          { class: 'grid' },
          h('div', { class: 'card' }, h('h2', null, 'Новое пространство'), h('div', { class: 'row' }, nameInput, h('button', { class: 'btn', onclick: create }, 'Создать'))),
          h('div', { class: 'card' }, h('h2', null, 'Вступить по коду'), h('div', { class: 'row' }, codeInput, h('button', { class: 'btn', onclick: join }, 'Вступить'))),
        ),
      ),
    );
  }

  // ---------- пространство: проекты и участники ----------

  async function viewWorkspace(id) {
    const { workspace, members, projects } = await api.get(`/api/workspaces/${id}`);

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
                  h('div', { class: 'meta' }, `${p.done} из ${p.total} задач выполнено`),
                  h('div', { class: 'progress' }, h('span', { style: `width:${p.total ? Math.round((p.done / p.total) * 100) : 0}%` })),
                ),
              ),
            )
          : h('div', { class: 'card empty' }, 'Проектов пока нет'),
        h('div', { class: 'spacer' }),
        h('div', { class: 'card' }, h('div', { class: 'row' }, nameInput, h('button', { class: 'btn', onclick: create }, 'Добавить проект'))),
        h('div', { class: 'spacer' }),
        h('h2', null, 'Участники'),
        h('div', { class: 'people' }, members.map((m) => h('span', { class: 'chip' }, avatar(m.name), m.name))),
        h('div', { class: 'spacer' }),
        h(
          'div',
          { class: 'card' },
          h('h2', null, 'Пригласить в команду'),
          h('p', { class: 'sub', style: 'margin-bottom:12px' }, 'Отправь этот код — человек вводит его на главной странице'),
          h('div', { class: 'row' }, h('span', { class: 'invite' }, workspace.invite_code), h('button', { class: 'btn ghost small', onclick: copyCode }, 'Копировать')),
        ),
      ),
    );
  }

  // ---------- проект: канбан ----------

  async function viewProject(id) {
    const data = await api.get(`/api/projects/${id}`);
    const { project, members } = data;
    let tasks = data.tasks;
    const memberName = (uid) => (members.find((m) => m.id === uid) || {}).name;

    const board = h('div', { class: 'board' });

    function sortedColumn(status) {
      return tasks.filter((t) => t.status === status).sort((a, b) => a.position - b.position);
    }

    function card(t) {
      const late = t.due_date && t.status !== 'done' && t.due_date < todayIso();
      const el = h(
        'div',
        { class: `task ${t.status}`, draggable: 'true', 'data-id': t.id, onclick: () => openTask(t.id) },
        h('div', { class: 'title' }, t.title),
        h(
          'div',
          { class: 'meta' },
          t.priority ? h('span', { class: `prio p${t.priority}`, title: PRIORITIES[t.priority] }) : null,
          t.due_date ? h('span', { class: late ? 'late' : '' }, formatDate(t.due_date)) : null,
          t.comments ? h('span', null, `💬 ${t.comments}`) : null,
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

    function column(status) {
      const items = sortedColumn(status);
      const list = h('div', { class: 'list' }, items.map(card));
      const input = h('input', { type: 'text', placeholder: 'Новая задача', maxlength: 200 });
      const add = async () => {
        const title = input.value.trim();
        if (!title) return;
        input.value = '';
        try {
          const { task } = await api.post(`/api/projects/${id}/tasks`, { title, status });
          tasks.push(task);
          paint();
        } catch (e) {
          toast(e.message);
        }
      };
      input.addEventListener('keydown', (e) => e.key === 'Enter' && add());

      const col = h(
        'section',
        { class: 'column', 'data-status': status },
        h('h3', null, STATUS_TITLES[status], h('span', { class: 'count' }, items.length)),
        list,
        h('div', { class: 'add-task' }, input, h('button', { class: 'btn ghost small', onclick: add }, '+')),
      );

      col.addEventListener('dragover', (e) => {
        e.preventDefault();
        col.classList.add('over');
      });
      col.addEventListener('dragleave', (e) => {
        if (!col.contains(e.relatedTarget)) col.classList.remove('over');
      });
      col.addEventListener('drop', async (e) => {
        e.preventDefault();
        col.classList.remove('over');
        const taskId = e.dataTransfer.getData('text/plain');
        const task = tasks.find((x) => x.id === taskId);
        if (!task) return;

        // куда вставить: перед первой карточкой, которая ниже курсора
        const others = sortedColumn(status).filter((x) => x.id !== taskId);
        const cards = [...list.querySelectorAll('.task')].filter((c) => c.dataset.id !== taskId);
        let index = cards.findIndex((c) => {
          const r = c.getBoundingClientRect();
          return e.clientY < r.top + r.height / 2;
        });
        if (index === -1) index = others.length;
        const prev = others[index - 1];
        const next = others[index];
        const position = prev && next ? (prev.position + next.position) / 2 : prev ? prev.position + 1000 : next ? next.position - 1000 : 1000;

        const before = { status: task.status, position: task.position };
        task.status = status;
        task.position = position;
        paint();
        try {
          await api.patch(`/api/tasks/${taskId}`, { status, position });
        } catch (err) {
          Object.assign(task, before);
          paint();
          toast(err.message);
        }
      });
      return col;
    }

    function paint() {
      board.replaceChildren(...STATUSES.map(column));
    }

    // окно задачи
    async function openTask(taskId) {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      const title = h('input', { type: 'text', value: task.title, maxlength: 200 });
      const desc = h('textarea', { maxlength: 5000, placeholder: 'Описание' });
      desc.value = task.description || '';
      const status = h('select', null, STATUSES.map((s) => h('option', { value: s, selected: s === task.status }, STATUS_TITLES[s])));
      const priority = h('select', null, PRIORITIES.map((p, i) => h('option', { value: i, selected: i === task.priority }, p)));
      const assignee = h('select', null, h('option', { value: '' }, 'Не назначен'), members.map((m) => h('option', { value: m.id, selected: m.id === task.assignee_id }, m.name)));
      const due = h('input', { type: 'date', value: task.due_date || '' });

      const commentsBox = h('div', null, h('div', { class: 'sub' }, 'Загрузка…'));
      const commentInput = h('textarea', { placeholder: 'Написать комментарий', style: 'min-height:60px', maxlength: 2000 });

      const overlay = h('div', { class: 'overlay' });
      const close = () => {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
      };
      const onKey = (e) => e.key === 'Escape' && close();
      document.addEventListener('keydown', onKey);
      overlay.addEventListener('mousedown', (e) => e.target === overlay && close());

      const save = async () => {
        const patch = {
          title: title.value,
          description: desc.value,
          status: status.value,
          priority: Number(priority.value),
          assignee_id: assignee.value || null,
          due_date: due.value || null,
        };
        // при смене статуса через окно задача уходит в конец новой колонки
        if (patch.status !== task.status) {
          const last = Math.max(0, ...sortedColumn(patch.status).map((x) => x.position));
          patch.position = last + 1000;
        }
        try {
          const { task: updated } = await api.patch(`/api/tasks/${taskId}`, patch);
          Object.assign(task, updated);
          paint();
          close();
        } catch (e) {
          toast(e.message);
        }
      };

      const remove = async () => {
        if (!confirm('Удалить задачу?')) return;
        try {
          await api.del(`/api/tasks/${taskId}`);
          tasks = tasks.filter((t) => t.id !== taskId);
          paint();
          close();
        } catch (e) {
          toast(e.message);
        }
      };

      function paintComments(list) {
        commentsBox.replaceChildren(
          ...(list.length
            ? list.map((c) => h('div', { class: 'comment' }, h('div', { class: 'who' }, `${c.author || 'Удалённый пользователь'} · ${formatDateTime(c.created_at)}`), h('div', { class: 'text' }, c.body)))
            : [h('div', { class: 'sub' }, 'Комментариев пока нет')]),
        );
      }

      let comments = [];
      const sendComment = async () => {
        const text = commentInput.value.trim();
        if (!text) return;
        try {
          const { comment } = await api.post(`/api/tasks/${taskId}/comments`, { body: text });
          comments.push(comment);
          commentInput.value = '';
          task.comments = comments.length;
          paintComments(comments);
          paint();
        } catch (e) {
          toast(e.message);
        }
      };

      overlay.append(
        h(
          'div',
          { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
          h('div', { class: 'head' }, title, h('button', { class: 'btn ghost small', onclick: close, 'aria-label': 'Закрыть' }, '✕')),
          h('label', null, 'Описание'),
          desc,
          h('div', { class: 'two' }, h('div', null, h('label', null, 'Статус'), status), h('div', null, h('label', null, 'Приоритет'), priority)),
          h('div', { class: 'two' }, h('div', null, h('label', null, 'Исполнитель'), assignee), h('div', null, h('label', null, 'Дедлайн'), due)),
          h('div', { class: 'row', style: 'margin-top:18px;justify-content:space-between' }, h('button', { class: 'btn danger small', onclick: remove }, 'Удалить'), h('button', { class: 'btn', onclick: save }, 'Сохранить')),
          h('div', { class: 'comments' }, h('h2', null, 'Комментарии'), commentsBox, commentInput, h('div', { style: 'margin-top:8px;text-align:right' }, h('button', { class: 'btn ghost small', onclick: sendComment }, 'Отправить'))),
        ),
      );
      document.body.append(overlay);

      try {
        comments = (await api.get(`/api/tasks/${taskId}/comments`)).comments;
        paintComments(comments);
      } catch (e) {
        commentsBox.textContent = e.message;
      }
    }

    const del = async () => {
      if (!confirm(`Удалить проект «${project.name}» со всеми задачами?`)) return;
      try {
        await api.del(`/api/projects/${id}`);
        location.hash = `#/w/${project.workspace_id}`;
      } catch (e) {
        toast(e.message);
      }
    };

    paint();
    render(
      topbar([{ label: 'Пространства', href: '#/' }, { label: 'Пространство', href: `#/w/${project.workspace_id}` }, { label: project.name }]),
      board,
      project.role === 'owner' ? h('div', { class: 'container', style: 'padding-top:0;text-align:right' }, h('button', { class: 'btn danger small', onclick: del }, 'Удалить проект')) : null,
    );
  }

  // ---------- маршрутизация ----------

  async function route() {
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
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
})();
