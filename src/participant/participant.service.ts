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

  async findTitularByDocument(eventId: number, documentNumber: string) {
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
          AND p.document_number = $2 -- Búsqueda exacta
        LIMIT 1;
      `;

      const res = await client.query(query, [eventId, documentNumber]);
      
      if (res.rows.length === 0) {
        return null; // O podrías lanzar un NotFoundException
      }

      return res.rows[0];
    } catch (error) {
      console.error('Error searching titular:', error);
      throw new InternalServerErrorException('Error en la búsqueda del participante');
    } finally {
      client.release();
    }
  }

}