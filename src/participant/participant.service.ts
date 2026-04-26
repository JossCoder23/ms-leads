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

  // async findTitularByDocument(eventId: number, documentNumber: string) {
  //   const client = await this.db.client.connect();

  //   try {
  //     await client.query('SET search_path TO events, public');

  //     const query = `
  //       SELECT 
  //         p.id as participant_id,
  //         p.uuid,
  //         p.document_number,
  //         p.names,
  //         p.paternal_surname,
  //         p.maternal_surname,
  //         i.program,
  //         i.status,
  //         i.id as inscription_id,
  //         -- Subconsulta para traer acompañantes como un array de objetos JSON
  //         (
  //           SELECT COALESCE(json_agg(companion_data), '[]'::json)
  //           FROM (
  //             SELECT 
  //               p2.document_number,
  //               p2.names,
  //               p2.paternal_surname,
  //               p2.maternal_surname,
  //               i2.relationship,
  //               i2.status
  //             FROM "Inscription" i2
  //             JOIN "Participant" p2 ON i2.participant_id = p2.id
  //             WHERE i2.parent_id = p.uuid -- Buscamos por el UUID del titular
  //               AND i2.event_id = $1
  //           ) companion_data
  //         ) as companions
  //       FROM "Inscription" i
  //       JOIN "Participant" p ON i.participant_id = p.id
  //       WHERE i.relationship = 'TITULAR' 
  //         AND i.event_id = $1
  //         AND p.document_number = $2
  //       LIMIT 1;
  //     `;

  //     const res = await client.query(query, [eventId, documentNumber]);
      
  //     return res.rows.length > 0 ? res.rows[0] : null;
  //   } catch (error) {
  //     console.error('Error searching titular:', error);
  //     throw new InternalServerErrorException('Error en la búsqueda del participante');
  //   } finally {
  //     client.release();
  //   }
  // }

  async findParticipantByDocument(eventId: number, documentNumber: string) {
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
            i.relationship, -- Añadimos el rol para saber qué es
            i.id as inscription_id,
            i.parent_id,    -- Para saber quién es su titular si es acompañante
            -- Subconsulta para traer acompañantes (solo si es titular)
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
                WHERE i2.parent_id = p.uuid 
                  AND i2.event_id = $1
              ) companion_data
            ) as companions
          FROM "Inscription" i
          JOIN "Participant" p ON i.participant_id = p.id
          WHERE i.event_id = $1
            AND p.document_number = $2
          LIMIT 1;
        `;

        const res = await client.query(query, [eventId, documentNumber]);
        
        return res.rows.length > 0 ? res.rows[0] : null;
      } catch (error) {
        console.error('Error searching participant:', error);
        throw new InternalServerErrorException('Error en la búsqueda del participante');
      } finally {
        client.release();
      }
  }

  async addCompanion(eventId: number, parentId: string, data: any, staffId: string) {
    const client = await this.db.client.connect();

    try {
      await client.query('SET search_path TO events, public');
      await client.query('BEGIN');

      // 1. Manejo del Participante (Upsert para evitar error de DNI duplicado)
      const upsertParticipantQuery = `
        INSERT INTO "Participant" (names, paternal_surname, maternal_surname, document_number, phone, uuid)
        VALUES ($1, $2, $3, $4, $5, gen_random_uuid())
        ON CONFLICT (document_number) 
        DO UPDATE SET 
            names = EXCLUDED.names,
            paternal_surname = EXCLUDED.paternal_surname,
            maternal_surname = EXCLUDED.maternal_surname,
            phone = EXCLUDED.phone
        RETURNING id;
      `;
      
      const participantRes = await client.query(upsertParticipantQuery, [
        data.names,
        data.paternal_surname,
        data.maternal_surname || '',
        data.document_number,
        data.phone || '',
      ]);
      const participantId = participantRes.rows[0].id;

      // 2. Manejo de la Inscripción (Obtenemos el ID de la inscripción, NO del participante)
      const checkInscription = await client.query(
        `SELECT id FROM "Inscription" WHERE participant_id = $1 AND event_id = $2 LIMIT 1`,
        [participantId, eventId]
      );

      let inscriptionId: number;

      if (checkInscription.rows.length > 0) {
          inscriptionId = checkInscription.rows[0].id;
          // Si ya existía, nos aseguramos de que el estado sea ASISTIÓ
          await client.query(
              `UPDATE "Inscription" SET status = 'ASISTIÓ' WHERE id = $1`,
              [inscriptionId]
          );
      } else {
          const insertInscriptionQuery = `
            INSERT INTO "Inscription" (participant_id, event_id, relationship, parent_id, status, program, user_id)
            VALUES ($1, $2, $3, $4, 'ASISTIÓ', $5, $6)
            RETURNING id;
          `;
          const insRes = await client.query(insertInscriptionQuery, [
            participantId,
            eventId,
            data.relationship,
            parentId,
            data.program || 'Acompañante',
            staffId
          ]);
          inscriptionId = insRes.rows[0].id;
      }

      // 3. Obtener el punto de interacción del staff
      const pointRes = await client.query(
          `SELECT point_interaction_id FROM "UserInteractionPoint" WHERE user_id = $1 LIMIT 1`,
          [staffId]
      );
      const pointId = pointRes.rows[0]?.point_interaction_id;

      if (!pointId) {
          throw new Error('El staff no tiene un punto de interacción asignado.');
      }

      // 4. Registro en Interaction (Usando el inscriptionId real)
      // Esto soluciona el error de Foreign Key de Railway
      const checkInteraction = await client.query(
          `SELECT id FROM "Interaction" WHERE inscription_id = $1 AND type_interaction = 'CHECK_IN' LIMIT 1`,
          [inscriptionId]
      );

      if (checkInteraction.rows.length === 0) {
          const insertInteractionQuery = `
            INSERT INTO "Interaction" (
              inscription_id, 
              point_interaction_id, 
              type_interaction, 
              scanned_by
            )
            VALUES ($1, $2, 'CHECK_IN', $3);
          `;
          await client.query(insertInteractionQuery, [inscriptionId, pointId, staffId]);
      }

      await client.query('COMMIT');

      return { 
        success: true, 
        message: 'Registro y asistencia del acompañante completados',
        data: {
          participant_id: participantId,
          inscription_id: inscriptionId
        }
      };

    } catch (error: any) {
      await client.query('ROLLBACK');
      console.error('Error detallado:', error.message);
      throw new InternalServerErrorException(error.message || 'Error al procesar acompañante');
    } finally {
      client.release();
    }
  }

}