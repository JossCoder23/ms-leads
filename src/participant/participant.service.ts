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
          p.uuid,
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
          p.id as participant_id,
          p.uuid,
          p.document_number,
          p.names,
          p.paternal_surname,
          p.maternal_surname,
          i.program,
          i.status,
          i.id as inscription_id,
          -- Subconsulta para traer acompañantes como un array de objetos JSON
          (
            SELECT COALESCE(json_agg(companion_data), '[]'::json)
            FROM (
              SELECT 
                p2.document_number,
                p2.names,
                p2.paternal_surname,
                p2.maternal_surname,
                i2.relationship,
                i2.status
              FROM "Inscription" i2
              JOIN "Participant" p2 ON i2.participant_id = p2.id
              WHERE i2.parent_id = p.uuid -- Buscamos por el UUID del titular
                AND i2.event_id = $1
            ) companion_data
          ) as companions
        FROM "Inscription" i
        JOIN "Participant" p ON i.participant_id = p.id
        WHERE i.relationship = 'TITULAR' 
          AND i.event_id = $1
          AND p.document_number = $2
        LIMIT 1;
      `;

      const res = await client.query(query, [eventId, documentNumber]);
      
      return res.rows.length > 0 ? res.rows[0] : null;
    } catch (error) {
      console.error('Error searching titular:', error);
      throw new InternalServerErrorException('Error en la búsqueda del participante');
    } finally {
      client.release();
    }
  }

  // async addCompanion(eventId: number, parentId: string, data: any, staffId:string) {
  //   const client = await this.db.client.connect();

  //   try {
  //     await client.query('SET search_path TO events, public');
  //     await client.query('BEGIN');

  //     // 1. Insertar el nuevo participante (el acompañante)
  //     const insertParticipantQuery = `
  //       INSERT INTO "Participant" (names, paternal_surname, maternal_surname, document_number, phone, uuid)
  //       VALUES ($1, $2, $3, $4, $5, gen_random_uuid())
  //       RETURNING id, uuid;
  //     `;
  //     const participantRes = await client.query(insertParticipantQuery, [
  //       data.names,
  //       data.paternal_surname,
  //       data.maternal_surname || '',
  //       data.document_number,
  //       data.phone,
  //     ]);
  //     const newParticipantId = participantRes.rows[0].id;

  //     // 2. Insertar la inscripción vinculándola al titular (parent_id)
  //     // Usamos el parentId (UUID del titular) para mantener la jerarquía
  //     const insertInscriptionQuery = `
  //       INSERT INTO "Inscription" (participant_id, event_id, relationship, parent_id, status, program, user_id)
  //       VALUES ($1, $2, $3, $4, 'PENDIENTE', $5, $6);
  //     `;
      
  //     // El 'program' suele ser el mismo del titular en estos eventos
  //     await client.query(insertInscriptionQuery, [
  //       newParticipantId,
  //       eventId,
  //       data.relationship, // El parentesco (PADRE, MADRE, etc.)
  //       parentId,          // El UUID del titular que ya obtuviste en la búsqueda
  //       data.program || 'Acompañante' ,
  //       staffId
  //     ]);

  //     await client.query('COMMIT');
  //     return { success: true, message: 'Acompañante registrado con éxito' };
  //   } catch (error) {
  //     await client.query('ROLLBACK');
  //     console.error('Error al agregar acompañante:', error);
  //     throw new InternalServerErrorException('No se pudo registrar al acompañante');
  //   } finally {
  //     client.release();
  //   }
  // }

  async addCompanion(eventId: number, parentId: string, data: any, staffId: string) {
      const client = await this.db.client.connect();

      try {
        await client.query('SET search_path TO events, public');
        await client.query('BEGIN');

        // 1. Insertar el nuevo participante (el acompañante)
        const insertParticipantQuery = `
          INSERT INTO "Participant" (names, paternal_surname, maternal_surname, document_number, phone, uuid)
          VALUES ($1, $2, $3, $4, $5, gen_random_uuid())
          RETURNING id;
        `;
        const participantRes = await client.query(insertParticipantQuery, [
          data.names,
          data.paternal_surname,
          data.maternal_surname || '',
          data.document_number,
          data.phone,
        ]);
        const newParticipantId = participantRes.rows[0].id;

        // 2. Insertar la inscripción directamente como 'ASISTIÓ'
        // Ya que si el staff lo está registrando manualmente, es porque lo tiene al frente ingresando.
        const insertInscriptionQuery = `
          INSERT INTO "Inscription" (participant_id, event_id, relationship, parent_id, status, program, user_id)
          VALUES ($1, $2, $3, $4, 'ASISTIÓ', $5, $6)
          RETURNING id;
        `;
        
        const inscriptionRes = await client.query(insertInscriptionQuery, [
          newParticipantId,
          eventId,
          data.relationship, 
          parentId,          
          data.program || 'Acompañante',
          staffId
        ]);
        const newInscriptionId = inscriptionRes.rows[0].id;

        // 3. Obtener el punto de interacción del staff para registrar el ingreso
        const pointQuery = `SELECT point_interaction_id FROM "UserInteractionPoint" WHERE user_id = $1 LIMIT 1;`;
        const pointRes = await client.query(pointQuery, [staffId]);
        const pointId = pointRes.rows[0]?.point_interaction_id;

        if (!pointId) {
          throw new Error('El staff no tiene un punto de interacción asignado.');
        }

        // 4. Generar el registro en la tabla Interaction
        const insertInteractionQuery = `
          INSERT INTO "Interaction" (
            inscription_id, 
            point_interaction_id, 
            type_interaction, 
            scanned_by
          )
          VALUES ($1, $2, 'CHECK_IN', $3);
        `;
        
        // Usamos el ID del participante (newParticipantId) como en tu lógica de check-in actual
        await client.query(insertInteractionQuery, [newParticipantId, pointId, staffId]);

        await client.query('COMMIT');

        return { 
          success: true, 
          message: 'Acompañante registrado e ingreso marcado correctamente',
          data: {
            participant_id: newParticipantId,
            status: 'ASISTIÓ'
          }
        };

      } catch (error:any) {
        await client.query('ROLLBACK');
        console.error('Error al registrar acompañante en puerta:', error.message);
        throw new InternalServerErrorException('No se pudo completar el registro del acompañante');
      } finally {
        client.release();
      }
  }

}