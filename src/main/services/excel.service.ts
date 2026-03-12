import * as XLSX from 'xlsx';
import type { SerialInput, ExcelSerialRow } from '../../shared/types';

export class ExcelService {
  parseExcelFile(filePath: string): { serials: SerialInput[]; errors: string[] } {
    const errors: string[] = [];
    const serials: SerialInput[] = [];

    try {
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<ExcelSerialRow>(sheet);

      for (let i = 0; i < rows.length; i++) {
        let row = rows[i] as any;
        row = this.normalizeRowKeys(row);
        const rowNum = i + 2;

        if (row.serial_number === '시리얼 넘버 (필수)') continue; // Skip descriptive template header

        if (!row.serial_number) { errors.push(`행 ${rowNum}: serial_number 누락`); continue; }

        let addOns: { name: string; added_date: string }[] = [];
        if (row.add_ons) {
          try {
            if (typeof row.add_ons === 'string') {
              if (row.add_ons.startsWith('[')) {
                addOns = JSON.parse(row.add_ons);
              } else {
                addOns = row.add_ons.split(',').map((name: string) => ({
                  name: name.trim(),
                  added_date: new Date().toISOString().slice(0, 10),
                }));
              }
            }
          } catch {
            errors.push(`행 ${rowNum}: add_ons 파싱 실패`);
          }
        }

        serials.push({
          serial_number: String(row.serial_number).trim(),
          customer_name: String(row.customer_name || '').trim(),
          customer_email: String(row.customer_email || '').trim(),
          customer_address: String(row.customer_address || '').trim(),
          customer_phone: String(row.customer_phone || '').trim(),
          customer_manager: String(row.customer_manager || '').trim(),
          purchase_date: this.normalizeDate(row.purchase_date) || new Date().toISOString().slice(0, 10),
          expiry_date: this.normalizeDate(row.expiry_date) || '',
          engine_build: String(row.engine_build || '').trim(),
          version: String(row.version || '').trim(),
          add_ons: addOns,
          notes: String(row.notes || '').trim(),
        });
      }
    } catch (err: any) {
      errors.push(`파일 읽기 오류: ${err.message}`);
    }

    return { serials, errors };
  }

