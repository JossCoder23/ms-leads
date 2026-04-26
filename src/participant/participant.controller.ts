import { Controller, Get, Query, BadRequestException, NotFoundException, Param, Body, Headers, Post } from '@nestjs/common';
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

  @Get('/companions-list')
  async getCompanions(@Query('event_id') eventId: string) {
    return await this.participantsService.getAllCompanions(Number(eventId));
  }

  @Get('/:document_number')
  async searchTitular(
    @Param('document_number') documentNumber: string,
    @Query('event_id') eventId: string
  ) {
    if (!eventId) {
      throw new BadRequestException('El event_id es obligatorio');
    }

    const participant = await this.participantsService.findTitularByDocument(
      Number(eventId), 
      documentNumber
    );

    if (!participant) {
      throw new NotFoundException(`No se encontró un titular con el documento ${documentNumber}`);
    }

    return participant;
  }

  @Post('/companion')
  async createCompanion(
    @Body() body: any,
    @Headers('x-user-id') staffId: string
  ) {
    const { event_id, parent_uuid, ...companionData } = body;

    if (!staffId) {
       throw new BadRequestException('No se identificó al usuario que realiza el registro (x-user-id missing)');
    }

    if (!event_id || !parent_uuid) {
      throw new BadRequestException('Faltan datos obligatorios (event_id o parent_uuid)');
    }

    return this.participantsService.addCompanion(
      Number(event_id),
      parent_uuid,
      companionData,
      staffId
    );
  }

}