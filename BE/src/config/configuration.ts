export interface RuntimeConfiguration {
  app: {
    port: number;
    corsOrigins: string[];
  };
  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    name: string;
    connectionLimit: number;
  };
  auth: {
    accessTokenSecret: string;
    refreshTokenSecret: string;
    accessTokenTtlSeconds: number;
    refreshTokenTtlSeconds: number;
    adminEmail: string;
    adminPassword: string;
    adminDisplayName: string;
    adminSeedEnabled: boolean;
  };
  crypto: { encryptionKey: string };
  toolExecution: {
    serviceToken: string; calendarWritesEnabled: boolean; voiceMutationSecret: string;
    productionCalendarTest: { enabled: boolean; userId: string; deviceId: string; expiresAt: string;
      title: string; startsAt: string; endsAt: string; timezone: string };
  };
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
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
  const isolatedTest = environment.NODE_ENV === 'test' && environment.MYSQL_INTEGRATION_TESTS === 'true'
    && typeof environment.DB_NAME === 'string' && (/^aiva_iot_test(?:_[a-z0-9_]+)?$/.test(environment.DB_NAME) || environment.DB_NAME === 'aiva_pa01_voice_clone');
  if (environment.DB_NAME !== 'aiva_iot' && !isolatedTest) {
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

  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
    const value = environment[key];
    if (typeof value !== 'string' || value.length < 32) {
      throw new Error(`${key} must contain at least 32 characters`);
    }
  }

  const encryptionKey = environment.APP_ENCRYPTION_KEY;
  if (typeof encryptionKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(encryptionKey)) {
    throw new Error('APP_ENCRYPTION_KEY must be a 32-byte base64url value');
  }

  if (environment.ADMIN_SEED_ENABLED !== undefined && !['true', 'false'].includes(String(environment.ADMIN_SEED_ENABLED))) {
    throw new Error('ADMIN_SEED_ENABLED must be true or false');
  }
  if (environment.ADMIN_SEED_ENABLED === 'true') {
    for (const key of ['ADMIN_EMAIL', 'ADMIN_PASSWORD', 'ADMIN_DISPLAY_NAME'] as const) {
      const value = environment[key];
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`${key} is required when ADMIN_SEED_ENABLED=true`);
      }
    }
  }

  for (const key of ['ACCESS_TOKEN_TTL_SECONDS', 'REFRESH_TOKEN_TTL_SECONDS'] as const) {
    const value = environment[key] === undefined
      ? (key === 'ACCESS_TOKEN_TTL_SECONDS' ? 900 : 2592000)
      : Number(environment[key]);
    if (!Number.isInteger(value) || value < 60) {
      throw new Error(`${key} must be an integer of at least 60 seconds`);
    }
  }

  const contracts = [
    ['DEVICE_AUTH_CONTRACT_APPROVED', 'AI_DEVICE_SERVICE_TOKEN'],
    ['AI_CONFIG_CONTRACT_APPROVED', 'AI_CONFIG_SERVICE_TOKEN'],
    ['AI_QUOTA_CONTRACT_APPROVED', 'AI_QUOTA_SERVICE_TOKEN'],
  ];
  if (environment.AI_TOOL_SERVICE_TOKEN !== undefined &&
      (typeof environment.AI_TOOL_SERVICE_TOKEN !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(environment.AI_TOOL_SERVICE_TOKEN))) {
    throw new Error('AI_TOOL_SERVICE_TOKEN must be an independent base64url service token');
  }
  for (const [flag, token] of contracts) {
    if (environment[flag] !== undefined && !['true','false'].includes(String(environment[flag]))) throw new Error(`${flag} must be true or false`);
    if (environment[flag] === 'true' && (typeof environment[token] !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(environment[token] as string))) throw new Error(`${token} must be an independent base64url service token`);
  }
  const configuredTokens = contracts.map(([,key])=>environment[key]).filter(value=>typeof value==='string' && value!=='');
  if (new Set(configuredTokens).size !== configuredTokens.length) throw new Error('Internal service tokens must be independent');
  for (const token of configuredTokens) if ([environment.JWT_ACCESS_SECRET,environment.JWT_REFRESH_SECRET,environment.ADMIN_ACCESS_JWT_SECRET].includes(token)) throw new Error('Service tokens must differ from JWT secrets');
  if (environment.AI_QUOTA_CONTRACT_APPROVED === 'true' || environment.AI_USAGE_REPORT_SWEEPER_ENABLED === 'true') {
    const timeout = environment.AI_USAGE_REPORT_TIMEOUT_SECONDS;
    if (typeof timeout !== 'string' || !/^[1-9][0-9]*$/.test(timeout) || Number(timeout)>2147483) throw new Error('AI_USAGE_REPORT_TIMEOUT_SECONDS must be 1..2147483');
  }
  if (environment.AI_USAGE_REPORT_SWEEPER_ENABLED !== undefined && !['true','false'].includes(String(environment.AI_USAGE_REPORT_SWEEPER_ENABLED))) throw new Error('AI_USAGE_REPORT_SWEEPER_ENABLED must be true or false');
  if (environment.HEARTBEAT_TIMEOUT_SECONDS !== undefined && (typeof environment.HEARTBEAT_TIMEOUT_SECONDS !== 'string'
    || !/^[1-9][0-9]*$/.test(environment.HEARTBEAT_TIMEOUT_SECONDS) || Number(environment.HEARTBEAT_TIMEOUT_SECONDS)>2147483)) throw new Error('HEARTBEAT_TIMEOUT_SECONDS must be 1..2147483');
  if (environment.HEARTBEAT_SWEEPER_ENABLED !== undefined && !['true','false'].includes(String(environment.HEARTBEAT_SWEEPER_ENABLED))) throw new Error('HEARTBEAT_SWEEPER_ENABLED must be true or false');

  const corsOrigins = environment.CORS_ORIGINS === undefined
    ? []
    : String(environment.CORS_ORIGINS).split(',').map((origin) => origin.trim()).filter(Boolean);
  for (const origin of corsOrigins) {
    try {
      const parsed = new URL(origin);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
        throw new Error();
      }
    } catch {
      throw new Error('CORS_ORIGINS must be a comma-separated list of HTTP(S) origins');
    }
  }

  if (environment.SMTP_PORT !== undefined && String(environment.SMTP_PORT).trim() !== '') {
    const smtpPort = Number(environment.SMTP_PORT);
    if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
      throw new Error('SMTP_PORT must be an integer between 1 and 65535');
    }
  }
  if (environment.SMTP_SECURE !== undefined && String(environment.SMTP_SECURE).trim() !== '' && !['true', 'false'].includes(String(environment.SMTP_SECURE))) {
    throw new Error('SMTP_SECURE must be true or false');
  }

  return environment;
}

