import 'reflect-metadata';
import { ForbiddenException, HttpException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MonitoringRepository } from '../src/modules/monitoring/monitoring.repository';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { AIWebChatClient } from '../src/modules/web-chat/ai-web-chat.client';

// Isolated regression tests only; these are not live-service acceptance tests.
function filtered(error: unknown) {
  let status = 0; let body: any;
  const host = {switchToHttp: () => ({getRequest: () => ({url:'/internal/ai/resolve-config'}),
    getResponse: () => ({status: (code: number) => {status=code;return {json: (value: unknown) => {body=value;}};}})})};
  new ApiExceptionFilter().catch(error, host as any);
  return {status, body};
}
describe('Safe internal denial reporting', () => {
  it('preserves the contract denial and HTTP status without granting approval', () => {
    const result=filtered(new ForbiddenException({allowed:false,reason:'CONTRACT_NOT_APPROVED'}));
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({reason:'CONTRACT_NOT_APPROVED',code:'CONTRACT_NOT_APPROVED',message:'CONTRACT_NOT_APPROVED'});
    expect(filtered(new ServiceUnavailableException('AI_CONFIGURATION_CONTRACT_NOT_APPROVED')).body.code).toBe('AI_CONFIGURATION_CONTRACT_NOT_APPROVED');
  });
  it('does not expose arbitrary reason objects or server error details', () => {
    expect(JSON.stringify(filtered(new ForbiddenException({reason:'private-upstream-data'})))).not.toContain('private-upstream-data');
    expect(filtered(new HttpException({reason:'CONTRACT_NOT_APPROVED'},500)).body).not.toHaveProperty('reason');
    expect(JSON.stringify(filtered(new HttpException({message:'private-sql-and-password'},500)))).not.toContain('private-sql-and-password');
  });
});
describe('Web Chat upstream denial mapping without provider execution', () => {
  let fetcher: jest.SpyInstance; let client: AIWebChatClient;
  beforeEach(() => {client=new AIWebChatClient(new ConfigService({AI_SERVER_URL:'http://127.0.0.1:8000',AI_SERVER_WEB_TOKEN:'w'.repeat(43)}));fetcher=jest.spyOn(global,'fetch');});
  afterEach(() => jest.restoreAllMocks());
  it('reports disabled configuration as unavailable, without retrying or masking it as a 502', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({detail:'CONTRACT_NOT_APPROVED'}),{status:403,headers:{'Content-Type':'application/json'}}));
    await expect(client.send('7','Question')).rejects.toThrow('AI_CONFIGURATION_CONTRACT_NOT_APPROVED');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('keeps a service credential failure distinct from user login failure', async () => {
    fetcher.mockResolvedValue(new Response('',{status:401}));
    await expect(client.send('7','Question')).rejects.toThrow('AI_SERVICE_AUTHENTICATION_FAILED');
  });
  it('never passes arbitrary upstream bodies or oversized denial payloads through', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({detail:'private-upstream-data'}),{status:403,headers:{'Content-Type':'application/json'}}));
    await expect(client.send('7','Question')).rejects.toThrow('AI_ACCESS_DENIED');
    fetcher.mockResolvedValue(new Response('x'.repeat(4097),{status:403,headers:{'Content-Type':'application/json'}}));
    await expect(client.send('7','Question')).rejects.toThrow('AI_ACCESS_DENIED');
  });
  it('reports missing Local runtime without substituting a Cloud answer', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({detail:'LOCAL_RUNTIME_UNAVAILABLE'}),{status:503,headers:{'Content-Type':'application/json'}}));
    await expect(client.send('7','Question')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('Admin dashboard read-only integration', () => {
  it('does not mutate device presence when the dashboard is opened', async () => {
    const query=jest.fn().mockResolvedValue([[{total:0}]]);
    await new MonitoringRepository({query} as any).dashboard();
    expect(query.mock.calls.length).toBeGreaterThan(0);
    expect(query.mock.calls.every(([sql]) => /^SELECT /i.test(sql))).toBe(true);
  });
});
