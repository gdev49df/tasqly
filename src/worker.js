// tasqly api: cloudflare worker + d1
// статика (public/) отдаётся через assets, сюда приходят только запросы /api/*

const enc = new TextEncoder();
const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 100000; // максимум, который разрешает workers

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new HttpError(status, message);
};

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });

// ---------- утилиты ----------

const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));
const now = () => Date.now();
const newId = () => crypto.randomUUID();

function randomHex(bytes) {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256(text) {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))));
}

async function hashPassword(password, saltHex) {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  );
  return { hash: toHex(new Uint8Array(bits)), salt: toHex(salt) };
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function inviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

function cleanString(value, name, { min = 1, max = 200, allowEmpty = false } = {}) {
  if (typeof value !== 'string') fail(400, `поле «${name}» должно быть строкой`);
  const v = value.trim();
  if (allowEmpty && v === '') return v;
  if (v.length < min) fail(400, `поле «${name}» слишком короткое`);
  if (v.length > max) fail(400, `поле «${name}» слишком длинное (макс. ${max})`);
  return v;
}

function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function sessionCookie(token, maxAgeSeconds) {
  return `tq_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

// ---------- доступ ----------

// токен сессии: заголовок Authorization: Bearer ... (для клиента на другом домене) или cookie (тот же домен)
function getToken(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return parseCookies(req.headers.get('cookie')).tq_session || '';
}

async function currentUser(req, env) {
  const token = getToken(req);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256(token), now())
    .first();
  return row || null;
}

async function createSession(env, userId) {
  const token = randomHex(32);
  const maxAge = SESSION_DAYS * 24 * 3600;
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), userId, now() + maxAge * 1000)
    .run();
  return { token, cookie: sessionCookie(token, maxAge) };
}

async function requireMember(env, workspaceId, userId) {
  const row = await env.DB.prepare('SELECT role FROM members WHERE workspace_id = ? AND user_id = ?')
    .bind(workspaceId, userId)
    .first();
  if (!row) fail(404, 'пространство не найдено');
  return row.role;
}

async function projectContext(env, projectId, userId) {
  const project = await env.DB.prepare(
    `SELECT p.id, p.name, p.workspace_id, m.role FROM projects p
     JOIN members m ON m.workspace_id = p.workspace_id AND m.user_id = ?
     WHERE p.id = ?`,
  )
    .bind(userId, projectId)
    .first();
  if (!project) fail(404, 'проект не найден');
  return project;
}

async function taskContext(env, taskId, userId) {
  const task = await env.DB.prepare(
    `SELECT t.*, p.workspace_id FROM tasks t
     JOIN projects p ON p.id = t.project_id
     JOIN members m ON m.workspace_id = p.workspace_id AND m.user_id = ?
     WHERE t.id = ?`,
  )
    .bind(userId, taskId)
    .first();
  if (!task) fail(404, 'задача не найдена');
  return task;
}

async function columnContext(env, columnId, userId) {
  const col = await env.DB.prepare(
    `SELECT c.*, p.workspace_id FROM columns c
     JOIN projects p ON p.id = c.project_id
     JOIN members m ON m.workspace_id = p.workspace_id AND m.user_id = ?
     WHERE c.id = ?`,
  )
    .bind(userId, columnId)
    .first();
  if (!col) fail(404, 'колонка не найдена');
  return col;
}

async function checklistContext(env, itemId, userId) {
  const item = await env.DB.prepare(
    `SELECT i.* FROM checklist_items i
     JOIN tasks t ON t.id = i.task_id
     JOIN projects p ON p.id = t.project_id
     JOIN members m ON m.workspace_id = p.workspace_id AND m.user_id = ?
     WHERE i.id = ?`,
  )
    .bind(userId, itemId)
    .first();
  if (!item) fail(404, 'пункт не найден');
  return item;
}

async function labelContext(env, labelId, userId) {
  const label = await env.DB.prepare(
    `SELECT l.* FROM labels l
     JOIN members m ON m.workspace_id = l.workspace_id AND m.user_id = ?
     WHERE l.id = ?`,
  )
    .bind(userId, labelId)
    .first();
  if (!label) fail(404, 'метка не найдена');
  return label;
}

async function validateAssignee(env, workspaceId, assigneeId) {
  if (assigneeId === null || assigneeId === undefined || assigneeId === '') return null;
  if (typeof assigneeId !== 'string') fail(400, 'неверный исполнитель');
  const ok = await env.DB.prepare('SELECT 1 FROM members WHERE workspace_id = ? AND user_id = ?')
    .bind(workspaceId, assigneeId)
    .first();
  if (!ok) fail(400, 'исполнитель не состоит в пространстве');
  return assigneeId;
}

// колонка должна принадлежать этому же проекту
async function validateColumn(env, projectId, columnId) {
  if (typeof columnId !== 'string') fail(400, 'неверная колонка');
  const ok = await env.DB.prepare('SELECT 1 FROM columns WHERE id = ? AND project_id = ?').bind(columnId, projectId).first();
  if (!ok) fail(400, 'колонка не из этого проекта');
  return columnId;
}

function validateDueDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    fail(400, 'дедлайн должен быть датой в формате ГГГГ-ММ-ДД');
  }
  return value;
}

function validatePriority(value) {
  if (!Number.isInteger(value) || value < 0 || value > 3) fail(400, 'приоритет от 0 до 3');
  return value;
}

function validateColor(value) {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) fail(400, 'цвет в формате #rrggbb');
  return value.toLowerCase();
}

function validatePosition(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(400, 'неверная позиция');
  return value;
}

const DEFAULT_COLUMNS = [
  { name: 'К выполнению', is_done: 0 },
  { name: 'В работе', is_done: 0 },
  { name: 'Готово', is_done: 1 },
];

// общий запрос задачи: плюс счётчики и список меток
const TASK_SELECT = `SELECT t.id, t.project_id, t.column_id, t.title, t.description, t.priority, t.assignee_id, t.due_date,
    t.position, t.created_at, t.updated_at,
    (SELECT COUNT(*) FROM comments c WHERE c.task_id = t.id) AS comments,
    (SELECT COUNT(*) FROM checklist_items i WHERE i.task_id = t.id) AS check_total,
    (SELECT COUNT(*) FROM checklist_items i WHERE i.task_id = t.id AND i.done = 1) AS check_done,
    (SELECT group_concat(label_id) FROM task_labels tl WHERE tl.task_id = t.id) AS label_ids
  FROM tasks t`;

const shapeTask = (row) => ({ ...row, label_ids: row.label_ids ? row.label_ids.split(',') : [] });

async function loadTask(env, taskId) {
  const row = await env.DB.prepare(`${TASK_SELECT} WHERE t.id = ?`).bind(taskId).first();
  return shapeTask(row);
}

async function nextPosition(env, table, column, value) {
  const last = await env.DB.prepare(`SELECT MAX(position) AS p FROM ${table} WHERE ${column} = ?`).bind(value).first();
  return (last && last.p !== null ? last.p : 0) + 1000;
}

// ---------- маршруты ----------

const routes = [];
const route = (method, pattern, handler, { auth = true } = {}) => {
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
  routes.push({ method, re, handler, auth });
};

// авторизация

route(
  'POST',
  '/api/auth/register',
  async ({ env, body }) => {
    const email = cleanString(body.email, 'email', { max: 120 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'неверный email');
    const name = cleanString(body.name, 'имя', { max: 60 });
    const password = cleanString(body.password, 'пароль', { min: 8, max: 200 });

    const exists = await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
    if (exists) fail(409, 'этот email уже зарегистрирован');

    const { hash, salt } = await hashPassword(password);
    const id = newId();
    await env.DB.prepare(
      'INSERT INTO users (id, email, name, pass_hash, pass_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(id, email, name, hash, salt, now())
      .run();

    const { token, cookie } = await createSession(env, id);
    return json({ user: { id, email, name }, token }, 201, { 'set-cookie': cookie });
  },
  { auth: false },
);

route(
  'POST',
  '/api/auth/login',
  async ({ env, body }) => {
    const email = cleanString(body.email, 'email', { max: 120 }).toLowerCase();
    const password = cleanString(body.password, 'пароль', { min: 1, max: 200 });
    const user = await env.DB.prepare('SELECT id, email, name, pass_hash, pass_salt FROM users WHERE email = ?')
      .bind(email)
      .first();
    // хешируем в любом случае, чтобы время ответа не выдавало существование email
    const { hash } = await hashPassword(password, user ? user.pass_salt : '00'.repeat(16));
    if (!user || !safeEqual(hash, user.pass_hash)) fail(401, 'неверный email или пароль');

    const { token, cookie } = await createSession(env, user.id);
    return json({ user: { id: user.id, email: user.email, name: user.name }, token }, 200, { 'set-cookie': cookie });
  },
  { auth: false },
);

route(
  'POST',
  '/api/auth/logout',
  async ({ env, req }) => {
    const token = getToken(req);
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
  },
  { auth: false },
);

route('GET', '/api/me', async ({ user }) => json({ user }));

// пространства

route('GET', '/api/workspaces', async ({ env, user }) => {
  const { results } = await env.DB.prepare(
    `SELECT w.id, w.name, m.role FROM workspaces w
     JOIN members m ON m.workspace_id = w.id WHERE m.user_id = ? ORDER BY w.created_at`,
  )
    .bind(user.id)
    .all();
  return json({ workspaces: results });
});

route('POST', '/api/workspaces', async ({ env, user, body }) => {
  const name = cleanString(body.name, 'название', { max: 80 });
  const id = newId();
  const ts = now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO workspaces (id, name, invite_code, owner_id, created_at) VALUES (?, ?, ?, ?, ?)').bind(
      id,
      name,
      inviteCode(),
      user.id,
      ts,
    ),
    env.DB.prepare('INSERT INTO members (workspace_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').bind(
      id,
      user.id,
      'owner',
      ts,
    ),
  ]);
  return json({ workspace: { id, name, role: 'owner' } }, 201);
});

route('POST', '/api/workspaces/join', async ({ env, user, body }) => {
  const code = cleanString(body.code, 'код', { max: 20 }).toUpperCase();
  const ws = await env.DB.prepare('SELECT id, name FROM workspaces WHERE invite_code = ?').bind(code).first();
  if (!ws) fail(404, 'код приглашения не найден');
  await env.DB.prepare(
    'INSERT OR IGNORE INTO members (workspace_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)',
  )
    .bind(ws.id, user.id, 'member', now())
    .run();
  return json({ workspace: ws });
});

route('GET', '/api/workspaces/:id', async ({ env, user, params }) => {
  const role = await requireMember(env, params.id, user.id);
  const ws = await env.DB.prepare('SELECT id, name, invite_code FROM workspaces WHERE id = ?').bind(params.id).first();
  const [members, projects, labels] = await Promise.all([
    env.DB.prepare(
      `SELECT u.id, u.name, u.email, m.role FROM members m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ? ORDER BY m.joined_at`,
    )
      .bind(params.id)
      .all(),
    env.DB.prepare(
      `SELECT p.id, p.name,
         (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS total,
         (SELECT COUNT(*) FROM tasks t JOIN columns c ON c.id = t.column_id WHERE t.project_id = p.id AND c.is_done = 1) AS done
       FROM projects p WHERE p.workspace_id = ? ORDER BY p.created_at`,
    )
      .bind(params.id)
      .all(),
    env.DB.prepare('SELECT id, name, color FROM labels WHERE workspace_id = ? ORDER BY created_at').bind(params.id).all(),
  ]);
  return json({ workspace: { ...ws, role }, members: members.results, projects: projects.results, labels: labels.results });
});

route('POST', '/api/workspaces/:id/projects', async ({ env, user, params, body }) => {
  await requireMember(env, params.id, user.id);
  const name = cleanString(body.name, 'название', { max: 80 });
  const id = newId();
  const ts = now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO projects (id, workspace_id, name, created_at) VALUES (?, ?, ?, ?)').bind(id, params.id, name, ts),
    ...DEFAULT_COLUMNS.map((c, i) =>
      env.DB.prepare('INSERT INTO columns (id, project_id, name, position, is_done, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
        newId(),
        id,
        c.name,
        (i + 1) * 1000,
        c.is_done,
        ts,
      ),
    ),
  ]);
  return json({ project: { id, name, total: 0, done: 0 } }, 201);
});

// метки пространства

route('POST', '/api/workspaces/:id/labels', async ({ env, user, params, body }) => {
  await requireMember(env, params.id, user.id);
  const name = cleanString(body.name, 'название метки', { max: 30 });
  const color = validateColor(body.color);
  // lower() в sqlite не знает кириллицу, поэтому сравниваем в js
  const existing = await env.DB.prepare('SELECT name FROM labels WHERE workspace_id = ?').bind(params.id).all();
  if (existing.results.some((l) => l.name.toLowerCase() === name.toLowerCase())) fail(409, 'такая метка уже есть');
  const id = newId();
  await env.DB.prepare('INSERT INTO labels (id, workspace_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, params.id, name, color, now())
    .run();
  return json({ label: { id, name, color } }, 201);
});

route('DELETE', '/api/labels/:id', async ({ env, user, params }) => {
  await labelContext(env, params.id, user.id);
  await env.DB.prepare('DELETE FROM labels WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
});

// проекты

route('GET', '/api/projects/:id', async ({ env, user, params }) => {
  const project = await projectContext(env, params.id, user.id);
  const [columns, tasks, members, labels] = await Promise.all([
    env.DB.prepare('SELECT id, name, position, is_done FROM columns WHERE project_id = ? ORDER BY position, created_at')
      .bind(params.id)
      .all(),
    env.DB.prepare(`${TASK_SELECT} WHERE t.project_id = ? ORDER BY t.position, t.created_at`).bind(params.id).all(),
    env.DB.prepare(
      `SELECT u.id, u.name FROM members m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ? ORDER BY m.joined_at`,
    )
      .bind(project.workspace_id)
      .all(),
    env.DB.prepare('SELECT id, name, color FROM labels WHERE workspace_id = ? ORDER BY created_at').bind(project.workspace_id).all(),
  ]);
  return json({
    project: { id: project.id, name: project.name, workspace_id: project.workspace_id, role: project.role },
    columns: columns.results.map((c) => ({ ...c, is_done: !!c.is_done })),
    tasks: tasks.results.map(shapeTask),
    members: members.results,
    labels: labels.results,
  });
});

route('PATCH', '/api/projects/:id', async ({ env, user, params, body }) => {
  await projectContext(env, params.id, user.id);
  const name = cleanString(body.name, 'название', { max: 80 });
  await env.DB.prepare('UPDATE projects SET name = ? WHERE id = ?').bind(name, params.id).run();
  return json({ project: { id: params.id, name } });
});

route('DELETE', '/api/projects/:id', async ({ env, user, params }) => {
  const project = await projectContext(env, params.id, user.id);
  if (project.role !== 'owner') fail(403, 'удалять проекты может только владелец');
  await env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
});

// колонки

route('POST', '/api/projects/:id/columns', async ({ env, user, params, body }) => {
  await projectContext(env, params.id, user.id);
  const name = cleanString(body.name, 'название', { max: 40 });
  const isDone = body.is_done ? 1 : 0;
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM columns WHERE project_id = ?').bind(params.id).first();
  if (count.n >= 12) fail(400, 'не больше 12 колонок в проекте');
  const id = newId();
  const position = await nextPosition(env, 'columns', 'project_id', params.id);
  await env.DB.prepare('INSERT INTO columns (id, project_id, name, position, is_done, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, params.id, name, position, isDone, now())
    .run();
  return json({ column: { id, name, position, is_done: !!isDone } }, 201);
});

route('PATCH', '/api/columns/:id', async ({ env, user, params, body }) => {
  await columnContext(env, params.id, user.id);
  const sets = [];
  const values = [];
  if (body.name !== undefined) {
    sets.push('name = ?');
    values.push(cleanString(body.name, 'название', { max: 40 }));
  }
  if (body.is_done !== undefined) {
    sets.push('is_done = ?');
    values.push(body.is_done ? 1 : 0);
  }
  if (body.position !== undefined) {
    sets.push('position = ?');
    values.push(validatePosition(body.position));
  }
  if (!sets.length) fail(400, 'нечего обновлять');
  await env.DB.prepare(`UPDATE columns SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values, params.id)
    .run();
  const col = await env.DB.prepare('SELECT id, name, position, is_done FROM columns WHERE id = ?').bind(params.id).first();
  return json({ column: { ...col, is_done: !!col.is_done } });
});

