// сквозной тест api: запусти `npm run dev` (после `npm run db:local`), затем `npm test`
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:8787';

function client() {
  let cookie = '';
  return async (method, path, body, { raw = false, headers = {} } = {}) => {
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
    if (raw) return res;
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

// регистрация и вход
let r = await alice('POST', '/api/auth/register', { email: `alice${run}@test.dev`, name: 'Alice', password: 'password123' });
assert.equal(r.status, 201);
ok('регистрация');

r = await alice('POST', '/api/auth/register', { email: `alice${run}@test.dev`, name: 'Alice', password: 'password123' });
assert.equal(r.status, 409);
ok('повторный email отклоняется');

r = await alice('POST', '/api/auth/register', { email: `x${run}@test.dev`, name: 'X', password: 'short' });
assert.equal(r.status, 400);
ok('короткий пароль отклоняется');

r = await client()('GET', '/api/me');
assert.equal(r.status, 401);
ok('без сессии /api/me даёт 401');

r = await alice('GET', '/api/me');
assert.equal(r.status, 200);
assert.equal(r.data.user.name, 'Alice');
ok('сессия работает');

const wrong = await client()('POST', '/api/auth/login', { email: `alice${run}@test.dev`, password: 'wrongpass1' });
assert.equal(wrong.status, 401);
ok('неверный пароль отклоняется');

const again = client();
r = await again('POST', '/api/auth/login', { email: `alice${run}@test.dev`, password: 'password123' });
assert.equal(r.status, 200);
ok('вход по паролю');

// csrf-защита: не json
const form = await fetch(BASE + '/api/workspaces', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
assert.equal(form.status, 415);
ok('запросы не в json отклоняются');

// пространство и проект
r = await alice('POST', '/api/workspaces', { name: 'Студия' });
assert.equal(r.status, 201);
const wsId = r.data.workspace.id;
r = await alice('GET', `/api/workspaces/${wsId}`);
assert.equal(r.data.members.length, 1);
const code = r.data.workspace.invite_code;
ok('создание пространства');

r = await alice('POST', `/api/workspaces/${wsId}/projects`, { name: 'Сайт' });
assert.equal(r.status, 201);
const projId = r.data.project.id;
ok('создание проекта');

// чужой пользователь не видит пространство
r = await bob('POST', '/api/auth/register', { email: `bob${run}@test.dev`, name: 'Bob', password: 'password123' });
assert.equal(r.status, 201);
const bobUserId = r.data.user.id;
r = await bob('GET', `/api/workspaces/${wsId}`);
assert.equal(r.status, 404);
r = await bob('GET', `/api/projects/${projId}`);
assert.equal(r.status, 404);
ok('посторонний не видит чужие данные');

// вступление по коду
r = await bob('POST', '/api/workspaces/join', { code: 'NOPE0000' });
assert.equal(r.status, 404);
r = await bob('POST', '/api/workspaces/join', { code: code.toLowerCase() });
assert.equal(r.status, 200);
r = await bob('GET', `/api/projects/${projId}`);
assert.equal(r.status, 200);
ok('вступление по коду');

// задачи
r = await alice('POST', `/api/projects/${projId}/tasks`, { title: 'Дизайн', priority: 2, due_date: '2026-12-01', assignee_id: bobUserId });
assert.equal(r.status, 201);
const t1 = r.data.task;
r = await alice('POST', `/api/projects/${projId}/tasks`, { title: 'Вёрстка' });
const t2 = r.data.task;
assert.ok(t2.position > t1.position);
ok('создание задач, позиции растут');

r = await alice('POST', `/api/projects/${projId}/tasks`, { title: 'Плохая', assignee_id: 'не-участник' });
assert.equal(r.status, 400);
r = await alice('POST', `/api/projects/${projId}/tasks`, { title: 'Плохая', due_date: '12.01.2026' });
assert.equal(r.status, 400);
r = await alice('POST', `/api/projects/${projId}/tasks`, { title: 'Плохая', status: 'hack' });
assert.equal(r.status, 400);
ok('валидация задач');

r = await bob('PATCH', `/api/tasks/${t1.id}`, { status: 'doing', position: 500 });
assert.equal(r.status, 200);
assert.equal(r.data.task.status, 'doing');
ok('перемещение задачи');

r = await client()('PATCH', `/api/tasks/${t1.id}`, { status: 'done' });
assert.equal(r.status, 401);
ok('изменение без входа запрещено');

// комментарии
r = await bob('POST', `/api/tasks/${t1.id}/comments`, { body: 'Беру в работу' });
assert.equal(r.status, 201);
r = await alice('GET', `/api/tasks/${t1.id}/comments`);
assert.equal(r.data.comments.length, 1);
assert.equal(r.data.comments[0].author, 'Bob');
r = await alice('GET', `/api/projects/${projId}`);
assert.equal(r.data.tasks.find((t) => t.id === t1.id).comments, 1);
ok('комментарии');

// удаление
r = await bob('DELETE', `/api/projects/${projId}`, {});
assert.equal(r.status, 403);
ok('участник не удаляет проект');

r = await alice('DELETE', `/api/tasks/${t2.id}`, {});
assert.equal(r.status, 200);
r = await alice('DELETE', `/api/projects/${projId}`, {});
assert.equal(r.status, 200);
r = await alice('GET', `/api/projects/${projId}`);
assert.equal(r.status, 404);
ok('удаление задачи и проекта (с каскадом)');

// выход
await alice('POST', '/api/auth/logout', {});
r = await alice('GET', '/api/me');
assert.equal(r.status, 401);
ok('выход');

console.log(`\nпройдено: ${passed}`);
