// восстановление из ежедневной копии в kv: node scripts/restore-backup.mjs 2026-11-16 > restore.sql
// затем: npx wrangler d1 execute tasqly --remote --file restore.sql
// копия не содержит содержимое файлов диска и сессии входа; существующие строки заменяются
import { execFileSync } from 'node:child_process';

const NS = 'df326e84442f4de3aa1151451388083c';
const day = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) {
  console.error('использование: node scripts/restore-backup.mjs ГГГГ-ММ-ДД > restore.sql');
  process.exit(1);
}
const get = (key) => execFileSync('npx', ['wrangler', 'kv', 'key', 'get', '--namespace-id', NS, '--remote', key], { encoding: 'utf8', maxBuffer: 1 << 28 });
const index = JSON.parse(get(`b:${day}:_index`));
const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replaceAll("'", "''")}'`);
console.log('PRAGMA foreign_keys = OFF;');
for (const table of Object.keys(index.tables)) {
  for (const row of JSON.parse(get(`b:${day}:${table}`))) {
    const cols = Object.keys(row);
    console.log(`INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => q(row[c])).join(', ')});`);
  }
}
console.log('PRAGMA foreign_keys = ON;');