route('DELETE', '/api/columns/:id', async ({ env, user, params }) => {
  const col = await columnContext(env, params.id, user.id);
  const { results } = await env.DB.prepare('SELECT id FROM columns WHERE project_id = ? ORDER BY position, created_at')
    .bind(col.project_id)
    .all();
  if (results.length < 2) fail(400, 'нельзя удалить последнюю колонку');
  // задачи переезжают в соседнюю колонку (слева, а если её нет, то справа), в конец списка
  const idx = results.findIndex((c) => c.id === params.id);
  const target = (results[idx - 1] || results[idx + 1]).id;
  const offset = (await nextPosition(env, 'tasks', 'column_id', target)) - 1000;
  await env.DB.batch([
    env.DB.prepare('UPDATE tasks SET column_id = ?, position = position + ? WHERE column_id = ?').bind(target, offset, params.id),
    env.DB.prepare('DELETE FROM columns WHERE id = ?').bind(params.id),
  ]);
  return json({ ok: true, moved_to: target });
});

// задачи

route('POST', '/api/projects/:id/tasks', async ({ env, user, params, body }) => {
  const project = await projectContext(env, params.id, user.id);
  const title = cleanString(body.title, 'название', { max: 200 });
  let columnId = body.column_id;
  if (columnId === undefined) {
    const first = await env.DB.prepare('SELECT id FROM columns WHERE project_id = ? ORDER BY position LIMIT 1').bind(params.id).first();
    if (!first) fail(400, 'в проекте нет колонок');
    columnId = first.id;
  } else {
    await validateColumn(env, params.id, columnId);
  }
  const description =
    body.description === undefined ? '' : cleanString(body.description, 'описание', { max: 5000, allowEmpty: true });
  const priority = body.priority === undefined ? 0 : validatePriority(body.priority);
  const dueDate = validateDueDate(body.due_date);
  const assigneeId = await validateAssignee(env, project.workspace_id, body.assignee_id);

  const position = await nextPosition(env, 'tasks', 'column_id', columnId);
  const id = newId();
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO tasks (id, project_id, column_id, title, description, priority, assignee_id, due_date, position, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, params.id, columnId, title, description, priority, assigneeId, dueDate, position, user.id, ts, ts)
    .run();
  return json({ task: await loadTask(env, id) }, 201);
});

