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
