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

## Два адреса

- **cloudflare workers**: https://tasqly.wsmp.workers.dev/ — сайт и api вместе (вход по cookie)
- **github pages**: https://gdev49df.github.io/tasqly/ — только клиент, api берёт с cloudflare (вход по токену). публикуется workflow `.github/workflows/pages.yml`; в настройках репозитория: Settings → Pages → Source: **GitHub Actions**

Какие сайты могут ходить в api, задаёт `ALLOWED_ORIGINS` в `wrangler.toml`.

## Структура

- `src/worker.js` — API: регистрация и вход (PBKDF2, сессии в D1), пространства, проекты, задачи, комментарии
- `schema.sql` — схема базы
- `public/` — PWA: `index.html`, `app.js`, `styles.css`, `manifest.webmanifest`, `sw.js`
- `test/api.test.mjs` — тест API

## Что дальше

Ограничение попыток входа, смена и сброс пароля, роли в пространстве, вложения, уведомления, календарь и документы.

## что нового (v2)

- виды проекта: доска, список, календарь (перенос даты перетаскиванием)
- свои колонки: создание, переименование, «считать готовой», порядок, удаление
- метки с цветами, поиск (`/`), фильтры по исполнителю, метке, приоритету, просроченным
- подзадачи как чек-лист внутри задачи, комментарии
- светлая и тёмная тема

## миграции

для базы, созданной по первой версии `schema.sql`, один раз выполнить `migrations/0002_columns_labels_checklists.sql`:

```
npx wrangler d1 execute tasqly --remote --file=migrations/0002_columns_labels_checklists.sql
```

новые установки используют `schema.sql` целиком.
