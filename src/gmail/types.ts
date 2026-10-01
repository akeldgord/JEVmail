export type GmailLabel={id:string;name:string;labelListVisibility?:'labelShow'|'labelShowIfUnread'|'labelHide';messageListVisibility?:'show'|'hide';type?:string};
export type GmailMessageRef={id:string;threadId:string};
export type GmailHeader={name:string;value:string};
export type GmailPart={mimeType?:string;filename?:string;body?:{data?:string;attachmentId?:string;size?:number};headers?:GmailHeader[];parts?:GmailPart[]};
export type GmailMessage={id:string;threadId:string;labelIds:string[];internalDate:number;payload?:GmailPart;snippet?:string};
export type GmailThread={id:string;messages:GmailMessage[]};
export interface GmailClient {
 listLabels():Promise<GmailLabel[]>; createLabel(input:Omit<GmailLabel,'id'>):Promise<GmailLabel>;
 modifyMessage(messageId:string,addLabelIds:string[],removeLabelIds?:string[]):Promise<void>;
 getMessage(messageId:string):Promise<GmailMessage>; getThread(threadId:string):Promise<GmailThread>;
 listMessages(query:{q?:string;labelIds?:string[];pageToken?:string;maxResults?:number}):Promise<{messages:GmailMessageRef[];nextPageToken?:string;resultSizeEstimate?:number}>;
}
