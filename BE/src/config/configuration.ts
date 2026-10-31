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
  const isolatedTest=environment.NODE_ENV==='test'&&environment.MYSQL_INTEGRATION_TESTS==='true';
  if(environment.NODE_ENV==='test'&&!isolatedTest) {
    throw new Error('NODE_ENV=test requires MYSQL_INTEGRATION_TESTS=true and an isolated DB_NAME');
  }
  if(isolatedTest){
    if(typeof environment.DB_NAME!=='string'||!/^aiva_iot_test(?:_[a-z0-9_]+)?$/.test(environment.DB_NAME)) {
      throw new Error('Isolated MySQL tests require DB_NAME=aiva_iot_test or aiva_iot_test_<suffix>; aiva_iot is forbidden');
    }
  } else if (environment.DB_NAME !== 'aiva_iot') {
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

  const heartbeatTimeout=environment.HEARTBEAT_TIMEOUT_SECONDS;
  if(heartbeatTimeout!==undefined && (typeof heartbeatTimeout!=='string'||!/^\d+$/.test(heartbeatTimeout)
    ||Number(heartbeatTimeout)<1||Number(heartbeatTimeout)>2147483)) {
    throw new Error('HEARTBEAT_TIMEOUT_SECONDS must be an integer between 1 and 2147483');
  }
  if(environment.HEARTBEAT_SWEEPER_ENABLED!==undefined&&!['true','false'].includes(environment.HEARTBEAT_SWEEPER_ENABLED as string)) {
    throw new Error('HEARTBEAT_SWEEPER_ENABLED must be true or false');
  }
  for(const flag of ['AI_QUOTA_CONTRACT_APPROVED','AI_USAGE_REPORT_SWEEPER_ENABLED']){
    if(environment[flag]!==undefined&&!['true','false'].includes(environment[flag] as string))throw new Error(`${flag} must be true or false`);
  }
  const quotaEnabled=environment.AI_QUOTA_CONTRACT_APPROVED==='true';
  const reportWorker=environment.AI_USAGE_REPORT_SWEEPER_ENABLED==='true';
  const reportTimeout=environment.AI_USAGE_REPORT_TIMEOUT_SECONDS;
  if(quotaEnabled||reportWorker||(reportTimeout!==undefined&&reportTimeout!=='')){
    if(typeof reportTimeout!=='string'||!/^\d+$/.test(reportTimeout)||Number(reportTimeout)<1||Number(reportTimeout)>2147483)throw new Error('AI_USAGE_REPORT_TIMEOUT_SECONDS must be configured between 1 and 2147483');
  }
  if(quotaEnabled&&(typeof environment.AI_QUOTA_SERVICE_TOKEN!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(environment.AI_QUOTA_SERVICE_TOKEN)))throw new Error('AI_QUOTA_SERVICE_TOKEN must be a separate configured service token');

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
