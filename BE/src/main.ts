import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  app.enableCors({ origin: config.getOrThrow<string[]>('app.corsOrigins'), credentials: true });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  }));
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('AIVA-IoT Backend API')
    .setDescription('REST API for the AIVA-IoT web application. Device wire protocol is documented separately and is not implemented here.')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig), { jsonDocumentUrl: 'api/docs-json' });
  const host = config.get<string>('BE_HOST') ?? '127.0.0.1';
  await app.listen(config.getOrThrow<number>('app.port'), host);
}

void bootstrap();
