// сквозной тест api: запусти `npm run dev` (после `npm run db:local`), затем `npm test`
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:8787';

function client() {
  let cookie = '';
  return async (method, path, body, { headers = {} } = {}) => {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
}

const run = Date.now();
const alice = client();
const bob = client();
let passed = 0;
const ok = (name) => {
  passed++;
  console.log('  ✓', name);
};

// ---------- регистрация и вход ----------

let r = await alice('POST', '/api/auth/register', { email: `alice${run}@test.dev`, name: 'Alice', password: 'password123' });
assert.equal(r.status, 201);
ok('регистрация');

r = await alice('POST', '/api/auth/register', { email: `alice${run}@test.dev`, name: 'Alice', password: 'password123' });
assert.equal(r.status, 409);
r = await alice('POST', '/api/auth/register', { email: `x${run}@test.dev`, name: 'X', password: 'short' });
assert.equal(r.status, 400);
ok('повторный email и короткий пароль отклоняются');

r = await client()('GET', '/api/me');
assert.equal(r.status, 401);
r = await alice('GET', '/api/me');
assert.equal(r.status, 200);
assert.equal(r.data.user.name, 'Alice');
ok('сессия работает, без неё 401');

r = await client()('POST', '/api/auth/login', { email: `alice${run}@test.dev`, password: 'wrongpass1' });
assert.equal(r.status, 401);
ok('неверный пароль отклоняется');

// токен и cors (клиент на github pages)
const ORIGIN = 'https://gdev49df.github.io';
const loginRes = await fetch(BASE + '/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: ORIGIN },
  body: JSON.stringify({ email: `alice${run}@test.dev`, password: 'password123' }),
});
const loginData = await loginRes.json();
assert.equal(loginRes.headers.get('access-control-allow-origin'), ORIGIN);
assert.ok(loginData.token && loginData.token.length >= 32);
const viaBearer = await fetch(BASE + '/api/me', { headers: { authorization: `Bearer ${loginData.token}`, origin: ORIGIN } });
assert.equal(viaBearer.status, 200);
const badBearer = await fetch(BASE + '/api/me', { headers: { authorization: 'Bearer ' + 'a'.repeat(64) } });
assert.equal(badBearer.status, 401);
ok('логин отдаёт токен, авторизация по Authorization работает');

