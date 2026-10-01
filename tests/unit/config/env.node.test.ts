import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv } from '../../../src/config/env.ts';

test('parseEnv reports all required variables', () => {
  const result = parseEnv({});
  assert.equal(result.success, false);
  if (result.success) throw new Error('expected failure');
  for (const key of ['APP_URL','AUTH_SECRET','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','JEVMODEL_API_KEY','JEV_MODEL','APP_ENCRYPTION_KEY']) {
    assert.ok(result.error.issues.some((i) => i.path[0] === key), `missing issue for ${key}`);
  }
});

test('parseEnv applies defaults', () => {
  const result = parseEnv({
    APP_URL: 'http://localhost:3000', AUTH_SECRET: 'a'.repeat(32),
    GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', JEVMODEL_API_KEY: 'sk-test',
    JEV_MODEL: 'jev-1.13.0', APP_ENCRYPTION_KEY: 'b'.repeat(32)
  });
  assert.equal(result.success, true);
  assert.equal(result.data.JEV_BASE_URL, 'https://jevmodel.org');
  assert.equal(result.data.POLL_INTERVAL_SECONDS, 60);
  assert.equal(result.data.MAX_PER_MINUTE, 30);
  assert.equal(result.data.MAX_PER_HOUR, 300);
  assert.equal(result.data.MAX_PER_DAY, 2000);
  assert.equal(result.data.BACKLOG_BATCH_SIZE, 25);
});
