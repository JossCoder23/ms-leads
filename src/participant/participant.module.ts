import { Module } from '@nestjs/common';
import { ParticipantsController } from './participant.controller';
import { ParticipantsService } from './participant.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ParticipantsController],
  providers: [ParticipantsService],
})
export class ParticipantsModule {}