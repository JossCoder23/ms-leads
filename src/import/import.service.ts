import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as ExcelJS from 'exceljs';

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
      if (!row.getCell(1).value) continue;

      // Obtenemos un cliente del pool para manejar la transacción manualmente
      const client = await this.db.client.connect();

      try {
        await client.query('BEGIN'); // Iniciamos transacción

        // 1. PROCESAR TITULAR (UPSERT manual)
        const titularDoc = row.getCell(4).value.toString();
        const titularQuery = `
          INSERT INTO events."Participant" (document_number, paternal_surname, maternal_surname, names, phone, mail)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (document_number) 
          DO UPDATE SET phone = EXCLUDED.phone, mail = EXCLUDED.mail
          RETURNING id, uuid;
        `;
        
        const titularRes = await client.query(titularQuery, [
          titularDoc,
          row.getCell(5).value.toString(),
          row.getCell(6).value.toString(),
          `${row.getCell(7).value} ${row.getCell(8).value || ''}`.trim(),
          row.getCell(24).value?.toString(),
          row.getCell(25).value?.toString()
        ]);
        const titularId = titularRes.rows[0].id;

        // 2. INSCRIPCIÓN TITULAR
        const insTitularQuery = `
          INSERT INTO events."Inscription" (participant_id, event_id, relationship, program, user_id, status)
          VALUES ($1, $2, 'TITULAR', $3, $4, 'PENDIENTE');
        `;
        await client.query(insTitularQuery, [titularId, eventId, 'TITULAR', row.getCell(17).value?.toString(), adminId]);

        // 3. PROCESAR ACOMPAÑANTES
        for (const type of familyTypes) {
          const map = (familyMapping as any)[type];
          const famDoc = row.getCell(map.doc).value?.toString();

          if (famDoc) {
            const famQuery = `
              INSERT INTO "Participant" (document_number, paternal_surname, maternal_surname, names, phone, mail)
              VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT (document_number) DO UPDATE SET document_number = EXCLUDED.document_number
              RETURNING id;
            `;
            const famRes = await client.query(famQuery, [
              famDoc,
              row.getCell(map.pat).value?.toString(),
              row.getCell(map.mat).value?.toString(),
              row.getCell(map.nom).value?.toString(),
              row.getCell(map.tel).value?.toString(),
              row.getCell(map.mail).value?.toString()
            ]);
            const familiarId = famRes.rows[0].id;

            const insFamQuery = `
              INSERT INTO "Inscription" (participant_id, event_id, parent_id, relationship, user_id, status)
              VALUES ($1, $2, $3, $4, $5, 'PENDIENTE');
            `;
            await client.query(insFamQuery, [familiarId, eventId, titularDoc, type.toUpperCase(), adminId]);
          }
        }

        await client.query('COMMIT'); // Todo bien, guardamos
        results.success++;
      } catch (error: any) {
        await client.query('ROLLBACK'); // Error, revertimos la fila
        results.errors.push({ fila: i, error: error.message });
      } finally {
        client.release(); // Importante: liberamos el cliente de vuelta al pool
      }
    }
    return results;
  }
}