export default function configuration(): RuntimeConfiguration {
  return {
    app: {
      port: Number(process.env.PORT ?? 3000),
      corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
    },
    database: {
      host: process.env.DB_HOST ?? '',
      port: Number(process.env.DB_PORT ?? 3306),
      user: process.env.DB_USER ?? '',
      password: process.env.DB_PASSWORD ?? '',
      name: process.env.DB_NAME ?? '',
      connectionLimit: Number(process.env.DB_CONNECTION_LIMIT ?? 10),
    },
    auth: {
      accessTokenSecret: process.env.JWT_ACCESS_SECRET ?? '',
      refreshTokenSecret: process.env.JWT_REFRESH_SECRET ?? '',
      accessTokenTtlSeconds: Number(process.env.ACCESS_TOKEN_TTL_SECONDS ?? 900),
      refreshTokenTtlSeconds: Number(process.env.REFRESH_TOKEN_TTL_SECONDS ?? 2592000),
      adminEmail: process.env.ADMIN_EMAIL ?? '',
      adminPassword: process.env.ADMIN_PASSWORD ?? '',
      adminDisplayName: process.env.ADMIN_DISPLAY_NAME ?? '',
      adminSeedEnabled: process.env.ADMIN_SEED_ENABLED === 'true',
    },
    crypto: { encryptionKey: process.env.APP_ENCRYPTION_KEY ?? '' },
    toolExecution: {
      serviceToken: process.env.AI_TOOL_SERVICE_TOKEN ?? '',
      calendarWritesEnabled: process.env.CALENDAR_WRITES_ENABLED === 'true'
        && process.env.NODE_ENV === 'test' && process.env.MYSQL_INTEGRATION_TESTS === 'true'
        && process.env.DB_NAME === 'aiva_pa01_voice_clone'
        && process.env.DB_HOST === '127.0.0.1' && process.env.DB_PORT === '43316',
      voiceMutationSecret: process.env.VOICE_MUTATION_SECRET ?? '',
      productionCalendarTest: {
        enabled: process.env.PRODUCTION_CALENDAR_TEST_ENABLED === 'true',
        userId: process.env.PRODUCTION_CALENDAR_TEST_USER_ID ?? '',
        deviceId: process.env.PRODUCTION_CALENDAR_TEST_DEVICE_ID ?? '',
        expiresAt: process.env.PRODUCTION_CALENDAR_TEST_EXPIRES_AT ?? '',
        title: process.env.PRODUCTION_CALENDAR_TEST_TITLE ?? '',
        startsAt: process.env.PRODUCTION_CALENDAR_TEST_STARTS_AT ?? '',
        endsAt: process.env.PRODUCTION_CALENDAR_TEST_ENDS_AT ?? '',
        timezone: process.env.PRODUCTION_CALENDAR_TEST_TIMEZONE ?? '',
      },
    },
    smtp: {
      host: (process.env.SMTP_HOST ?? '').trim(),
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      user: (process.env.SMTP_USER ?? '').trim(),
      pass: process.env.SMTP_PASS ?? '',
      from: (process.env.SMTP_FROM ?? '').trim(),
    },
  };
}
