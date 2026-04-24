// src/import/import.controller.ts
import { Controller, Post, UploadedFile, UseInterceptors, Headers } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImportService } from './import.service';

@Controller('import')
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  @Post('excel')
  @UseInterceptors(FileInterceptor('file'))
  async uploadExcel(
    @UploadedFile() file: Express.Multer.File,
    @Headers('x-user-id') adminId: string,
  ) {
    return this.importService.importFromExcel(file.buffer, adminId);
  }
}