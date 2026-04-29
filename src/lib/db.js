import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { runMigrations } from './migrations';

const DB_PATH = process.env.DATABASE_PATH || './data/analytics.db';

let db;

export function getDb() {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    runMigrations(db);
    seedDefaultAdmin(db);
  }
  return db;
}

// Pre-computed bcrypt hash (10 rounds) for the default admin password
const DEFAULT_ADMIN_HASH = '$2b$10$ErecOluYTDDfpn4DkRbEdOtR.U6VTmsmG824RNBmOF9fJR0DozqWK';

function seedDefaultAdmin(db) {
  const exists = db.prepare("SELECT id FROM users WHERE email = 'ism007'").get();
  if (!exists) {
    db.prepare('DELETE FROM users').run();
    db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)').run(
      'ism007',
      'Admin',
      DEFAULT_ADMIN_HASH
    );
  }
}

export function resetDb() {
  if (db) {
    try { db.close(); } catch {}
  }
  db = null;
}
