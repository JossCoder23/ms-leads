// import * as dotenv from 'dotenv';
// dotenv.config();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  console.log('🔍 DATABASE_URL actual:', process.env.DATABASE_URL);
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
