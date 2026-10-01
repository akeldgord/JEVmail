import type { GmailClient } from './types.ts'; import { normalizeGmailMessage } from './normalize-message.ts';
export async function fetchNormalizedMessage(client:GmailClient,messageId:string){return normalizeGmailMessage(await client.getMessage(messageId));}
