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
  const t = await client()('POST', '/api/auth/register', { email: `trial${run}@test.dev`, name: 'триал', password: 'password123' });
  assert.equal(t.status, 201);
  const days = (t.data.user.trial_ends_at - Date.now()) / 86400000;
  assert.ok(days > 4.9 && days <= 5, `ожидали 5 дней, получили ${days}`);
}
ok('пробный период: новый аккаунт получает 5 дней');

await alice('POST', '/api/auth/logout', {});
assert.equal((await alice('GET', '/api/me')).status, 401);
ok('выход');

console.log(`\nпройдено: ${passed}`);
