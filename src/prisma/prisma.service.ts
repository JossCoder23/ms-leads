// src/prisma/prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  public client: Pool;

  constructor(private configService: ConfigService) {
    // Railway inyecta DATABASE_URL automáticamente
    const connectionString = this.configService.get<string>('DATABASE_URL');

    this.client = new Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false, // Obligatorio para Railway
      },
    });
  }

  async query(text: string, params?: any[]) {
    return this.client.query(text, params);
  }

  async onModuleInit() {
    try {
      await this.client.connect();
      console.log('🚀 DEPLOY SUCCESS: Conectado a PostgreSQL en la nube.');
    } catch (e: any) {
      console.error('❌ Error de conexión en deploy:', e.message);
    }
  }

  async onModuleDestroy() {
    await this.client.end();
  }
}