route('PATCH', '/api/tasks/:id', async ({ env, user, params, body }) => {
  const task = await taskContext(env, params.id, user.id);
  const sets = [];
  const values = [];
  const set = (col, val) => {
    sets.push(`${col} = ?`);
    values.push(val);
  };

  if (body.title !== undefined) set('title', cleanString(body.title, 'название', { max: 200 }));
  if (body.description !== undefined)
    set('description', cleanString(body.description, 'описание', { max: 5000, allowEmpty: true }));
  if (body.column_id !== undefined) set('column_id', await validateColumn(env, task.project_id, body.column_id));
  if (body.priority !== undefined) set('priority', validatePriority(body.priority));
  if (body.due_date !== undefined) set('due_date', validateDueDate(body.due_date));
  if (body.assignee_id !== undefined) set('assignee_id', await validateAssignee(env, task.workspace_id, body.assignee_id));
  if (body.position !== undefined) set('position', validatePosition(body.position));
  if (!sets.length) fail(400, 'нечего обновлять');

  set('updated_at', now());
  await env.DB.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values, params.id)
    .run();
  return json({ task: await loadTask(env, params.id) });
});

route('PUT', '/api/tasks/:id/labels', async ({ env, user, params, body }) => {
  const task = await taskContext(env, params.id, user.id);
  if (!Array.isArray(body.label_ids) || body.label_ids.length > 20) fail(400, 'label_ids должен быть массивом (до 20)');
  const ids = [...new Set(body.label_ids)];
  for (const id of ids) {
    if (typeof id !== 'string') fail(400, 'неверная метка');
    const ok = await env.DB.prepare('SELECT 1 FROM labels WHERE id = ? AND workspace_id = ?').bind(id, task.workspace_id).first();
    if (!ok) fail(400, 'метка не из этого пространства');
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM task_labels WHERE task_id = ?').bind(params.id),
    ...ids.map((id) => env.DB.prepare('INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)').bind(params.id, id)),
    env.DB.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').bind(now(), params.id),
  ]);
  return json({ task: await loadTask(env, params.id) });
});

