import { validateEnvironment } from '../src/config/configuration';

const validEnvironment = (): Record<string, unknown> => ({
  DB_HOST: '127.0.0.1',
  DB_PORT: '3306',
  DB_USER: 'aiva',
  DB_PASSWORD: 'provided-locally',
  DB_NAME: 'aiva_iot',
});

describe('validateEnvironment', () => {
  it('accepts a complete V1.5 database configuration', () => {
    expect(validateEnvironment(validEnvironment())).toEqual(validEnvironment());
  });

  it('rejects a database name other than the existing V1.5 database', () => {
    expect(() => validateEnvironment({ ...validEnvironment(), DB_NAME: 'another_database' }))
      .toThrow('DB_NAME must be aiva_iot');
  });
  it('permits explicitly opted-in isolated test schema while forbidding production for that runner',()=>{
    expect(validateEnvironment({...validEnvironment(),NODE_ENV:'test',MYSQL_INTEGRATION_TESTS:'true',DB_NAME:'aiva_iot_test'})).toBeDefined();
    expect(validateEnvironment({...validEnvironment(),NODE_ENV:'test',MYSQL_INTEGRATION_TESTS:'true',DB_NAME:'aiva_iot_test_ci'})).toBeDefined();
    expect(()=>validateEnvironment({...validEnvironment(),NODE_ENV:'test',MYSQL_INTEGRATION_TESTS:'true'})).toThrow('aiva_iot is forbidden');
    expect(()=>validateEnvironment({...validEnvironment(),NODE_ENV:'production',MYSQL_INTEGRATION_TESTS:'true',DB_NAME:'aiva_iot_test'})).toThrow('DB_NAME');
    expect(()=>validateEnvironment({...validEnvironment(),NODE_ENV:'test',DB_NAME:'aiva_iot_test'})).toThrow('DB_NAME');
    expect(()=>validateEnvironment({...validEnvironment(),NODE_ENV:'test'})).toThrow('MYSQL_INTEGRATION_TESTS=true');
  });

  it('rejects missing credentials and invalid ports', () => {
    const missingPassword = validEnvironment();
    delete missingPassword.DB_PASSWORD;
    expect(() => validateEnvironment(missingPassword)).toThrow('DB_PASSWORD');
    expect(() => validateEnvironment({ ...validEnvironment(), DB_PORT: '70000' }))
      .toThrow('DB_PORT must be an integer');
  });
  it('keeps quota disabled by default but requires explicit deadline/service configuration when enabled',()=>{
    expect(validateEnvironment({...validEnvironment(),AI_QUOTA_CONTRACT_APPROVED:'false',AI_USAGE_REPORT_TIMEOUT_SECONDS:''})).toBeDefined();
    expect(()=>validateEnvironment({...validEnvironment(),AI_QUOTA_CONTRACT_APPROVED:'true'})).toThrow('AI_USAGE_REPORT_TIMEOUT_SECONDS');
    expect(()=>validateEnvironment({...validEnvironment(),AI_QUOTA_CONTRACT_APPROVED:'true',AI_USAGE_REPORT_TIMEOUT_SECONDS:'30'})).toThrow('AI_QUOTA_SERVICE_TOKEN');
    expect(()=>validateEnvironment({...validEnvironment(),AI_USAGE_REPORT_SWEEPER_ENABLED:'yes'})).toThrow('AI_USAGE_REPORT_SWEEPER_ENABLED');
    expect(validateEnvironment({...validEnvironment(),AI_QUOTA_CONTRACT_APPROVED:'true',AI_USAGE_REPORT_TIMEOUT_SECONDS:'30',AI_QUOTA_SERVICE_TOKEN:'t'.repeat(43)})).toBeDefined();
  });
});
