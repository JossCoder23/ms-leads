import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { ImportModule } from './import/import.module'; 
import { ConfigModule } from '@nestjs/config';
import { CheckInModule } from './check-in/check-in.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule, 
    ImportModule,
    CheckInModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
