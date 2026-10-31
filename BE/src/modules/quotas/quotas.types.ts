export type QuotaMode='UNLIMITED'|'LIMITED'|'BLOCKED';
export interface QuotaPolicy {
  id:string;userId:string;providerId:string;requestsPerMinute:number|null;
  requestsPerDay:number|null;tokensPerMonth:string|null;
}
export interface UsageRow {
  id:string;userId:string;providerId:string;modelId:string;conversationId:string|null;sessionId:string|null;
  requestId:string;fingerprint:string;policyId:string;reservedTokens:string|null;
  status:string;occurredAt:Date;reportDueAt:Date|null;reportFingerprint:string|null;finalizedAt:Date|null;
}
export interface QuotaTotals {minuteRequests:string;dayRequests:string;monthTokens:string;reservedTokens:string;unboundedRequests:string}
export interface UsageTotals {requestsUsed:string;inputTokens:string;outputTokens:string;reservedTokens:string;unboundedRequests:string}
export interface AdmissionInput {
  requestId:string;userId:string;providerId:string;modelId:string;deviceId:string|null;
  sessionId:string|null;conversationId:string|null;maxTotalTokens:string|null;
}