route('DELETE', '/api/tasks/:id', async ({ env, user, params }) => {
  await taskContext(env, params.id, user.id);
  await env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
});

// подзадачи и чек-листы

route('GET', '/api/tasks/:id/checklist', async ({ env, user, params }) => {
  await taskContext(env, params.id, user.id);
  const { results } = await env.DB.prepare(
    'SELECT id, text, done, position FROM checklist_items WHERE task_id = ? ORDER BY position, created_at',
  )
    .bind(params.id)
    .all();
  return json({ items: results.map((i) => ({ ...i, done: !!i.done })) });
});

route('POST', '/api/tasks/:id/checklist', async ({ env, user, params, body }) => {
  await taskContext(env, params.id, user.id);
  const text = cleanString(body.text, 'пункт', { max: 200 });
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM checklist_items WHERE task_id = ?').bind(params.id).first();
  if (count.n >= 100) fail(400, 'не больше 100 пунктов в задаче');
  const id = newId();
  const position = await nextPosition(env, 'checklist_items', 'task_id', params.id);
  await env.DB.prepare('INSERT INTO checklist_items (id, task_id, text, done, position, created_at) VALUES (?, ?, ?, 0, ?, ?)')
    .bind(id, params.id, text, position, now())
    .run();
  return json({ item: { id, text, done: false, position } }, 201);
});