const pre = await fetch(BASE + '/api/workspaces', {
  method: 'OPTIONS',
  headers: { origin: ORIGIN, 'access-control-request-method': 'PUT', 'access-control-request-headers': 'content-type, authorization' },
});
assert.equal(pre.status, 204);
assert.match(pre.headers.get('access-control-allow-methods'), /PUT/);
const evilPre = await fetch(BASE + '/api/workspaces', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
assert.equal(evilPre.status, 403);
const evil = await fetch(BASE + '/api/me', { headers: { origin: 'https://evil.example', authorization: `Bearer ${loginData.token}` } });
assert.equal(evil.headers.get('access-control-allow-origin'), null);
ok('cors: предзапрос только для разрешённого origin');

const form = await fetch(BASE + '/api/workspaces', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
assert.equal(form.status, 415);
ok('запросы не в json отклоняются');

// ---------- пространство и проект ----------

r = await alice('POST', '/api/workspaces', { name: 'Студия' });
assert.equal(r.status, 201);
const wsId = r.data.workspace.id;
r = await alice('GET', `/api/workspaces/${wsId}`);
const code = r.data.workspace.invite_code;
ok('создание пространства');

r = await alice('POST', `/api/workspaces/${wsId}/projects`, { name: 'Сайт' });
assert.equal(r.status, 201);
const projId = r.data.project.id;
r = await alice('GET', `/api/projects/${projId}`);
assert.equal(r.data.columns.length, 3);
assert.deepEqual(r.data.columns.map((c) => c.is_done), [false, false, true]);
const [colTodo, colDoing, colDone] = r.data.columns;
ok('новый проект получает три колонки по умолчанию');

r = await alice('PATCH', `/api/projects/${projId}`, { name: 'Сайт v2' });
assert.equal(r.status, 200);
r = await alice('GET', `/api/projects/${projId}`);
assert.equal(r.data.project.name, 'Сайт v2');
ok('переименование проекта');

// посторонний
r = await bob('POST', '/api/auth/register', { email: `bob${run}@test.dev`, name: 'Bob', password: 'password123' });
const bobId = r.data.user.id;
assert.equal((await bob('GET', `/api/workspaces/${wsId}`)).status, 404);
assert.equal((await bob('GET', `/api/projects/${projId}`)).status, 404);
assert.equal((await bob('POST', `/api/projects/${projId}/columns`, { name: 'Взлом' })).status, 404);
assert.equal((await bob('PATCH', `/api/columns/${colTodo.id}`, { name: 'Взлом' })).status, 404);
ok('посторонний не видит и не меняет чужие данные');

assert.equal((await bob('POST', '/api/workspaces/join', { code: 'NOPE0000' })).status, 404);
assert.equal((await bob('POST', '/api/workspaces/join', { code: code.toLowerCase() })).status, 200);
assert.equal((await bob('GET', `/api/projects/${projId}`)).status, 200);
ok('вступление по коду');

// ---------- колонки ----------

r = await alice('POST', `/api/projects/${projId}/columns`, { name: 'Ревью' });
assert.equal(r.status, 201);
const colReview = r.data.column;
assert.ok(colReview.position > colDone.position);
r = await bob('PATCH', `/api/columns/${colReview.id}`, { name: 'Проверка', is_done: false });
assert.equal(r.data.column.name, 'Проверка');
r = await alice('PATCH', `/api/columns/${colReview.id}`, { position: 1500 });
assert.equal(r.data.column.position, 1500);
r = await alice('GET', `/api/projects/${projId}`);
assert.deepEqual(r.data.columns.map((c) => c.name), ['К выполнению', 'Проверка', 'В работе', 'Готово']);
ok('создание, переименование и перестановка колонок');

// ---------- задачи ----------

r = await alice('POST', `/api/projects/${projId}/tasks`, { title: 'Дизайн', priority: 2, due_date: '2026-12-01', assignee_id: bobId });
assert.equal(r.status, 201);
const t1 = r.data.task;
assert.equal(t1.column_id, colTodo.id, 'без column_id задача идёт в первую колонку');
r = await alice('POST', `/api/projects/${projId}/tasks`, { title: 'Вёрстка', column_id: colTodo.id });
const t2 = r.data.task;
assert.ok(t2.position > t1.position);
ok('создание задач, позиции растут');

for (const bad of [{ assignee_id: 'не-участник' }, { due_date: '12.01.2026' }, { column_id: 'чужая' }, { priority: 9 }]) {
  r = await alice('POST', `/api/projects/${projId}/tasks`, { title: 'Плохая', ...bad });
  assert.equal(r.status, 400, JSON.stringify(bad));
}
ok('валидация задач');

r = await bob('PATCH', `/api/tasks/${t1.id}`, { column_id: colDoing.id, position: 500 });
assert.equal(r.data.task.column_id, colDoing.id);
assert.equal((await client()('PATCH', `/api/tasks/${t1.id}`, { title: 'x' })).status, 401);
ok('перемещение задачи между колонками');

// колонка из другого проекта
r = await alice('POST', `/api/workspaces/${wsId}/projects`, { name: 'Другой' });
const otherProj = r.data.project.id;
const otherCols = (await alice('GET', `/api/projects/${otherProj}`)).data.columns;
r = await alice('PATCH', `/api/tasks/${t1.id}`, { column_id: otherCols[0].id });
assert.equal(r.status, 400);
ok('нельзя переместить задачу в колонку другого проекта');

// ---------- метки ----------

r = await alice('POST', `/api/workspaces/${wsId}/labels`, { name: 'баг', color: '#E5484D' });
assert.equal(r.status, 201);
assert.equal(r.data.label.color, '#e5484d');
const labelBug = r.data.label;
r = await alice('POST', `/api/workspaces/${wsId}/labels`, { name: 'Баг', color: '#e5484d' });
assert.equal(r.status, 409);
r = await alice('POST', `/api/workspaces/${wsId}/labels`, { name: 'фича', color: 'red' });
assert.equal(r.status, 400);
r = await alice('POST', `/api/workspaces/${wsId}/labels`, { name: 'фича', color: '#30a46c' });
const labelFeat = r.data.label;
ok('метки: создание, уникальность и проверка цвета');

r = await bob('PUT', `/api/tasks/${t1.id}/labels`, { label_ids: [labelBug.id, labelFeat.id] });
assert.equal(r.status, 200);
assert.deepEqual([...r.data.task.label_ids].sort(), [labelBug.id, labelFeat.id].sort());
r = await alice('PUT', `/api/tasks/${t1.id}/labels`, { label_ids: [labelFeat.id] });
assert.deepEqual(r.data.task.label_ids, [labelFeat.id]);
r = await alice('PUT', `/api/tasks/${t1.id}/labels`, { label_ids: ['чужая'] });
assert.equal(r.status, 400);
r = await alice('GET', `/api/projects/${projId}`);
assert.equal(r.data.labels.length, 2);
assert.deepEqual(r.data.tasks.find((t) => t.id === t1.id).label_ids, [labelFeat.id]);
ok('метки на задачах: замена набора, проверка принадлежности');

// ---------- чек-лист ----------

r = await alice('POST', `/api/tasks/${t1.id}/checklist`, { text: 'Макет' });
assert.equal(r.status, 201);
const i1 = r.data.item;
r = await bob('POST', `/api/tasks/${t1.id}/checklist`, { text: 'Правки' });
const i2 = r.data.item;
assert.ok(i2.position > i1.position);
r = await alice('PATCH', `/api/checklist/${i1.id}`, { done: true });
assert.equal(r.data.item.done, true);
r = await alice('GET', `/api/tasks/${t1.id}/checklist`);
assert.deepEqual(r.data.items.map((i) => [i.text, i.done]), [['Макет', true], ['Правки', false]]);
r = await alice('GET', `/api/projects/${projId}`);
const t1row = r.data.tasks.find((t) => t.id === t1.id);
assert.equal(t1row.check_total, 2);
assert.equal(t1row.check_done, 1);
assert.equal((await bob('PATCH', `/api/checklist/${i1.id}`, { text: 'Макет v2' })).data.item.text, 'Макет v2');
assert.equal((await alice('DELETE', `/api/checklist/${i2.id}`, {})).status, 200);
assert.equal((await client()('PATCH', `/api/checklist/${i1.id}`, { done: false })).status, 401);
ok('чек-лист: пункты, отметки, счётчики на задаче');

// ---------- комментарии ----------

r = await bob('POST', `/api/tasks/${t1.id}/comments`, { body: 'Беру в работу' });
assert.equal(r.status, 201);
r = await alice('GET', `/api/tasks/${t1.id}/comments`);
assert.equal(r.data.comments[0].author, 'Bob');
ok('комментарии');

r = await alice('POST', `/api/tasks/${t1.id}/comments`, { body: 'Проверь, @bob, пожалуйста' });
assert.equal(r.status, 201);
r = await bob('GET', '/api/inbox');
assert.ok(r.data.comments.some((c) => c.body.includes('@bob') && c.mentioned === 1));
r = await alice('GET', '/api/inbox');
assert.ok(!r.data.comments.some((c) => c.mentioned === 1));
ok('упоминания попадают во входящие');

// ---------- повторяющиеся задачи ----------
{
  const pr = await alice('GET', `/api/projects/${t1.project_id}`);
  const doneCol = pr.data.columns.find((c) => c.is_done);
  const firstCol = pr.data.columns[0];
  r = await alice('POST', `/api/projects/${t1.project_id}/tasks`, { title: 'Отчёт', due_date: '2026-01-31', repeat: 'monthly' });
  assert.equal(r.data.task.repeat, 'monthly');
  const rt = r.data.task;
  r = await alice('PATCH', `/api/tasks/${rt.id}`, { column_id: doneCol.id });
  assert.equal(r.data.task.repeat, 'none');
  assert.equal(r.data.spawned.title, 'Отчёт');
  assert.equal(r.data.spawned.due_date, '2026-02-28');
  assert.equal(r.data.spawned.repeat, 'monthly');
  assert.equal(r.data.spawned.column_id, firstCol.id);
  await alice('DELETE', `/api/tasks/${rt.id}`, {});
  await alice('DELETE', `/api/tasks/${r.data.spawned.id}`, {});
  ok('повторяющиеся задачи: закрытие создаёт следующую копию');
}

// ---------- история задачи ----------
{
  const pr = await alice('GET', `/api/projects/${t1.project_id}`);
  const hcol = pr.data.columns.find((c) => c.id !== t1.column_id);
  const ht = (await alice('POST', `/api/projects/${t1.project_id}/tasks`, { title: 'История' })).data.task;
  await alice('PATCH', `/api/tasks/${ht.id}`, { title: 'История 2', priority: 3, column_id: hcol.id });
  r = await bob('GET', `/api/tasks/${ht.id}/history`);
  assert.equal(r.status, 200);
  const kinds = r.data.events.map((e) => e.kind);
  for (const k of ['created', 'title', 'priority', 'column']) assert.ok(kinds.includes(k), `нет события ${k}`);
  const col = r.data.events.find((e) => e.kind === 'column');
  assert.equal(col.detail.to, hcol.name);
  assert.equal(col.author, 'Alice');
  assert.equal((await client()('GET', `/api/tasks/${ht.id}/history`)).status, 401);
  await alice('DELETE', `/api/tasks/${ht.id}`, {});
}
ok('история задачи: создание, переименование, приоритет и перенос записываются');

// ---------- удаление колонки, прогресс, каскады ----------

r = await alice('GET', `/api/workspaces/${wsId}`);
let proj = r.data.projects.find((p) => p.id === projId);
assert.equal(proj.total, 2);
assert.equal(proj.done, 0);
await alice('PATCH', `/api/tasks/${t2.id}`, { column_id: colDone.id });
r = await alice('GET', `/api/workspaces/${wsId}`);
proj = r.data.projects.find((p) => p.id === projId);
assert.equal(proj.done, 1);
assert.equal(r.data.labels.length, 2);
ok('прогресс проекта считается по колонкам «готово»');

// удаляем «В работе» (в ней t1): задача уезжает в соседнюю колонку слева («Проверка»)
r = await alice('DELETE', `/api/columns/${colDoing.id}`, {});
assert.equal(r.status, 200);
assert.equal(r.data.moved_to, colReview.id);
r = await alice('GET', `/api/projects/${projId}`);
assert.equal(r.data.columns.length, 3);
assert.equal(r.data.tasks.find((t) => t.id === t1.id).column_id, colReview.id);
ok('удаление колонки переносит задачи в соседнюю');

// последнюю колонку удалить нельзя
const single = (await alice('GET', `/api/projects/${otherProj}`)).data.columns;
await alice('DELETE', `/api/columns/${single[0].id}`, {});
await alice('DELETE', `/api/columns/${single[1].id}`, {});
r = await alice('DELETE', `/api/columns/${single[2].id}`, {});
assert.equal(r.status, 400);
ok('последнюю колонку удалить нельзя');

r = await bob('DELETE', `/api/projects/${projId}`, {});
assert.equal(r.status, 403);
r = await alice('DELETE', `/api/labels/${labelBug.id}`, {});
assert.equal(r.status, 200);
assert.equal((await alice('DELETE', `/api/tasks/${t2.id}`, {})).status, 200);
assert.equal((await alice('DELETE', `/api/projects/${projId}`, {})).status, 200);
assert.equal((await alice('GET', `/api/projects/${projId}`)).status, 404);
ok('удаление метки, задачи и проекта (с каскадом)');

// ---------- типы проектов ----------

r = await alice('POST', `/api/workspaces/${wsId}/projects`, { name: 'Разработка', kind: 'it' });
assert.equal(r.status, 201);
const itId = r.data.project.id;
r = await alice('GET', `/api/projects/${itId}`);
assert.equal(r.data.project.kind, 'it');
assert.equal(r.data.columns.length, 6);
assert.equal(r.data.columns.filter((c) => c.is_done).length, 1);
r = await alice('POST', `/api/workspaces/${wsId}/projects`, { name: 'Прод', kind: 'advanced' });
assert.equal((await alice('GET', `/api/projects/${r.data.project.id}`)).data.columns.length, 5);
r = await alice('POST', `/api/workspaces/${wsId}/projects`, { name: 'Плохой', kind: 'magic' });
assert.equal(r.status, 400);
ok('типы проектов: базовый, продвинутый, it');

r = await alice('POST', `/api/projects/${itId}/tasks`, { title: 'Падает логин', task_type: 'bug', estimate_min: 90 });
assert.equal(r.status, 201);
const bug = r.data.task;
assert.equal(bug.task_type, 'bug');
assert.equal(bug.estimate_min, 90);
r = await alice('PATCH', `/api/tasks/${bug.id}`, { task_type: 'nope' });
assert.equal(r.status, 400);
r = await alice('PATCH', `/api/tasks/${bug.id}`, { task_type: 'feature', estimate_min: null });
assert.equal(r.data.task.task_type, 'feature');
assert.equal(r.data.task.estimate_min, null);
ok('тип и оценка задачи');

// ---------- трекер времени ----------

r = await alice('POST', `/api/tasks/${bug.id}/timer/start`, {});
assert.equal(r.status, 201);
r = await alice('GET', '/api/timer');
assert.equal(r.data.entry.task_id, bug.id);
r = await alice('POST', `/api/tasks/${bug.id}/timer/start`, {});
assert.equal(r.status, 201);
await new Promise((res) => setTimeout(res, 1100));
r = await alice('POST', '/api/timer/stop', {});
assert.equal(r.data.stopped, 1);
assert.equal((await alice('GET', '/api/timer')).data.entry, null);
r = await alice('POST', `/api/tasks/${bug.id}/time`, { minutes: 30, note: 'разбор' });
assert.equal(r.status, 201);
const manual = r.data.entry;
assert.equal((await alice('POST', `/api/tasks/${bug.id}/time`, { minutes: 0 })).status, 400);
r = await alice('GET', `/api/tasks/${bug.id}/time`);
assert.equal(r.data.entries.length, 3);
assert.ok(r.data.total_sec >= 1800);
r = await alice('GET', `/api/projects/${itId}`);
assert.ok(r.data.tasks.find((t) => t.id === bug.id).tracked_sec >= 1800);
r = await alice('GET', `/api/workspaces/${wsId}/time`);
assert.ok(r.data.total_sec >= 1800);
assert.equal(r.data.by_user[0].name, 'Alice');
assert.ok(r.data.by_project.some((p) => p.id === itId));
assert.equal((await bob('DELETE', `/api/time/${manual.id}`, {})).status, 404);
assert.equal((await alice('DELETE', `/api/time/${manual.id}`, {})).status, 200);
ok('трекер времени: таймер, ручной ввод, отчёт');

// ---------- заметки ----------

r = await alice('POST', `/api/workspaces/${wsId}/notes`, { title: 'Идеи', body: 'первая строка' });
assert.equal(r.status, 201);
const note = r.data.note;
assert.equal((await bob('GET', `/api/notes/${note.id}`)).status, 200);
r = await bob('PATCH', `/api/notes/${note.id}`, { body: 'правка bob' });
assert.equal(r.status, 200);
r = await alice('GET', `/api/workspaces/${wsId}/notes`);
assert.equal(r.data.notes[0].title, 'Идеи');
assert.equal(r.data.notes[0].preview, 'правка bob');
const outsider = client();
await outsider('POST', '/api/auth/register', { email: `eve${run}@test.dev`, name: 'Eve', password: 'password123' });
assert.equal((await outsider('GET', `/api/notes/${note.id}`)).status, 404);
assert.equal((await outsider('GET', `/api/workspaces/${wsId}/notes`)).status, 404);
assert.equal((await alice('DELETE', `/api/notes/${note.id}`, {})).status, 200);
ok('заметки: общий доступ участников, чужим 404');

// ---------- чат ----------

r = await alice('POST', `/api/workspaces/${wsId}/messages`, { body: 'привет' });
assert.equal(r.status, 201);
const m1 = r.data.message;
r = await bob('POST', `/api/workspaces/${wsId}/messages`, { body: 'здорово' });
r = await alice('GET', `/api/workspaces/${wsId}/messages`);
assert.deepEqual(r.data.messages.map((m) => m.body), ['привет', 'здорово']);
r = await bob('GET', `/api/workspaces/${wsId}/messages?after=${m1.created_at}`);
assert.deepEqual(r.data.messages.map((m) => m.body), ['здорово']);
assert.equal((await outsider('GET', `/api/workspaces/${wsId}/messages`)).status, 404);
assert.equal((await alice('POST', `/api/workspaces/${wsId}/messages`, { body: '   ' })).status, 400);
ok('чат: отправка, новые сообщения, чужим 404');

// ---------- диск ----------

const payload = Buffer.from('hello tasqly файл').toString('base64');
r = await alice('POST', `/api/workspaces/${wsId}/files`, { name: 'a.txt', mime: 'text/plain', data: payload });
assert.equal(r.status, 201);
const file = r.data.file;
assert.equal(file.size, Buffer.from('hello tasqly файл').length);
assert.equal((await alice('POST', `/api/workspaces/${wsId}/files`, { name: 'x', data: '***' })).status, 400);
assert.equal((await alice('POST', `/api/workspaces/${wsId}/files`, { name: 'big', data: Buffer.alloc(1_100_000).toString('base64') })).status, 413);
r = await alice('GET', `/api/workspaces/${wsId}/files`);
assert.equal(r.data.files.length, 1);
assert.equal(r.data.used, file.size);
const dl = await fetch(`${BASE}/api/files/${file.id}/download`, { headers: { cookie: '' } });
assert.equal(dl.status, 401);
const tokenRes = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `alice${run}@test.dev`, password: 'password123' }) });
const { token } = await tokenRes.json();
const dl2 = await fetch(`${BASE}/api/files/${file.id}/download`, { headers: { authorization: `Bearer ${token}` } });
assert.equal(dl2.status, 200);
assert.equal(await dl2.text(), 'hello tasqly файл');
assert.match(dl2.headers.get('content-disposition'), /attachment/);
assert.equal((await outsider('GET', `/api/files/${file.id}/download`)).status, 404);
assert.equal((await bob('DELETE', `/api/files/${file.id}`, {})).status, 403);
assert.equal((await alice('DELETE', `/api/files/${file.id}`, {})).status, 200);
assert.equal((await alice('GET', `/api/workspaces/${wsId}/files`)).data.files.length, 0);
ok('диск: загрузка, скачивание, лимиты, права');

