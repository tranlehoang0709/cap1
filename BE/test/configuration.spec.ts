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

  it('rejects missing credentials and invalid ports', () => {
    const missingPassword = validEnvironment();
    delete missingPassword.DB_PASSWORD;
    expect(() => validateEnvironment(missingPassword)).toThrow('DB_PASSWORD');
    expect(() => validateEnvironment({ ...validEnvironment(), DB_PORT: '70000' }))
      .toThrow('DB_PORT must be an integer');
  });
});
