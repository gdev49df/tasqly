# tasqly

Рабочее пространство для команд: пространства, проекты, канбан-доска, задачи с исполнителями, дедлайнами и приоритетами, комментарии. Работает как PWA (ставится на телефон).

Стек: Cloudflare Workers (API + статика) и D1, клиент на чистом JS без сборки.

## Запуск локально

```bash
npm install
npm run db:local   # применить schema.sql к локальной D1
npm run dev        # http://localhost:8787
npm test           # сквозной тест API (при запущенном dev)
```

## Деплой

```bash
npx wrangler login
npm run db:remote  # схема уже применена к базе tasqly, команда безопасна (IF NOT EXISTS)
npm run deploy
```

База D1 `tasqly` создана, её id прописан в `wrangler.toml`.

## Структура

- `src/worker.js` — API: регистрация и вход (PBKDF2, сессии в D1), пространства, проекты, задачи, комментарии
- `schema.sql` — схема базы
- `public/` — PWA: `index.html`, `app.js`, `styles.css`, `manifest.webmanifest`, `sw.js`
- `test/api.test.mjs` — тест API

## Что дальше

Ограничение попыток входа, смена и сброс пароля, роли в пространстве, вложения, уведомления, календарь и документы.
