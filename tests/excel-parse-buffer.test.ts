import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { ExcelService } from '../src/main/services/excel.service';

async function buildWorkbookBuffer(rows: unknown[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Serials');
  sheet.addRows(rows);
  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data);
}

describe('ExcelService.parseExcelBuffer', () => {
  it('parses valid serial rows from an in-memory workbook', async () => {
    const service = new ExcelService();
    const buffer = await buildWorkbookBuffer([
      ['serial_number', 'customer_name', 'customer_email', 'customer_phone', 'purchase_date', 'expiry_date', 'modules', 'renewal_stop_requested', 'status', 'notes'],
      ['EXO-REAL-001', 'Acme Dental', 'ops@example.com', '010-1111-2222', '2026-01-05', '02/20/2027', 'ChairsideCAD, exoplan', 'Y', 'active', 'first row'],
    ]);

    const result = await service.parseExcelBuffer(buffer);

    expect(result.errors).toEqual([]);
    expect(result.serials).toHaveLength(1);
    expect(result.serials[0]).toMatchObject({
      serial_number: 'EXO-REAL-001',
      customer_name: 'Acme Dental',
      customer_email: 'ops@example.com',
      customer_phone: '010-1111-2222',
      purchase_date: '2026-01-05',
      expiry_date: '2027-02-20',
      modules: ['ChairsideCAD', 'exoplan'],
      renewal_stop_requested: true,
      status: 'active',
      notes: 'first row',
    });
  });

  it('skips template header and sample rows', async () => {
    const service = new ExcelService();
    const buffer = await buildWorkbookBuffer([
      ['serial_number', 'customer_name', 'expiry_date'],
      ['EXO-2024-001', 'Template Sample', '2025-01-15'],
      ['EXO-REAL-002', 'Real Customer', '2027-03-01'],
    ]);

    const result = await service.parseExcelBuffer(buffer);

    expect(result.errors).toEqual([]);
    expect(result.serials.map(serial => serial.serial_number)).toEqual(['EXO-REAL-002']);
  });

  it('reports non-empty rows that are missing a serial number and skips blank rows', async () => {
    const service = new ExcelService();
    const buffer = await buildWorkbookBuffer([
      ['serial_number', 'customer_name', 'expiry_date'],
      ['', 'Has Customer But No Serial', '2027-04-01'],
      ['', '', ''],
      ['EXO-REAL-003', 'Valid Customer', '2027-05-01'],
    ]);

    const result = await service.parseExcelBuffer(buffer);

    expect(result.serials.map(serial => serial.serial_number)).toEqual(['EXO-REAL-003']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('serial_number 누락');
  });
});
