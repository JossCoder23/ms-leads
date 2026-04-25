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
    const eventId = 1; // ID de Open Cayetano 2026

    for (let i = 2; i <= worksheet.rowCount; i++) {
      const row = worksheet.getRow(i);
      
      // Columna 5: NroDocumento (Titular)
      const titularDoc = row.getCell(5).value?.toString();
      if (!titularDoc) continue;

      const client = await this.db.client.connect();

      try {
        await client.query('BEGIN');
        await client.query('SET search_path TO events, public');

        // ==========================================
        // 1. PROCESAR TITULAR
        // ==========================================
        const titularQuery = `
          INSERT INTO "Participant" (uuid, document_number, paternal_surname, maternal_surname, names, phone, mail)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (document_number) DO UPDATE SET phone = $6, mail = $7
          RETURNING id, uuid;
        `;
        
        const titularRes = await client.query(titularQuery, [
          randomUUID(),
          titularDoc,
          row.getCell(1).value?.toString() || '',   // ApellidoPaterno
          row.getCell(2).value?.toString() || '',   // ApellidoMaterno
          row.getCell(3).value?.toString() || '',   // Nombres
          row.getCell(7).value?.toString() || null, // Celular
          row.getCell(6).value?.toString() || null  // Correo
        ]);
        const titularId = titularRes.rows[0].id;
        const titularUuid = titularRes.rows[0].uuid;

        // 2. INSCRIPCIÓN TITULAR
        const insTitularQuery = `
          INSERT INTO "Inscription" (participant_id, event_id, relationship, program, user_id, status)
          VALUES ($1, $2, $3, $4, $5, 'PENDIENTE');
        `;
        await client.query(insTitularQuery, [
          titularId, 
          eventId, 
          'TITULAR', 
          row.getCell(9).value?.toString() || null, // Programa
          adminId
        ]);

        // ==========================================
        // 3. PROCESAR ACOMPAÑANTE (Si existe)
        // ==========================================
        const famDoc = row.getCell(14).value?.toString(); // NroDocumentoAcompanante

        if (famDoc) {
          const famQuery = `
            INSERT INTO "Participant" (uuid, document_number, paternal_surname, maternal_surname, names, phone, mail)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (document_number) DO UPDATE SET document_number = EXCLUDED.document_number
            RETURNING id;
          `;
          const famRes = await client.query(famQuery, [
            randomUUID(),
            famDoc,
            row.getCell(11).value?.toString() || '', // ApellidoAcompanante (Va a Paterno)
            '',                                      // Materno (Ya no hay columna separada)
            row.getCell(12).value?.toString() || '', // NombreAcompanante
            null,                                    // Celular Acompañante (No hay en Excel)
            null                                     // Correo Acompañante (No hay en Excel)
          ]);
          const familiarId = famRes.rows[0].id;

          // Obtenemos el parentezco de la columna 15, si está vacío por defecto es 'ACOMPAÑANTE'
          const parentezcoRaw = row.getCell(15).value?.toString() || 'ACOMPAÑANTE';

          const insFamQuery = `
            INSERT INTO "Inscription" (participant_id, event_id, parent_id, relationship, user_id, status)
            VALUES ($1, $2, $3, $4, $5, 'PENDIENTE');
          `;
          await client.query(insFamQuery, [
            familiarId,
            eventId,
            titularUuid,
            parentezcoRaw.toUpperCase(), // Columna Parentezco
            adminId
          ]);
        }

        await client.query('COMMIT');
        results.success++;
      } catch (error: any) {
        await client.query('ROLLBACK');
        console.error(`Error en fila ${i}:`, error.message);
        results.errors.push({ fila: i, error: error.message });
      } finally {
        client.release();
      }
    }
    return results;
  }
}