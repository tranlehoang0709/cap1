export interface RuntimeConfiguration {
  app: {
    port: number;
  };
  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    name: string;
    connectionLimit: number;
  };
}

export function validateEnvironment(environment: Record<string, unknown>): Record<string, unknown> {
  const required = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
  const missing = required.filter((key) => {
    const value = environment[key];
    return typeof value !== 'string' || (key !== 'DB_PASSWORD' && value.trim().length === 0);
  });

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const databasePort = Number(environment.DB_PORT);
  if (!Number.isInteger(databasePort) || databasePort < 1 || databasePort > 65535) {
    throw new Error('DB_PORT must be an integer between 1 and 65535');
  }
  if (environment.DB_NAME !== 'aiva_iot') {
    throw new Error('DB_NAME must be aiva_iot; this backend is restricted to the existing V1.5 database');
  }

  const appPort = environment.PORT === undefined ? 3000 : Number(environment.PORT);
  if (!Number.isInteger(appPort) || appPort < 1 || appPort > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const connectionLimit = environment.DB_CONNECTION_LIMIT === undefined
    ? 10
    : Number(environment.DB_CONNECTION_LIMIT);
  if (!Number.isInteger(connectionLimit) || connectionLimit < 1) {
    throw new Error('DB_CONNECTION_LIMIT must be a positive integer');
  }

  return environment;
}

export default function configuration(): RuntimeConfiguration {
  return {
    app: {
      port: Number(process.env.PORT ?? 3000),
    },
    database: {
      host: process.env.DB_HOST ?? '',
      port: Number(process.env.DB_PORT ?? 3306),
      user: process.env.DB_USER ?? '',
      password: process.env.DB_PASSWORD ?? '',
      name: process.env.DB_NAME ?? '',
      connectionLimit: Number(process.env.DB_CONNECTION_LIMIT ?? 10),
    },
  };
}
