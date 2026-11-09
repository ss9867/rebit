// SQLite 저장소. Node 24에 들어 있는 node:sqlite만 쓰므로 npm install이 필요 없다.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { FAQ_SEED, SETTINGS_SEED } from './seed.js';

export const DATA_DIR = path.resolve(process.env.REBIT_DATA_DIR || 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'rebit.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS operators (
  id INTEGER PRIMARY KEY,
  login_id TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  operator_id INTEGER NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS faqs (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '',
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1,
  views INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS visitors (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS threads (
  id INTEGER PRIMARY KEY,
  visitor_id INTEGER NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','open','closed')),
  unread_op INTEGER NOT NULL DEFAULT 0,
  unread_visitor INTEGER NOT NULL DEFAULT 0,
  page TEXT,
  created_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  closed_at INTEGER
);
CREATE INDEX IF NOT EXISTS threads_visitor ON threads(visitor_id, id);
CREATE INDEX IF NOT EXISTS threads_last ON threads(status, last_at);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK (sender IN ('visitor','operator','system')),
  operator_id INTEGER REFERENCES operators(id) ON DELETE SET NULL,
  body TEXT NOT NULL DEFAULT '',
  mood TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_thread ON messages(thread_id, id);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// 예전 DB에 없는 칸을 채운다. 메시지를 보낸 운영자 이름은 계정이 지워져도 기록에 남도록 따로 저장한다.
if (!db.prepare('PRAGMA table_info(messages)').all().some((c) => c.name === 'operator_name')) {
  db.exec('ALTER TABLE messages ADD COLUMN operator_name TEXT');
}

export const get = (sql, ...params) => db.prepare(sql).get(...params);
export const all = (sql, ...params) => db.prepare(sql).all(...params);
export const run = (sql, ...params) => db.prepare(sql).run(...params);

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// 처음 실행할 때만 예시 답변과 기본 문구를 넣는다. 운영자가 지운 답변은 다시 생기지 않는다.
if (!get('SELECT 1 AS x FROM settings WHERE key = ?', 'seeded')) {
  const now = Date.now();
  tx(() => {
    FAQ_SEED.forEach((f, i) => {
      run(
        'INSERT INTO faqs (category, path, question, answer, keywords, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        f.category, f.path, f.question, f.answer, f.keywords, i + 1, now, now,
      );
    });
    for (const [key, value] of Object.entries(SETTINGS_SEED)) {
      run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', key, value);
    }
    run("INSERT INTO settings (key, value) VALUES ('seeded', '1')");
  });
}

export const settings = () => Object.fromEntries(
  all("SELECT key, value FROM settings WHERE key != 'seeded'").map((r) => [r.key, r.value]),
);
