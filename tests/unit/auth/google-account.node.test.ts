import test from 'node:test'; import assert from 'node:assert/strict';
import { assertBoundAccount, connectionState } from '../../../src/auth/google-account.ts';
test('bound account rejects another identity',()=>{ assert.doesNotThrow(()=>assertBoundAccount('me@example.com','ME@example.com')); assert.throws(()=>assertBoundAccount('me@example.com','other@example.com')); });
test('missing refresh token requires reconnect',()=>{ assert.equal(connectionState({accountEmail:'me@example.com',encryptedRefreshToken:null}),'needsReconnect'); assert.equal(connectionState({accountEmail:'me@example.com',encryptedRefreshToken:'x'}),'connected'); });