  /** Buffer(메모리)에서 바로 파싱 — 웹서버용 */
  parseExcelBuffer(buffer: Buffer): { serials: SerialInput[]; errors: string[] } {
    const errors: string[] = [];
    const serials: SerialInput[] = [];
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<ExcelSerialRow>(sheet);
      for (let i = 0; i < rows.length; i++) {
        let row = rows[i] as any;
        row = this.normalizeRowKeys(row);
        const rowNum = i + 2;

        if (row.serial_number === '시리얼 넘버 (필수)') continue; // Skip descriptive template header

        if (!row.serial_number) { errors.push(`행 ${rowNum}: serial_number 누락`); continue; }
        let addOns: { name: string; added_date: string }[] = [];
        if (row.add_ons) {
          try {
            addOns = typeof row.add_ons === 'string' && row.add_ons.startsWith('[')
              ? JSON.parse(row.add_ons)
              : String(row.add_ons).split(',').map(n => ({ name: n.trim(), added_date: new Date().toISOString().slice(0, 10) }));
          } catch { errors.push(`행 ${rowNum}: add_ons 파싱 실패`); }
        }
        serials.push({
          serial_number: String(row.serial_number).trim(),
          customer_name: String(row.customer_name || '').trim(),
          customer_email: String(row.customer_email || '').trim(),
          customer_address: String(row.customer_address || '').trim(),
          customer_phone: String(row.customer_phone || '').trim(),
          customer_manager: String(row.customer_manager || '').trim(),
          purchase_date: this.normalizeDate(row.purchase_date) || new Date().toISOString().slice(0, 10),
          expiry_date: this.normalizeDate(row.expiry_date) || '',
          engine_build: String(row.engine_build || '').trim(),
          version: String(row.version || '').trim(),
          add_ons: addOns,
          notes: String(row.notes || '').trim(),
        });
      }
    } catch (err: any) {
      errors.push(`파일 읽기 오류: ${err.message}`);
    }
    return { serials, errors };
  }

  generateTemplate(outputPath: string): void {
    const wb = XLSX.utils.book_new();
    const headerRow = ['serial_number', 'customer_name', 'customer_email', 'customer_address', 'customer_phone', 'customer_manager', 'purchase_date', 'expiry_date', 'engine_build', 'version', 'add_ons', 'notes'];
    const labelRow = ['시리얼 넘버 (필수)', '고객명', '이메일', '주소', '전화번호', '담당자', '구매일 (YYYY-MM-DD)', '만료일 (YYYY-MM-DD, 필수)', '엔진빌드', '버전', 'Add-ons (쉼표로 구분)', '비고'];
    const sampleRow = ['EXO-2024-001', '홍길동 치과', 'hong@example.com', '서울시 강남구 테헤란로 123', '010-1234-5678', '김담당', '2024-01-15', '2025-01-15', '4.0.1', '24.01', 'DentalCAD, ChairsideCAD', '샘플 데이터'];
    const ws = XLSX.utils.aoa_to_sheet([headerRow, labelRow, sampleRow]);
    ws['!cols'] = [
      { wch: 18 }, { wch: 16 }, { wch: 22 }, { wch: 30 }, { wch: 16 }, { wch: 12 },
      { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 10 }, { wch: 24 }, { wch: 20 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Serials');
    XLSX.writeFile(wb, outputPath);
  }

  /** 템플릿을 Buffer로 반환 — 웹서버 HTTP 스트리밍용 */
  generateTemplateBuffer(): Buffer {
    const wb = XLSX.utils.book_new();
    const headerRow = ['serial_number', 'customer_name', 'customer_email', 'customer_address', 'customer_phone', 'customer_manager', 'purchase_date', 'expiry_date', 'engine_build', 'version', 'add_ons', 'notes'];
    const labelRow = ['시리얼 넘버 (필수)', '고객명', '이메일', '주소', '전화번호', '담당자', '구매일 (YYYY-MM-DD)', '만료일 (YYYY-MM-DD, 필수)', '엔진빌드', '버전', 'Add-ons (쉼표로 구분)', '비고'];
    const sampleRow = ['EXO-2024-001', '홍길동 치과', 'hong@example.com', '서울시 강남구 테헤란로 123', '010-1234-5678', '김담당', '2024-01-15', '2025-01-15', '4.0.1', '24.01', 'DentalCAD, ChairsideCAD', '샘플 데이터'];
    const ws = XLSX.utils.aoa_to_sheet([headerRow, labelRow, sampleRow]);
    XLSX.utils.book_append_sheet(wb, ws, 'Serials');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  private normalizeDate(value: any): string | null {
    if (!value) return null;

    if (typeof value === 'number') {
      const date = XLSX.SSF.parse_date_code(value);
      if (date) {
        return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
      }
    }

    const str = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    const match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) {
      return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
    }

    try {
      const d = new Date(str);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    } catch { /* ignore */ }

    return null;
  }

  private normalizeRowKeys(raw: any): any {
    return {
      serial_number: raw.serial_number || raw['시리얼 넘버 (필수)'] || raw['시리얼 넘버'] || raw['Serial Number'] || raw.serial,
      expiry_date: raw.expiry_date || raw['만료일 (YYYY-MM-DD, 필수)'] || raw['만료일'] || raw['Expiry Date'] || raw.expiry,
      customer_name: raw.customer_name || raw['고객명'] || raw['Customer Name'] || raw.customer,
      customer_email: raw.customer_email || raw['이메일'] || raw['Email'] || raw.email,
      customer_address: raw.customer_address || raw['주소'] || raw['Address'] || raw.address,
      customer_phone: raw.customer_phone || raw['전화번호'] || raw['Phone'] || raw.phone,
      customer_manager: raw.customer_manager || raw['담당자'] || raw['Manager'] || raw.manager,
      purchase_date: raw.purchase_date || raw['구매일 (YYYY-MM-DD)'] || raw['구매일'] || raw['Purchase Date'] || raw.purchase,
      engine_build: raw.engine_build || raw['엔진빌드'] || raw['Engine Build'] || raw.engine,
      version: raw.version || raw['버전'] || raw['Version'],
      add_ons: raw.add_ons || raw['Add-ons (쉼표로 구분)'] || raw['Add-ons'] || raw.addons || raw.add_ons,
      notes: raw.notes || raw['비고'] || raw['Notes'],
    };
  }
}

export const excelService = new ExcelService();
