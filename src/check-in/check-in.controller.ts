import { Controller, Post, Body, Headers, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { CheckInService } from './check-in.service';

@Controller('check-in')
export class CheckInController {
  constructor(private readonly checkInService: CheckInService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async registerCheckIn(
    @Body('document_number') documentNumber: string,
    @Body('event_id') eventId: number,
    @Headers('x-user-id') scannedBy: string,
  ) {
    if (!documentNumber || !eventId) {
      throw new BadRequestException('Faltan datos en el body: document_number y event_id son obligatorios.');
    }
    
    if (!scannedBy) {
      throw new BadRequestException('No se pudo identificar al staff (Falta x-user-id).');
    }

    // Convertimos eventId a número por seguridad en caso llegue como string
    return this.checkInService.processCheckIn(documentNumber, Number(eventId), scannedBy);
  }
}