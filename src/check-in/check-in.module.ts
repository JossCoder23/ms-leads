import { Module } from '@nestjs/common';
import { CheckInController } from './check-in.controller';
import { CheckInService } from './check-in.service';
// IMPORTANTE: Ajusta esta ruta a donde tengas definido tu módulo de base de datos
import { PrismaModule } from '../prisma/prisma.module'; 

@Module({
  imports: [PrismaModule], // Inyectamos el módulo de BD para que el servicio pueda usar this.db.client
  controllers: [CheckInController],
  providers: [CheckInService],
})
export class CheckInModule {}