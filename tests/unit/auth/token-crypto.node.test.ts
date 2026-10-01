import test from 'node:test'; import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret } from '../../../src/auth/token-crypto.ts';
test('AES-GCM round trips and rejects wrong key',()=>{ const key='k'.repeat(32); const enc=encryptSecret('refresh-token',key); assert.notEqual(enc,'refresh-token'); assert.equal(decryptSecret(enc,key),'refresh-token'); assert.throws(()=>decryptSecret(enc,'z'.repeat(32))); });
