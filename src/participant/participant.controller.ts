import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { ParticipantsService } from './participant.service';

@Controller('participants')
export class ParticipantsController {
  constructor(private readonly participantsService: ParticipantsService) {}

  @Get('')
  async getTitulars(@Query('event_id') eventId: string) {
    if (!eventId) {
      throw new BadRequestException('El event_id es obligatorio como query parameter');
    }
    
    return this.participantsService.findAllTitulars(Number(eventId));
  }
}