// ---------- ai (в тестах ai заменён заглушкой) ----------

r = await alice('POST', `/api/workspaces/${wsId}/ai/chat`, { message: 'что горит?', today: '2026-11-16' });
assert.equal(r.status, 200);
assert.match(r.data.reply, /что горит/);
assert.equal(typeof r.data.left, 'number');
r = await alice('POST', `/api/workspaces/${wsId}/ai/chat`, { message: 'итоги', project_id: itId, history: [{ role: 'user', content: 'привет' }, { role: 'system', content: 'взлом' }] });
assert.equal(r.status, 200);
assert.equal((await outsider('POST', `/api/workspaces/${wsId}/ai/chat`, { message: 'привет' })).status, 404);
assert.equal((await alice('POST', `/api/workspaces/${wsId}/ai/chat`, { message: '  ' })).status, 400);
r = await alice('POST', `/api/workspaces/${wsId}/ai/tasks`, { text: 'нужно сделать оплату и тексты' });
assert.equal(r.status, 200);
assert.equal(r.data.tasks.length, 2);
assert.equal(r.data.tasks[0].priority, 2);
assert.equal(r.data.tasks[1].due_date, null);
r = await alice('POST', `/api/tasks/${bug.id}/ai/subtasks`, {});
assert.equal(r.status, 200);
assert.deepEqual(r.data.items, ['Шаг 1', 'Шаг 2', 'Шаг 3']);
assert.equal((await outsider('POST', `/api/tasks/${bug.id}/ai/subtasks`, {})).status, 404);
r = await alice('POST', `/api/workspaces/${wsId}/ai/chat`, { message: 'напиши ```python print(1)```' });
assert.match(r.data.reply, /только с задачами и проектами/);
ok('ai: чат, задачи из текста, подзадачи, права, код в ответе блокируется');

