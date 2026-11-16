# Резервные копии tasqly

Два уровня защиты базы:

1. **D1 Time Travel** — встроенное восстановление на любой момент за последние дни (срок зависит от плана Cloudflare).
   Восстановление: `npx wrangler d1 time-travel restore tasqly --timestamp=2026-11-16T10:00:00Z`.
   Посмотреть доступные точки: `npx wrangler d1 time-travel info tasqly`.
2. **Ежедневный снимок в KV** (`tasqly-backups`, привязка `BACKUPS`). Cron каждый день в 21:30 UTC (02:30 по Астане)
   сохраняет все таблицы в JSON и хранит 14 дней. Не копируются содержимое файлов диска, сессии входа и счётчики AI.
   Восстановление: `node scripts/restore-backup.mjs 2026-11-16 > restore.sql`, затем
   `npx wrangler d1 execute tasqly --remote --file restore.sql` (существующие строки заменяются).

Проверить, что копии появляются: в панели Cloudflare → Workers → tasqly → Logs ищи строку `backup {...}`.
