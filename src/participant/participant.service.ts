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
          p.uuid,
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

  async addCompanion(eventId: number, parentId: string, data: any) {
    const client = await this.db.client.connect();

    try {
      await client.query('SET search_path TO events, public');
      await client.query('BEGIN');

      // 1. Insertar el nuevo participante (el acompañante)
      const insertParticipantQuery = `
        INSERT INTO "Participant" (names, paternal_surname, maternal_surname,document_number, phone, uuid)
        VALUES ($1, $2, $3, $4, gen_random_uuid())
        RETURNING id, uuid;
      `;
      const participantRes = await client.query(insertParticipantQuery, [
        data.names,
        data.paternal_surname,
        data.maternal_surname || '',
        data.document_number,
        data.phone,
      ]);
      const newParticipantId = participantRes.rows[0].id;

      // 2. Insertar la inscripción vinculándola al titular (parent_id)
      // Usamos el parentId (UUID del titular) para mantener la jerarquía
      const insertInscriptionQuery = `
        INSERT INTO "Inscription" (participant_id, event_id, relationship, parent_id, status, program)
        VALUES ($1, $2, $3, $4, 'PENDIENTE', $5);
      `;
      
      // El 'program' suele ser el mismo del titular en estos eventos
      await client.query(insertInscriptionQuery, [
        newParticipantId,
        eventId,
        data.relationship, // El parentesco (PADRE, MADRE, etc.)
        parentId,          // El UUID del titular que ya obtuviste en la búsqueda
        data.program || 'Acompañante' 
      ]);

      await client.query('COMMIT');
      return { success: true, message: 'Acompañante registrado con éxito' };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error al agregar acompañante:', error);
      throw new InternalServerErrorException('No se pudo registrar al acompañante');
    } finally {
      client.release();
    }
  }

}