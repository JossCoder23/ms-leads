// src/import/import.controller.ts
import { Controller, Post, UploadedFile, UseInterceptors, Headers, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImportService } from './import.service';

@Controller('import')
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  @Post('excel')
  @UseInterceptors(FileInterceptor('file', {
    limits: {
      fileSize: 30 * 1024 * 1024, // 30 MB
    },
  }))
  async uploadExcel(
    @UploadedFile() file: Express.Multer.File,
    @Headers('x-user-id') adminId: string,
  ) {
    if (!file) {
      throw new BadRequestException('No se recibió el archivo. Verifica que la Key en Postman sea "file" y de tipo File.');
    }
    return this.importService.importFromExcel(file.buffer, adminId);
  }
}