import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path'; import { mkdirSync } from 'node:fs';
import { SCHEMA_SQL } from './schema.ts';
export type AppDatabase = DatabaseSync;
export function createDatabase(path: string): AppDatabase {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA_SQL);
  return db;
}
