import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ParticipantsService {
  constructor(private db: PrismaService) {}

  async findAllTitulars(eventId: number) {
    const client = await this.db.client.connect();

    try {
      await client.query('SET search_path TO events, public');

      const query = `
        SELECT 
          p.document_number,
          p.names,
          p.paternal_surname,
          p.maternal_surname,
          i.program,
          i.status,
          i.id as inscription_id,
          p.id as participant_id
        FROM "Inscription" i
        JOIN "Participant" p ON i.participant_id = p.id
        WHERE i.relationship = 'TITULAR' 
          AND i.event_id = $1
        ORDER BY p.paternal_surname ASC;
      `;

      const res = await client.query(query, [eventId]);
      return res.rows;
    } catch (error) {
      console.error('Error fetching titulars:', error);
      throw new InternalServerErrorException('Error al obtener la lista de titulares');
    } finally {
      client.release();
    }
  }
}