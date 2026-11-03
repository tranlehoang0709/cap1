import { validateEnvironment } from '../src/config/configuration';

const validEnvironment = (): Record<string, unknown> => ({
  DB_HOST: '127.0.0.1',
  DB_PORT: '3306',
  DB_USER: 'aiva',
  DB_PASSWORD: 'provided-locally',
  DB_NAME: 'aiva_iot',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  APP_ENCRYPTION_KEY: 'c'.repeat(43),
  ADMIN_EMAIL: 'admin@example.test',
  ADMIN_PASSWORD: 'a-strong-admin-password',
  ADMIN_DISPLAY_NAME: 'Administrator',
});

describe('validateEnvironment', () => {
  it('permits only explicitly opted-in isolated MySQL test schemas',()=>{
    const env={...validEnvironment(),NODE_ENV:'test',MYSQL_INTEGRATION_TESTS:'true',DB_NAME:'aiva_iot_test_local'};
    expect(validateEnvironment(env)).toEqual(env);
    expect(()=>validateEnvironment({...env,NODE_ENV:'production'})).toThrow('DB_NAME');
    expect(()=>validateEnvironment({...env,MYSQL_INTEGRATION_TESTS:'false'})).toThrow('DB_NAME');
  });
  it('validates independent internal service tokens and explicit usage deadline', () => {
    const env={...validEnvironment(),DEVICE_AUTH_CONTRACT_APPROVED:'true',AI_CONFIG_CONTRACT_APPROVED:'true',AI_QUOTA_CONTRACT_APPROVED:'true',
      AI_DEVICE_SERVICE_TOKEN:'d'.repeat(43),AI_CONFIG_SERVICE_TOKEN:'e'.repeat(43),AI_QUOTA_SERVICE_TOKEN:'f'.repeat(43),AI_USAGE_REPORT_TIMEOUT_SECONDS:'30'};
    expect(validateEnvironment(env)).toEqual(env);
    expect(()=>validateEnvironment({...env,AI_CONFIG_SERVICE_TOKEN:env.AI_DEVICE_SERVICE_TOKEN})).toThrow('independent');
    expect(()=>validateEnvironment({...env,AI_QUOTA_SERVICE_TOKEN:'bad'})).toThrow('AI_QUOTA_SERVICE_TOKEN');
    expect(()=>validateEnvironment({...env,AI_USAGE_REPORT_TIMEOUT_SECONDS:''})).toThrow('AI_USAGE_REPORT_TIMEOUT_SECONDS');
    expect(()=>validateEnvironment({...env,AI_USAGE_REPORT_SWEEPER_ENABLED:'yes'})).toThrow('AI_USAGE_REPORT_SWEEPER_ENABLED');
  });
  it('accepts a complete V1.5 database configuration', () => {
    expect(validateEnvironment(validEnvironment())).toEqual(validEnvironment());
  });

  it('rejects a database name other than the existing V1.5 database', () => {
    expect(() => validateEnvironment({ ...validEnvironment(), DB_NAME: 'another_database' }))
      .toThrow('DB_NAME must be aiva_iot');
  });

  it('rejects missing credentials and invalid ports', () => {
    const missingPassword = validEnvironment();
    delete missingPassword.DB_PASSWORD;
    expect(() => validateEnvironment(missingPassword)).toThrow('DB_PASSWORD');
    expect(() => validateEnvironment({ ...validEnvironment(), DB_PORT: '70000' }))
      .toThrow('DB_PORT must be an integer');
  });

  it('rejects short token secrets and malformed browser origins', () => {
    expect(() => validateEnvironment({ ...validEnvironment(), JWT_ACCESS_SECRET: 'short' }))
      .toThrow('JWT_ACCESS_SECRET must contain at least 32 characters');
    expect(() => validateEnvironment({ ...validEnvironment(), CORS_ORIGINS: 'https://example.com/path' }))
      .toThrow('CORS_ORIGINS must be a comma-separated list of HTTP(S) origins');
  });
});