route('PATCH', '/api/checklist/:id', async ({ env, user, params, body }) => {
  await checklistContext(env, params.id, user.id);
  const sets = [];
  const values = [];
  if (body.text !== undefined) {
    sets.push('text = ?');
    values.push(cleanString(body.text, 'пункт', { max: 200 }));
  }
  if (body.done !== undefined) {
    sets.push('done = ?');
    values.push(body.done ? 1 : 0);
  }
  if (!sets.length) fail(400, 'нечего обновлять');
  await env.DB.prepare(`UPDATE checklist_items SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values, params.id)
    .run();
  const item = await env.DB.prepare('SELECT id, text, done, position FROM checklist_items WHERE id = ?').bind(params.id).first();
  return json({ item: { ...item, done: !!item.done } });
});

route('DELETE', '/api/checklist/:id', async ({ env, user, params }) => {
  await checklistContext(env, params.id, user.id);
  await env.DB.prepare('DELETE FROM checklist_items WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
});

// комментарии

route('GET', '/api/tasks/:id/comments', async ({ env, user, params }) => {
  await taskContext(env, params.id, user.id);
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.body, c.created_at, c.user_id, u.name AS author
     FROM comments c LEFT JOIN users u ON u.id = c.user_id
     WHERE c.task_id = ? ORDER BY c.created_at`,
  )
    .bind(params.id)
    .all();
  return json({ comments: results });
});

