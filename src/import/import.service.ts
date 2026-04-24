import { Injectable } from '@nestjs/common';
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

    const familyTypes = ['madre', 'padre', 'hermano', 'abuelo', 'tio', 'primo'];
    const familyMapping = {
      madre: { doc: 49, pat: 45, mat: 46, nom: 47, mail: 52, tel: 53 },
      padre: { doc: 60, pat: 56, mat: 57, nom: 58, mail: 63, tel: 64 },
      hermano: { doc: 71, pat: 67, mat: 68, nom: 69, mail: 74, tel: 75 },
      abuelo: { doc: 82, pat: 78, mat: 79, nom: 80, mail: 85, tel: 86 },
      tio: { doc: 93, pat: 89, mat: 90, nom: 91, mail: 96, tel: 97 },
      primo: { doc: 104, pat: 100, mat: 101, nom: 102, mail: 107, tel: 108 },
    };

    for (let i = 2; i <= worksheet.rowCount; i++) {
      const row = worksheet.getRow(i);
      if (!row.getCell(4).value) continue;

      const client = await this.db.client.connect();

      try {
        await client.query('BEGIN');
        // Seteamos el esquema para no tener que poner events. en cada tabla
        await client.query('SET search_path TO events, public');

        // 1. PROCESAR TITULAR
        const titularDoc = row.getCell(4).value.toString();
        const titularQuery = `
          INSERT INTO "Participant" (uuid, document_number, paternal_surname, maternal_surname, names, phone, mail)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (document_number) DO UPDATE SET phone = $6, mail = $7
          RETURNING id, uuid;
        `;
        
        const titularRes = await client.query(titularQuery, [
          randomUUID(), // $1
          titularDoc,   // $2
          row.getCell(5).value?.toString() || '', // $3
          row.getCell(6).value?.toString() || '', // $4
          `${row.getCell(7).value || ''} ${row.getCell(8).value || ''}`.trim(), // $5
          row.getCell(24).value?.toString() || null, // $6
          row.getCell(25).value?.toString() || null  // $7
        ]);
        const titularId = titularRes.rows[0].id;
        const titularUuid = titularRes.rows[0].uuid;

        // 2. INSCRIPCIÓN TITULAR (Corregido: Tenías 5 params y 4 $)
        const insTitularQuery = `
          INSERT INTO "Inscription" (participant_id, event_id, relationship, program, user_id, status)
          VALUES ($1, $2, $3, $4, $5, 'PENDIENTE');
        `;
        // Pasamos exactamente 5 parámetros para los 5 marcadores $
        await client.query(insTitularQuery, [
          titularId,     // $1
          eventId,       // $2
          'TITULAR',     // $3
          row.getCell(17).value?.toString() || null, // $4
          adminId        // $5
        ]);

        // 3. PROCESAR ACOMPAÑANTES
        for (const type of familyTypes) {
          const map = (familyMapping as any)[type];
          const famDoc = row.getCell(map.doc).value?.toString();

          if (famDoc) {
            const famQuery = `
              INSERT INTO "Participant" (uuid, document_number, paternal_surname, maternal_surname, names, phone, mail)
              VALUES ($1, $2, $3, $4, $5, $6, $7)
              ON CONFLICT (document_number) DO UPDATE SET document_number = EXCLUDED.document_number
              RETURNING id;
            `;
            const famRes = await client.query(famQuery, [
              randomUUID(), // $1
              famDoc,       // $2
              row.getCell(map.pat).value?.toString() || '',
              row.getCell(map.mat).value?.toString() || '',
              row.getCell(map.nom).value?.toString() || '',
              row.getCell(map.tel).value?.toString() || null,
              row.getCell(map.mail).value?.toString() || null
            ]);
            const familiarId = famRes.rows[0].id;

            const insFamQuery = `
              INSERT INTO "Inscription" (participant_id, event_id, parent_id, relationship, user_id, status)
              VALUES ($1, $2, $3, $4, $5, 'PENDIENTE');
            `;
            await client.query(insFamQuery, [
              familiarId,   // $1
              eventId,      // $2
              titularUuid,  // $3 (Relación por UUID)
              type.toUpperCase(), // $4
              adminId       // $5
            ]);
          }
        }

        await client.query('COMMIT');
        results.success++;
      } catch (error: any) {
        await client.query('ROLLBACK');
        results.errors.push({ fila: i, error: error.message });
      } finally {
        client.release();
      }
    }
    return results;
  }
}