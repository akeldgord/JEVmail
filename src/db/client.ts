import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path'; import { mkdirSync } from 'node:fs';
import { SCHEMA_SQL } from './schema.ts';
export type AppDatabase = DatabaseSync;

function ensureInstallationColumns(db:AppDatabase){
  const existing=new Set((db.prepare('PRAGMA table_info(installation)').all() as any[]).map((r:any)=>String(r.name)));
  const additions:[string,string][]=[
    ['backlog_concurrency','INTEGER NOT NULL DEFAULT 8'],
    ['reconnect_reason','TEXT'],
    ['defer_reason','TEXT'],
    ['defer_until','INTEGER'],
  ];
  for(const [name,type] of additions){
    if(!existing.has(name)) db.exec(`ALTER TABLE installation ADD COLUMN ${name} ${type}`);
  }
}

function ensureProcessingErrorColumns(db:AppDatabase){
  const existing=new Set((db.prepare('PRAGMA table_info(processing_errors)').all() as any[]).map((r:any)=>String(r.name)));
  const additions:[string,string][]=[
    ['provider','TEXT'],
    ['status','INTEGER'],
    ['detail','TEXT'],
  ];
  for(const [name,type] of additions){
    if(!existing.has(name)) db.exec(`ALTER TABLE processing_errors ADD COLUMN ${name} ${type}`);
  }
}

export function createDatabase(path: string): AppDatabase {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA_SQL);
  ensureInstallationColumns(db);
  ensureProcessingErrorColumns(db);
  return db;
}
