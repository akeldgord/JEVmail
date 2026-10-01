import test from 'node:test';
import assert from 'node:assert/strict';
import { PollingService } from '../../../src/processing/polling.ts';

test('normal polling never asks the processor to handle pre-watermark or processed messages', async () => {
  const seen:string[]=[];
  const repos:any={installation:{get(){return{startupWatermarkMs:10_000,processedLabelId:'p',paused:false,needsReconnect:false};}}};
  const gmail:any={async listMessages(q:any){assert.deepEqual(q.labelIds,['INBOX']);assert.equal(q.q,'after:10 -label:"JEVmail/Processed"');return{messages:[{id:'new1',threadId:'t'}]};}};
  const processor:any={async processMessage(id:string){seen.push(id);return'processed';}};
  const result=await new PollingService({gmail,repos,processor}).pollOnce();
  assert.equal(result.status,'ok');
  assert.deepEqual(seen,['new1']);
});
