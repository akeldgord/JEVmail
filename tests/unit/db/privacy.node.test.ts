import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
test('schema does not persist email or prompt content', () => {
  const source=fs.readFileSync(new URL('../../../src/db/schema.ts', import.meta.url),'utf8').toLowerCase();
  for (const forbidden of ['bodytext','threadtext','rawmessage','attachmentcontent','promptpayload','email_body','message_body']) {
    assert.equal(source.includes(forbidden),false,`schema contains forbidden field ${forbidden}`);
  }
});

test('audit schema excludes sender and subject content', () => {
  const source=fs.readFileSync(new URL('../../../src/db/schema.ts', import.meta.url),'utf8').toLowerCase();
  assert.equal(/\bsender\s+text\b/.test(source),false,'audit schema must not persist sender');
  assert.equal(/\bsubject\s+text\b/.test(source),false,'audit schema must not persist subject');
});
