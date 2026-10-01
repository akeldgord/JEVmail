import { createDatabase } from './client.ts'; import { requireEnv } from '../config/env.ts';
const env=requireEnv(); const db=createDatabase(env.DATABASE_PATH); db.close(); console.log('database schema ready');