// ---------- смена пароля ----------

r = await outsider('POST', '/api/auth/password', { old_password: 'wrong-pass', new_password: 'newpassword1' });
assert.equal(r.status, 403);
r = await outsider('POST', '/api/auth/password', { old_password: 'password123', new_password: 'short' });
assert.equal(r.status, 400);
r = await outsider('POST', '/api/auth/password', { old_password: 'password123', new_password: 'password123' });
assert.equal(r.status, 400);
const evePc = client();
await evePc('POST', '/api/auth/login', { email: `eve${run}@test.dev`, password: 'password123' });
assert.equal((await evePc('GET', '/api/me')).status, 200);
r = await outsider('POST', '/api/auth/password', { old_password: 'password123', new_password: 'newpassword1' });
assert.equal(r.status, 200);
assert.equal((await outsider('GET', '/api/me')).status, 200);
assert.equal((await evePc('GET', '/api/me')).status, 401);
assert.equal((await client()('POST', '/api/auth/login', { email: `eve${run}@test.dev`, password: 'password123' })).status, 401);
assert.equal((await client()('POST', '/api/auth/login', { email: `eve${run}@test.dev`, password: 'newpassword1' })).status, 200);
{
  const w = (await alice('POST', '/api/workspaces', { name: 'голос' })).data.workspace;
  r = await alice('POST', `/api/workspaces/${w.id}/ai/transcribe`, {});
  assert.equal(r.status, 400);
  r = await alice('POST', `/api/workspaces/${w.id}/ai/transcribe`, { audio: 'не base64!' });
  assert.equal(r.status, 400);
  r = await alice('POST', `/api/workspaces/${w.id}/ai/transcribe`, { audio: 'AAAA' });
  assert.equal(r.status, 200);
  assert.ok(r.data.text.length > 0);
  r = await bob('POST', `/api/workspaces/${w.id}/ai/transcribe`, { audio: 'AAAA' });
  assert.equal(r.status, 404);
}
ok('голос: расшифровка записи, проверки и права');
{
  const sp = (await alice('POST', '/api/workspaces', { name: 'поиск' })).data.workspace;
  const spr = (await alice('POST', `/api/workspaces/${sp.id}/projects`, { name: 'Сайт' })).data.project;
  const st = (await alice('POST', `/api/projects/${spr.id}/tasks`, { title: 'Дизайн главной' })).data.task;
  const scode = (await alice('GET', `/api/workspaces/${sp.id}`)).data.workspace.invite_code;
  await bob('POST', '/api/workspaces/join', { code: scode });
  r = await alice('GET', '/api/search?q=' + encodeURIComponent('дизайн'));
  assert.ok(r.data.tasks.some((t) => t.id === st.id), 'регистр не важен');
  r = await bob('GET', '/api/search?q=' + encodeURIComponent('ДИЗАЙН'));
  assert.ok(r.data.tasks.some((t) => t.id === st.id), 'участник видит задачи пространства');
  const out = client();
  await out('POST', '/api/auth/register', { email: `s${run}@test.dev`, name: 'Чужой', password: 'password123' });
  r = await out('GET', '/api/search?q=' + encodeURIComponent('Дизайн'));
  assert.equal(r.data.tasks.length, 0, 'чужой ничего не находит');
  r = await alice('GET', '/api/search?q=%25%25');
  assert.equal(r.data.tasks.length, 0, '% не работает как маска');
  r = await alice('GET', '/api/search?q=a');
  assert.equal(r.data.tasks.length, 0);
}
ok('поиск: находит своё, не показывает чужое, спецсимволы экранированы');
{
  const sp = (await alice('POST', '/api/workspaces', { name: 'публичный' })).data.workspace;
  const spr = (await alice('POST', `/api/workspaces/${sp.id}/projects`, { name: 'Для заказчика' })).data.project;
  await alice('POST', `/api/projects/${spr.id}/tasks`, { title: 'Секретная задача', description: 'приватное описание' });
  const code3 = (await alice('GET', `/api/workspaces/${sp.id}`)).data.workspace.invite_code;
  await bob('POST', '/api/workspaces/join', { code: code3 });
  assert.equal((await client()('GET', '/api/public/project/' + '0'.repeat(32))).status, 404);
  assert.equal((await bob('POST', `/api/projects/${spr.id}/share`, {})).status, 403, 'не владелец не делится');
  r = await alice('POST', `/api/projects/${spr.id}/share`, {});
  assert.equal(r.status, 200);
  const tok = r.data.share_token;
  assert.match(tok, /^[0-9a-f]{32}$/);
  assert.equal((await alice('POST', `/api/projects/${spr.id}/share`, {})).data.share_token, tok, 'ссылка не меняется при повторе');
  r = await client()('GET', `/api/public/project/${tok}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.tasks[0].title, 'Секретная задача');
  assert.ok(!JSON.stringify(r.data).includes('приватное описание'), 'описание не отдаётся');
  assert.ok(!JSON.stringify(r.data).includes('@test.dev'), 'email не отдаётся');
  assert.equal((await alice('GET', `/api/projects/${spr.id}`)).data.project.share_token, tok);
  assert.equal((await bob('GET', `/api/projects/${spr.id}`)).data.project.share_token, undefined, 'токен видит только владелец');
  await alice('DELETE', `/api/projects/${spr.id}/share`, {});
  assert.equal((await client()('GET', `/api/public/project/${tok}`)).status, 404, 'после выключения ссылка мертва');
}
ok('публичная ссылка: только просмотр, без лишних данных, выключается');
{
  const dw = (await alice('POST', '/api/workspaces', { name: 'на удаление' })).data.workspace;
  const dcode = (await alice('GET', `/api/workspaces/${dw.id}`)).data.workspace.invite_code;
  await bob('POST', '/api/workspaces/join', { code: dcode });
  assert.equal((await bob('DELETE', `/api/workspaces/${dw.id}`, {})).status, 403, 'участник не удаляет');
  assert.equal((await alice('DELETE', `/api/workspaces/${dw.id}`, {})).status, 200);
  assert.equal((await alice('GET', `/api/workspaces/${dw.id}`)).status, 404);
}
ok('удаление пространства: только владелец');
{
  const rw = (await alice('POST', '/api/workspaces', { name: 'роли' })).data.workspace;
  const rp = (await alice('POST', `/api/workspaces/${rw.id}/projects`, { name: 'П' })).data.project;
  const rcode = (await alice('GET', `/api/workspaces/${rw.id}`)).data.workspace.invite_code;
  const carol = client();
  const cr = await carol('POST', '/api/auth/register', { email: `carol${run}@test.dev`, name: 'Carol', password: 'password123' });
  await bob('POST', '/api/workspaces/join', { code: rcode });
  await carol('POST', '/api/workspaces/join', { code: rcode });
  const bobId = (await bob('GET', '/api/me')).data.user.id;
  const carolId = cr.data.user.id;
  // наблюдатель
  r = await alice('PATCH', `/api/workspaces/${rw.id}/members/${bobId}`, { level: 'viewer' });
  assert.equal(r.status, 200);
  r = await bob('POST', `/api/projects/${rp.id}/tasks`, { title: 'нельзя' });
  assert.equal(r.status, 403);
  assert.match(r.data.error, /Наблюдатель/);
  assert.equal((await bob('GET', `/api/projects/${rp.id}`)).status, 200, 'наблюдатель видит проект');
  const task = (await alice('POST', `/api/projects/${rp.id}/tasks`, { title: 'Задача' })).data.task;
  assert.equal((await bob('POST', `/api/tasks/${task.id}/comments`, { body: 'вижу' })).status, 201, 'наблюдатель комментирует');
  assert.equal((await bob('PATCH', `/api/tasks/${task.id}`, { title: 'взлом' })).status, 403);
  assert.equal((await bob('POST', `/api/workspaces/${rw.id}/messages`, { body: 'привет' })).status, 201, 'наблюдатель пишет в чат');
  // свои роли
  r = await alice('POST', `/api/workspaces/${rw.id}/roles`, { name: 'Дизайнер', color: '#d6409f', level: 'member' });
  assert.equal(r.status, 201);
  const roleId = r.data.role.id;
  assert.equal((await bob('POST', `/api/workspaces/${rw.id}/roles`, { name: 'x', color: '#d6409f' })).status, 403);
  await alice('PATCH', `/api/workspaces/${rw.id}/members/${bobId}`, { role_id: roleId });
  r = await bob('GET', `/api/workspaces/${rw.id}`);
  const bm = r.data.members.find((m) => m.id === bobId);
  assert.equal(bm.role_name, 'Дизайнер');
  assert.equal(bm.role, 'member');
  assert.equal((await bob('POST', `/api/projects/${rp.id}/tasks`, { title: 'теперь можно' })).status, 201);
  // администратор
  await alice('PATCH', `/api/workspaces/${rw.id}/members/${bobId}`, { level: 'admin' });
  assert.equal((await bob('PATCH', `/api/workspaces/${rw.id}/members/${carolId}`, { level: 'admin' })).status, 403, 'админ не назначает админов');
  assert.equal((await bob('PATCH', `/api/workspaces/${rw.id}/members/${carolId}`, { level: 'viewer' })).status, 200);
  assert.equal((await bob('DELETE', `/api/workspaces/${rw.id}`, {})).status, 403, 'админ не удаляет пространство');
  assert.equal((await bob('DELETE', `/api/workspaces/${rw.id}/members/${carolId}`, {})).status, 200, 'админ убирает участника');
  assert.equal((await alice('DELETE', `/api/workspaces/${rw.id}/members/${(await alice('GET', '/api/me')).data.user.id}`, {})).status, 403, 'владелец не выходит');
  assert.equal((await alice('DELETE', `/api/roles/${roleId}`, {})).status, 200);
  r = await alice('GET', `/api/workspaces/${rw.id}`);
  assert.equal(r.data.members.find((m) => m.id === bobId).role_name, 'Администратор');
}
ok('роли: наблюдатель, свои роли, администратор, выход и удаление участников');
{
  const fc = client();
  const mail = `reset${run}@test.dev`;
  await fc('POST', '/api/auth/register', { email: mail, name: 'Забыла', password: 'password123' });
  r = await client()('POST', '/api/auth/forgot', { email: `nobody${run}@test.dev` });
  assert.equal(r.status, 200);
  assert.equal(r.data.debug_token, undefined, 'для несуществующего email ничего не раскрывается');
  r = await client()('POST', '/api/auth/forgot', { email: mail });
  const tok = r.data.debug_token;
  assert.match(tok, /^[0-9a-f]{64}$/);
  assert.equal((await client()('POST', '/api/auth/forgot', { email: mail })).data.debug_token, undefined, 'частые запросы не создают новый токен');
  assert.equal((await client()('POST', '/api/auth/reset', { token: 'x'.repeat(64), password: 'newpassword1' })).status, 400);
  assert.equal((await client()('POST', '/api/auth/reset', { token: tok, password: 'short' })).status, 400);
  assert.equal((await client()('POST', '/api/auth/reset', { token: tok, password: 'newpassword1' })).status, 200);
  assert.equal((await client()('POST', '/api/auth/reset', { token: tok, password: 'another-pass1' })).status, 400, 'токен одноразовый');
  assert.equal((await fc('GET', '/api/me')).status, 401, 'старые сессии завершены');
  assert.equal((await client()('POST', '/api/auth/login', { email: mail, password: 'password123' })).status, 401);
  assert.equal((await client()('POST', '/api/auth/login', { email: mail, password: 'newpassword1' })).status, 200);
}
ok('сброс пароля: письмо, одноразовая ссылка, новый пароль, старые сессии закрыты');
ok('смена пароля: проверка старого, новый работает, другие сессии завершены');

// лимиты на количество объектов
r = await alice('GET', '/api/limits');
assert.equal(r.status, 200);
assert.ok(r.data.limits.notes_per_workspace > 0 && r.data.limits.ai_per_day > 0);
{
  const lw = (await alice('POST', '/api/workspaces', { name: 'лимиты' })).data.workspace;
  const lim = r.data.limits.projects_per_workspace;
  for (let i = 0; i < lim; i++) assert.equal((await alice('POST', `/api/workspaces/${lw.id}/projects`, { name: `п${i}` })).status, 201);
  r = await alice('POST', `/api/workspaces/${lw.id}/projects`, { name: 'лишний' });
  assert.equal(r.status, 429);
  assert.match(r.data.error, /не больше/);
}
ok('лимиты: проекты упираются в потолок, ответ 429 с понятным текстом');

{
  const c = client();
  const t = await c('POST', '/api/auth/register', { email: `trial${run}@test.dev`, name: 'триал', password: 'password123' });
  assert.equal(t.status, 201);
  assert.equal(t.data.user.plan, 'start');
  assert.equal(t.data.user.trial_ends_at, null);
  assert.equal(t.data.user.effective_plan, 'start');
  const on = await c('POST', '/api/me/trial', {});
  assert.equal(on.status, 200);
  const days = (on.data.user.trial_ends_at - Date.now()) / 86400000;
  assert.ok(days > 4.9 && days <= 5, `ожидали 5 дней, получили ${days}`);
  assert.equal(on.data.user.effective_plan, 'team');
  assert.equal((await c('POST', '/api/me/trial', {})).status, 409);
}
ok('пробный период: включается кнопкой, один раз, даёт тариф «Команда»');

{
  // на «Старте» в пространстве максимум 3 участника
  const lw = (await alice('POST', '/api/workspaces', { name: 'тариф' })).data.workspace;
  const code2 = (await alice('GET', `/api/workspaces/${lw.id}`)).data.workspace.invite_code;
  const joined = [];
  for (let i = 0; i < 3; i++) {
    const c = client();
    await c('POST', '/api/auth/register', { email: `m${i}-${run}@test.dev`, name: `М${i}`, password: 'password123' });
    joined.push((await c('POST', '/api/workspaces/join', { code: code2 })).status);
  }
  assert.deepEqual(joined, [200, 200, 403]);
}
ok('тариф «Старт»: в пространстве не больше 3 участников');


// ---------- подтверждение почты, экспорт, удаление, журнал, статус ----------

{
  const c = client();
  const reg = await c('POST', '/api/auth/register', { email: `ver${run}@test.dev`, name: 'Вера', password: 'password123' });
  assert.equal(reg.data.user.email_verified, false);
  assert.ok(reg.data.debug_verify_token, 'в тестовом режиме токен подтверждения возвращается');
  assert.equal((await c('POST', '/api/auth/verify', { token: 'f'.repeat(64) })).status, 400);
  assert.equal((await c('POST', '/api/me/verify/send', {})).status, 429, 'письмо не чаще раза в минуту');
  assert.equal((await client()('POST', '/api/auth/verify', { token: reg.data.debug_verify_token })).status, 200);
  assert.equal((await c('GET', '/api/me')).data.user.email_verified, true);
  assert.equal((await client()('POST', '/api/auth/verify', { token: reg.data.debug_verify_token })).status, 200, 'повторное открытие ссылки не ломается');
  assert.equal((await c('POST', '/api/me/verify/send', {})).status, 409, 'уже подтверждена');
}
ok('подтверждение почты: ссылка работает повторно, письмо не чаще раза в минуту');

{
  const owner = client();
  await owner('POST', '/api/auth/register', { email: `own${run}@test.dev`, name: 'Олег', password: 'password123' });
  const w = (await owner('POST', '/api/workspaces', { name: 'журнал' })).data.workspace;
  const p = (await owner('POST', `/api/workspaces/${w.id}/projects`, { name: 'Проект А' })).data.project;
  await owner('PATCH', `/api/projects/${p.id}`, { name: 'Проект Б' });
  await owner('POST', `/api/projects/${p.id}/share`, {});
  await owner('DELETE', `/api/projects/${p.id}/share`, {});
  const p2 = (await owner('POST', `/api/workspaces/${w.id}/projects`, { name: 'Лишний' })).data.project;
  await owner('DELETE', `/api/projects/${p2.id}`, {});
  const code = (await owner('GET', `/api/workspaces/${w.id}`)).data.workspace.invite_code;
  const guest = client();
  const g = await guest('POST', '/api/auth/register', { email: `gst${run}@test.dev`, name: 'Гость', password: 'password123' });
  await guest('POST', '/api/workspaces/join', { code });
  assert.equal((await guest('GET', `/api/workspaces/${w.id}/audit`)).status, 403, 'журнал только для владельца и администратора');
  await owner('PATCH', `/api/workspaces/${w.id}/members/${g.data.user.id}`, { level: 'viewer' });
  await owner('DELETE', `/api/workspaces/${w.id}/members/${g.data.user.id}`, {});
  const log = await owner('GET', `/api/workspaces/${w.id}/audit`);
  assert.equal(log.status, 200);
  const kinds = log.data.events.map((e) => e.kind);
  for (const k of ['project_created', 'project_renamed', 'share_on', 'share_off', 'project_deleted', 'member_joined', 'member_role', 'member_removed']) assert.ok(kinds.includes(k), `в журнале нет ${k}`);
  assert.equal(log.data.events.find((e) => e.kind === 'project_deleted').detail.name, 'Лишний');
  assert.equal(log.data.events[0].user_name, 'Олег');

  // экспорт
  const ex = await owner('GET', '/api/me/export');
  assert.equal(ex.status, 200);
  assert.equal(ex.data.user.email, `own${run}@test.dev`);
  assert.ok(ex.data.workspaces.some((x) => x.id === w.id) && ex.data.projects.some((x) => x.id === p.id));
  assert.ok(!JSON.stringify(ex.data).includes('pass_hash'));

  // удаление аккаунта: нужен email и пароль; пространство с участниками не удаляется молча
  const g2 = client();
  await g2('POST', '/api/auth/register', { email: `gs2${run}@test.dev`, name: 'Гость2', password: 'password123' });
  await g2('POST', '/api/workspaces/join', { code });
  assert.equal((await owner('POST', '/api/me/delete', { email: 'other@test.dev', password: 'password123' })).status, 400);
  assert.equal((await owner('POST', '/api/me/delete', { email: `own${run}@test.dev`, password: 'wrongpass' })).status, 403);
  assert.equal((await owner('POST', '/api/me/delete', { email: `own${run}@test.dev`, password: 'password123' })).status, 409);
  await owner('DELETE', `/api/workspaces/${w.id}`, {});
  assert.equal((await owner('POST', '/api/me/delete', { email: `own${run}@test.dev`, password: 'password123' })).status, 200);
  assert.equal((await owner('GET', '/api/me')).status, 401);
  assert.equal((await client()('POST', '/api/auth/login', { email: `own${run}@test.dev`, password: 'password123' })).status, 401);
}
ok('журнал действий, экспорт данных и удаление аккаунта');

{
  const st = await client()('GET', '/api/status');
  assert.equal(st.status, 200);
  assert.equal(st.data.ok, true);
  assert.ok(typeof st.data.db_ms === 'number');
  const cfg = await client()('GET', '/api/config');
  assert.equal(cfg.data.google, false);
  assert.equal((await fetch(BASE + '/api/auth/google/start', { redirect: 'manual' })).status, 404, 'без ключей Google вход выключен');
}
ok('статус сервиса и конфиг: Google выключен без ключей');

// ---------- письма-уведомления, шаблоны, импорт ----------

const outbox = async (clear) => (await fetch(BASE + '/api/debug/outbox' + (clear ? '?clear=1' : ''))).json();
{
  await outbox(true);
  const boss = client();
  const bobN = client();
  const reg1 = await boss('POST', '/api/auth/register', { email: `boss${run}@test.dev`, name: 'Босс', password: 'password123' });
  const reg2 = await bobN('POST', '/api/auth/register', { email: `exec${run}@test.dev`, name: 'Исполнитель', password: 'password123' });
  const wsN = (await boss('POST', '/api/workspaces', { name: 'письма' })).data.workspace;
  await bobN('POST', '/api/workspaces/join', { code: (await boss('GET', `/api/workspaces/${wsN.id}`)).data.workspace.invite_code });
  const pN = (await boss('POST', `/api/workspaces/${wsN.id}/projects`, { name: 'П' })).data.project;
  const execId = reg2.data.user.id;

  // почта не подтверждена: письма нет
  let t = (await boss('POST', `/api/projects/${pN.id}/tasks`, { title: 'Первая', assignee_id: execId })).data.task;
  assert.equal((await outbox()).box.length, 0, 'без подтверждённой почты письма нет');

  await client()('POST', '/api/auth/verify', { token: reg2.data.debug_verify_token });
  t = (await boss('POST', `/api/projects/${pN.id}/tasks`, { title: 'Вторая', assignee_id: execId })).data.task;
  let box = (await outbox(true)).box;
  assert.equal(box.length, 1);
  assert.equal(box[0].to, `exec${run}@test.dev`);
  assert.ok(box[0].subject.includes('Вторая'));

  // назначил сам себе — тишина; перевёл на исполнителя — письмо
  const t3 = (await boss('POST', `/api/projects/${pN.id}/tasks`, { title: 'Третья' })).data.task;
  await boss('PATCH', `/api/tasks/${t3.id}`, { assignee_id: reg1.data.user.id });
  assert.equal((await outbox()).box.length, 0);
  await boss('PATCH', `/api/tasks/${t3.id}`, { assignee_id: execId });
  assert.equal((await outbox(true)).box.length, 1);

  // упоминание
  await boss('POST', `/api/tasks/${t.id}/comments`, { body: 'смотри, @Исполнитель, срочно' });
  box = (await outbox(true)).box;
  assert.equal(box.length, 1);
  assert.ok(box[0].subject.includes('упомянули'));

  // выключатель в профиле
  let n = await bobN('PATCH', '/api/me/notify', { assigned: false, mentioned: false });
  assert.equal(n.status, 200);
  assert.deepEqual(n.data.notify, { assigned: false, mentioned: false, due: true });
  assert.equal((await bobN('PATCH', '/api/me/notify', { assigned: 'нет' })).status, 400);
  assert.equal((await bobN('GET', '/api/me')).data.user.notify.assigned, false);
  await boss('POST', `/api/projects/${pN.id}/tasks`, { title: 'Четвёртая', assignee_id: execId });
  await boss('POST', `/api/tasks/${t.id}/comments`, { body: '@Исполнитель ещё раз' });
  assert.equal((await outbox()).box.length, 0, 'выключено — писем нет');

  // дайджест: срок завтра (по Астане), второй запуск не дублирует
  const tom = new Date(Date.now() + 5 * 3600_000 + 86400000).toISOString().slice(0, 10);
  await boss('PATCH', `/api/tasks/${t.id}`, { due_date: tom });
  await outbox(true);
  await fetch(BASE + '/cdn-cgi/handler/scheduled?cron=0+3+*+*+*');
  await new Promise((s) => setTimeout(s, 800));
  box = (await outbox(true)).box;
  assert.equal(box.length, 1, 'дайджест: одно письмо');
  assert.ok(box[0].html.includes('Вторая'));
  await fetch(BASE + '/cdn-cgi/handler/scheduled?cron=0+3+*+*+*');
  await new Promise((s) => setTimeout(s, 800));
  assert.equal((await outbox()).box.length, 0, 'повторно ту же задачу не напоминаем');
}
ok('письма: назначение, упоминание, дайджест по сроку, выключатели в профиле');

{
  const c = client();
  await c('POST', '/api/auth/register', { email: `tpl${run}@test.dev`, name: 'Шаблон', password: 'password123' });
  const w = (await c('POST', '/api/workspaces', { name: 'шаблоны' })).data.workspace;
  const list = await client()('GET', '/api/templates');
  assert.ok(list.data.templates.length >= 3);
  assert.equal((await c('POST', `/api/workspaces/${w.id}/projects`, { name: 'Х', template: 'нет-такого' })).status, 400);
  const made = await c('POST', `/api/workspaces/${w.id}/projects`, { name: 'Сайт клиента', template: 'site' });
  assert.equal(made.status, 201);
  const board = (await c('GET', `/api/projects/${made.data.project.id}`)).data;
  assert.equal(board.columns.length, 4);
  assert.ok(board.tasks.length >= 5);
  assert.ok(board.columns[3].is_done);
}
ok('шаблоны проектов: колонки и стартовые задачи создаются');

{
  const c = client();
  await c('POST', '/api/auth/register', { email: `imp${run}@test.dev`, name: 'Импорт', password: 'password123' });
  const w = (await c('POST', '/api/workspaces', { name: 'импорт' })).data.workspace;
  const payload = {
    name: 'Из Trello',
    columns: [{ name: 'К работе' }, { name: 'Сделано', done: true }],
    tasks: [
      { title: 'Карточка 1', column: 0, description: 'текст', labels: [{ name: 'срочно', color: '#ff0000' }], checklist: [{ text: 'пункт', done: true }, { text: 'второй' }], due_date: '2026-12-05', priority: 3 },
      { title: 'Карточка 2', column: 1, labels: [{ name: 'срочно' }] },
      { title: '', column: 0 },
    ],
  };
  const im = await c('POST', `/api/workspaces/${w.id}/import`, payload);
  assert.equal(im.status, 201);
  assert.equal(im.data.project.total, 2);
  assert.equal(im.data.project.done, 1);
  assert.equal(im.data.labels_created, 1, 'одинаковая метка создаётся один раз');
  const b = (await c('GET', `/api/projects/${im.data.project.id}`)).data;
  assert.equal(b.columns.length, 2);
  assert.equal(b.tasks.length, 2);
  assert.equal((await c('POST', `/api/workspaces/${w.id}/import`, { ...payload, tasks: [] })).status, 400);
  assert.equal((await c('POST', `/api/workspaces/${w.id}/import`, { ...payload, columns: [] })).status, 400);
  const big = { name: 'Много', columns: [{ name: 'А' }], tasks: Array.from({ length: 250 }, (_, i) => ({ title: 'з' + i, column: 0, labels: [{ name: 'м' + (i % 5) }], checklist: [{ text: 'a' }, { text: 'b' }] })) };
  const bi = await c('POST', `/api/workspaces/${w.id}/import`, big);
  assert.equal(bi.status, 201, JSON.stringify(bi.data));
  assert.equal(bi.data.project.total, 250);
  const outsider = client();
  await outsider('POST', '/api/auth/register', { email: `out${run}@test.dev`, name: 'Чужой', password: 'password123' });
  assert.equal((await outsider('POST', `/api/workspaces/${w.id}/import`, payload)).status, 404);
}
ok('импорт: колонки, задачи, метки, чек-листы, большие файлы, чужим нельзя');

// ---------- приглашения друзей и статистика роста ----------
{
  const host = client();
  const regH = await host('POST', '/api/auth/register', { email: `host${run}@test.dev`, name: 'Хозяин', password: 'password123' });
  const r1 = await host('GET', '/api/me/referral');
  assert.equal(r1.status, 200);
  assert.match(r1.data.code, /^[a-z0-9]{6,12}$/);
  assert.ok(r1.data.link.endsWith(`/register?ref=${r1.data.code}`));
  assert.equal((await host('GET', '/api/me/referral')).data.code, r1.data.code, 'код не меняется');
  assert.equal(r1.data.invited, 0);

  const friend = client();
  const regF = await friend('POST', '/api/auth/register', { email: `friend${run}@test.dev`, name: 'Друг', password: 'password123', source: { ref: r1.data.code, utm_source: 'telegram', junk: 'x'.repeat(500) } });
  assert.equal(regF.status, 201);
  assert.equal(regF.data.referred, true);
  assert.equal((await host('GET', '/api/me/referral')).data.invited, 1);
  // до подтверждения почты бонуса нет
  assert.equal((await friend('GET', '/api/me')).data.user.trial_ends_at, null);
  const v = await client()('POST', '/api/auth/verify', { token: regF.data.debug_verify_token });
  assert.equal(v.data.bonus_days, 7);
  const DAY = 86400000;
  const fTrial = (await friend('GET', '/api/me')).data.user.trial_ends_at;
  assert.ok(fTrial > Date.now() + 11.9 * DAY && fTrial < Date.now() + 12.1 * DAY, 'другу 5 пробных + 7 бонусных');
  const hTrial = (await host('GET', '/api/me')).data.user;
  assert.ok(hTrial.trial_ends_at > Date.now() + 11.9 * DAY, 'пригласившему тоже');
  assert.equal(hTrial.effective_plan, 'team');
  // повторное открытие ссылки бонус не удваивает
  assert.equal((await client()('POST', '/api/auth/verify', { token: regF.data.debug_verify_token })).data.bonus_days, 0);
  assert.equal((await friend('GET', '/api/me')).data.user.trial_ends_at, fTrial);
  const r2 = (await host('GET', '/api/me/referral')).data;
  assert.equal(r2.rewarded, 1);
  assert.equal(r2.earned_days, 7);
  // чужой или кривой код просто игнорируется
  const stray = await client()('POST', '/api/auth/register', { email: `stray${run}@test.dev`, name: 'Без друга', password: 'password123', ref: 'ZZZ; drop' });
  assert.equal(stray.status, 201);
  assert.equal(stray.data.referred, false);
  void regH;

  // статистика только для владельца сервиса
  assert.equal((await host('GET', '/api/admin/growth')).status, 404);
  assert.equal((await host('GET', '/api/me')).data.user.staff, undefined);
  const staff = client();
  await staff('POST', '/api/auth/register', { email: 'staff@tasqly.test', name: 'Владелец', password: 'password123' }).then((r) => r.status === 409 && staff('POST', '/api/auth/login', { email: 'staff@tasqly.test', password: 'password123' }));
  assert.equal((await staff('GET', '/api/me')).data.user.staff, true);
  const g = await staff('GET', '/api/admin/growth');
  assert.equal(g.status, 200);
  assert.ok(g.data.totals.users >= 3);
  assert.ok(g.data.sources.some((s) => s.source === 'telegram'));
  assert.ok(g.data.referrers.some((r) => r.name === 'Хозяин'));
}
ok('приглашения: ссылка, бонус обоим после подтверждения, без повторов; статистика только владельцу');

await alice('POST', '/api/auth/logout', {});
assert.equal((await alice('GET', '/api/me')).status, 401);
ok('выход');

console.log(`\nпройдено: ${passed}`);
