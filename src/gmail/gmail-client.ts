import { google } from 'googleapis'; import type { GmailClient,GmailLabel,GmailMessage,GmailThread } from './types.ts';
export function createGoogleGmailClient(args:{clientId:string;clientSecret:string;redirectUri:string;refreshToken:string}):GmailClient{
 const oauth=new google.auth.OAuth2(args.clientId,args.clientSecret,args.redirectUri); oauth.setCredentials({refresh_token:args.refreshToken}); const gmail=google.gmail({version:'v1',auth:oauth});
 return {
  async listLabels(){const r=await gmail.users.labels.list({userId:'me'}); return (r.data.labels??[]).filter(x=>x.id&&x.name).map(x=>({id:x.id!,name:x.name!,labelListVisibility:x.labelListVisibility as any,messageListVisibility:x.messageListVisibility as any,type:x.type??undefined}));},
  async createLabel(input){const r=await gmail.users.labels.create({userId:'me',requestBody:input as any}); return r.data as GmailLabel;},
  async modifyMessage(messageId,addLabelIds,removeLabelIds=[]){await gmail.users.messages.modify({userId:'me',id:messageId,requestBody:{addLabelIds,removeLabelIds}});},
  async getMessage(id){const r=await gmail.users.messages.get({userId:'me',id,format:'full'}); return mapMessage(r.data as any);},
  async getThread(id){const r=await gmail.users.threads.get({userId:'me',id,format:'full'}); return {id:r.data.id!,messages:(r.data.messages??[]).map(m=>mapMessage(m as any))} as GmailThread;},
  async listMessages(q){const r=await gmail.users.messages.list({userId:'me',...q}); return {messages:(r.data.messages??[]).map(m=>({id:m.id!,threadId:m.threadId!})),nextPageToken:r.data.nextPageToken??undefined,resultSizeEstimate:r.data.resultSizeEstimate??undefined};}
 };
}
function mapPart(p:any):any{return {mimeType:p.mimeType,filename:p.filename,body:{data:p.body?.data,attachmentId:p.body?.attachmentId,size:p.body?.size},headers:(p.headers??[]).map((h:any)=>({name:h.name,value:h.value})),parts:(p.parts??[]).map(mapPart)};}
function mapMessage(m:any):GmailMessage{return {id:m.id,threadId:m.threadId,labelIds:m.labelIds??[],internalDate:Number(m.internalDate??0),payload:m.payload?mapPart(m.payload):undefined,snippet:m.snippet??undefined};}
