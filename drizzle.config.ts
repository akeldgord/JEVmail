export default { schema: './src/db/drizzle-schema.ts', out: './src/db/migrations', dialect: 'sqlite', dbCredentials: { url: process.env.DATABASE_PATH ?? './data/jevmail.db' } };