route('POST', '/api/tasks/:id/comments', async ({ env, user, params, body }) => {
  await taskContext(env, params.id, user.id);
  const text = cleanString(body.body, 'комментарий', { max: 2000 });
  const id = newId();
  const ts = now();
  await env.DB.prepare('INSERT INTO comments (id, task_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, params.id, user.id, text, ts)
    .run();
  return json({ comment: { id, body: text, created_at: ts, user_id: user.id, author: user.name } }, 201);
});

// ---------- вход ----------

const handle = async (req, env) => {
    try {
      const url = new URL(req.url);
      const method = req.method;

      let match = null;
      let pathMatched = false;
      for (const r of routes) {
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        pathMatched = true;
        if (r.method === method) {
          match = { r, params: m.groups || {} };
          break;
        }
      }
      if (!match) return json({ error: pathMatched ? 'метод не поддерживается' : 'не найдено' }, pathMatched ? 405 : 404);

      let body = {};
      if (method !== 'GET' && method !== 'HEAD') {
        // требуем json: простые формы с другого сайта не пройдут (доп. защита от csrf)
        const type = req.headers.get('content-type') || '';
        if (!type.includes('application/json')) fail(415, 'нужен content-type: application/json');
        const text = await req.text();
        if (text) {
          try {
            body = JSON.parse(text);
          } catch {
            fail(400, 'некорректный json');
          }
        }
        if (body === null || typeof body !== 'object' || Array.isArray(body)) fail(400, 'ожидался json-объект');
      }

      let user = null;
      if (match.r.auth) {
        user = await currentUser(req, env);
        if (!user) fail(401, 'нужно войти');
      }
      return await match.r.handler({ req, env, params: match.params, body, user });
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'внутренняя ошибка' }, 500);
    }
};

// ---------- cors ----------
// клиент может жить на другом домене (github pages): разрешаем только origin из ALLOWED_ORIGINS
function allowedOrigin(req, env) {
  const origin = req.headers.get('origin');
  if (!origin) return null;
  const list = (env.ALLOWED_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean);
  return list.includes(origin) ? origin : null;
}

function withCors(res, origin) {
  const out = new Response(res.body, res);
  out.headers.append('vary', 'Origin');
  if (origin) {
    out.headers.set('access-control-allow-origin', origin);
    out.headers.set('access-control-expose-headers', 'content-type');
  }
  return out;
}

export default {
  async fetch(req, env) {
    const origin = allowedOrigin(req, env);
    if (req.method === 'OPTIONS') {
      // предзапрос: отвечаем только разрешённым origin
      if (!origin) return new Response(null, { status: 403 });
      return withCors(
        new Response(null, {
          status: 204,
          headers: {
            'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
            'access-control-allow-headers': 'content-type, authorization',
            'access-control-max-age': '86400',
          },
        }),
        origin,
      );
    }
    return withCors(await handle(req, env), origin);
  },
};
