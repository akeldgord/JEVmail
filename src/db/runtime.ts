import { createDatabase } from './client.ts'; import { createRepositories } from './repositories/index.ts'; import { requireEnv } from '../config/env.ts';
let cached:ReturnType<typeof createRepositories>|undefined;
export function getRuntimeRepositories(){if(!cached){const env=requireEnv(); cached=createRepositories(createDatabase(env.DATABASE_PATH));} return cached;}
