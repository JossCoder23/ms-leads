import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as ExcelJS from 'exceljs';
import { randomUUID } from 'crypto';

@Injectable()
export class ImportService {
  constructor(private db: PrismaService) {}

  async importFromExcel(buffer: Buffer, adminId: string) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const worksheet = workbook.getWorksheet(1);

    const results = { success: 0, errors: [] };
    const eventId = 1;

    for (let i = 2; i <= worksheet.rowCount; i++) {
      const row = worksheet.getRow(i);
      
      // Limpieza estricta de DNIs
      const titularDoc = row.getCell(5).value?.toString()?.trim();
      const famDoc = row.getCell(14).value?.toString()?.trim();

      // REGLA DE ORO: Si el DNI es muy corto o nulo, saltamos la fila
      if (!titularDoc || titularDoc.length < 5) continue;

      const client = await this.db.client.connect();

      try {
        await client.query('BEGIN');
        await client.query('SET search_path TO events, public');

        // ==========================================
        // 1. PROCESAR TITULAR (UPSERT)
        // ==========================================
        const titularQuery = `
          INSERT INTO "Participant" (uuid, document_number, paternal_surname, maternal_surname, names, phone, mail)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (document_number) DO UPDATE SET 
            paternal_surname = EXCLUDED.paternal_surname,
            names = EXCLUDED.names
          RETURNING id, uuid;
        `;
        
        const titularRes = await client.query(titularQuery, [
          randomUUID(),
          titularDoc,
          row.getCell(1).value?.toString()?.trim() || '',
          row.getCell(2).value?.toString()?.trim() || '',
          row.getCell(3).value?.toString()?.trim() || '',
          row.getCell(7).value?.toString()?.trim() || null,
          row.getCell(6).value?.toString()?.trim() || null
        ]);
        
        const titularId = titularRes.rows[0].id;
        const titularUuid = titularRes.rows[0].uuid;

        // INSCRIPCIÓN TITULAR (Con ON CONFLICT para no duplicar tickets)
        const insTitularQuery = `
          INSERT INTO "Inscription" (participant_id, event_id, relationship, program, user_id, status)
          VALUES ($1, $2, 'TITULAR', $3, $4, 'PENDIENTE')
          ON CONFLICT (participant_id, event_id) DO UPDATE SET program = EXCLUDED.program;
        `;
        await client.query(insTitularQuery, [
          titularId, 
          eventId, 
          row.getCell(9).value?.toString()?.trim() || 'Interesado',
          adminId
        ]);

        // ==========================================
        // 2. PROCESAR ACOMPAÑANTE (Si existe DNI válido)
        // ==========================================
        if (famDoc && famDoc.length >= 5 && famDoc !== titularDoc) {
          const famQuery = `
            INSERT INTO "Participant" (uuid, document_number, paternal_surname, maternal_surname, names, phone, mail)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (document_number) DO UPDATE SET names = EXCLUDED.names
            RETURNING id;
          `;
          const famRes = await client.query(famQuery, [
            randomUUID(),
            famDoc,
            row.getCell(11).value?.toString()?.trim() || '',
            '', // Materno
            row.getCell(12).value?.toString()?.trim() || '',
            null,
            null
          ]);
          const familiarId = famRes.rows[0].id;

          // Validamos parentezco: NUNCA puede ser TITULAR si viene de la col 14
          let parentezco = row.getCell(15).value?.toString()?.toUpperCase()?.trim() || 'ACOMPAÑANTE';
          if (parentezco === 'TITULAR') parentezco = 'ACOMPAÑANTE';

          const insFamQuery = `
            INSERT INTO "Inscription" (participant_id, event_id, parent_id, relationship, user_id, status, program)
            VALUES ($1, $2, $3, $4, $5, 'PENDIENTE', 'Acompañante')
            ON CONFLICT (participant_id, event_id) DO UPDATE SET relationship = EXCLUDED.relationship;
          `;
          await client.query(insFamQuery, [
            familiarId,
            eventId,
            titularUuid,
            parentezco,
            adminId
          ]);
        }

        await client.query('COMMIT');
        results.success++;
      } catch (error: any) {
        await client.query('ROLLBACK');
        results.errors.push({ fila: i, dni: titularDoc, error: error.message });
      } finally {
        client.release();
      }
    }

    return { success: results.success, errors: results.errors };
  }
}