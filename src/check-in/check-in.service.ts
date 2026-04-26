import { 
  Injectable, 
  NotFoundException, 
  ConflictException, 
  ForbiddenException, 
  InternalServerErrorException 
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CheckInService {
  constructor(private db: PrismaService) {}

  async processCheckIn(documentNumber: string, eventId: number, scannedBy: string) {
    const client = await this.db.client.connect();

    try {
      // 1. Apuntamos al esquema de eventos
      await client.query('SET search_path TO events, public');

      // ==========================================
      // 2. BUSCAR EL PUNTO ASIGNADO AL STAFF
      // ==========================================
      const userAssignmentQuery = `
        SELECT ip.id, ip.name 
        FROM "UserInteractionPoint" uip
        JOIN "PointInteraction" ip ON uip.point_interaction_id = ip.id
        WHERE uip.user_id = $1 
        LIMIT 1;
      `;
      const userAssignmentRes = await client.query(userAssignmentQuery, [scannedBy]);

      if (userAssignmentRes.rows.length === 0) {
        throw new ForbiddenException('ACCESO DENEGADO: Tu usuario no tiene un punto de interacción asignado.');
      }

      const pointInteractionId = userAssignmentRes.rows[0].id;
      const pointInteractionName = userAssignmentRes.rows[0].name;

      // ==========================================
      // 3. VALIDAR AL PARTICIPANTE Y SU INSCRIPCIÓN
      // ==========================================
      const participantQuery = `SELECT id, uuid, names, paternal_surname FROM "Participant" WHERE document_number = $1;`;
      const participantRes = await client.query(participantQuery, [documentNumber]);

      if (participantRes.rows.length === 0) {
        throw new NotFoundException('El documento escaneado no pertenece a ningún participante registrado.');
      }
      const participant = participantRes.rows[0];

      const inscriptionQuery = `SELECT id, program, relationship, status FROM "Inscription" WHERE participant_id = $1 AND event_id = $2;`;
      const inscriptionRes = await client.query(inscriptionQuery, [participant.id, eventId]);

      if (inscriptionRes.rows.length === 0) {
        throw new ForbiddenException('El participante existe, pero NO está inscrito en este evento.');
      }
      const inscription = inscriptionRes.rows[0];

      if (inscription.status === 'ASISTIÓ') {
        throw new ConflictException('INGRESO DENEGADO: Este participante ya registró su ingreso previamente.');
      }

        // ==========================================
        // NUEVA BARRERA: Evitar duplicados en Interaction
        // ==========================================
        const duplicateInteractionQuery = `
        SELECT id 
        FROM "Interaction" 
        WHERE inscription_id = $1 
            AND point_interaction_id = $2 
            AND type_interaction = 'CHECK_IN'
        LIMIT 1;
        `;
        // Recuerda que aquí inscription.id o participant.id depende de lo que decidiste guardar
        const duplicateRes = await client.query(duplicateInteractionQuery, [participant.id, pointInteractionId]);

        if (duplicateRes.rows.length > 0) {
            // Opción A: Lanzar error (Conflict)
            // throw new ConflictException('AVISO: Esta interacción ya fue registrada en este punto.');
            
            // Opción B: Simplemente retornar éxito sin insertar (Silent Success)
            return { success: true, message: 'Ya ha sido registrado anteriormente'};
        }

      // ==========================================
      // 4. TRANSACCIÓN ATÓMICA (UPDATE + INSERT)
      // ==========================================
      await client.query('BEGIN'); 

      // A) Actualizar el estado a ASISTIÓ
      const updateInscriptionQuery = `UPDATE "Inscription" SET status = 'ASISTIÓ' WHERE id = $1;`;
      await client.query(updateInscriptionQuery, [inscription.id]);

      // B) Registrar la interacción con las columnas exactas de tu BD
      const insertInteractionQuery = `
        INSERT INTO "Interaction" (
          inscription_id, 
          point_interaction_id, 
          type_interaction, 
          scanned_by
        )
        VALUES ($1, $2, 'CHECK_IN', $3);
      `;
      await client.query(insertInteractionQuery, [inscription.id, pointInteractionId, scannedBy]);

      await client.query('COMMIT'); 

      // ==========================================
      // 5. BUSCAR ACOMPAÑANTES PARA LA PANTALLA
      // ==========================================
      const companionsQuery = `
        SELECT p.document_number, p.names, p.paternal_surname, i.relationship, i.status
        FROM "Inscription" i
        JOIN "Participant" p ON i.participant_id = p.id
        WHERE i.parent_id = $1 AND i.event_id = $2;
      `;
      const companionsRes = await client.query(companionsQuery, [participant.uuid, eventId]);

      return {
        success: true,
        message: 'INGRESO AUTORIZADO',
        point_used: pointInteractionName,
        titular: {
          names: `${participant.names} ${participant.paternal_surname}`,
          program: inscription.program,
          relationship: inscription.relationship
        },
        companions: companionsRes.rows.map(comp => ({
          document_number: comp.document_number,
          names: `${comp.names} ${comp.paternal_surname}`,
          relationship: comp.relationship,
          status: comp.status
        }))
      };

    } catch (error: any) {
      await client.query('ROLLBACK'); 
      if (error.status) throw error; // Dejamos pasar los errores HTTP controlados (404, 409)
      console.error('Error en check-in:', error.message);
      throw new InternalServerErrorException('Error interno al procesar el ingreso');
    } finally {
      client.release(); 
    }
  }
}