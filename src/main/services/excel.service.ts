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
        const row = rows[i];
        const rowNum = i + 2; // header is row 1

        if (!row.serial_number) {
          errors.push(`행 ${rowNum}: serial_number 누락`);
          continue;
        }

        if (!row.expiry_date) {
          errors.push(`행 ${rowNum}: expiry_date 누락`);
          continue;
        }

        let addOns: { name: string; added_date: string }[] = [];
        if (row.add_ons) {
          try {
            if (typeof row.add_ons === 'string') {
              // "addon1, addon2" 형태 또는 JSON 형태 지원
              if (row.add_ons.startsWith('[')) {
                addOns = JSON.parse(row.add_ons);
              } else {
                addOns = row.add_ons.split(',').map(name => ({
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
          serial_number:    String(row.serial_number).trim(),
          customer_name:    String(row.customer_name    || '').trim(),
          customer_email:   String(row.customer_email   || '').trim(),
          customer_address: String(row.customer_address || '').trim(),
          customer_phone:   String(row.customer_phone   || '').trim(),
          customer_manager: String(row.customer_manager || '').trim(),
          purchase_date:    this.normalizeDate(row.purchase_date) || new Date().toISOString().slice(0, 10),
          expiry_date:      this.normalizeDate(row.expiry_date)!,
          engine_build:     String(row.engine_build || '').trim(),
          version:          String(row.version      || '').trim(),
          add_ons:          addOns,
          notes:            String(row.notes || '').trim(),
        });
      }
    } catch (err: any) {
      errors.push(`파일 읽기 오류: ${err.message}`);
    }

    return { serials, errors };
  }

  generateTemplate(outputPath: string): void {
    const wb = XLSX.utils.book_new();

    // 헤더 행 (컬럼명)
    const headerRow = [
      'serial_number',
      'customer_name',
      'customer_email',
      'customer_address',
      'customer_phone',
      'customer_manager',
      'purchase_date',
      'expiry_date',
      'engine_build',
      'version',
      'add_ons',
      'notes',
    ];

    // 헤더 설명 행 (한글 레이블)
    const labelRow = [
      '시리얼 넘버 (필수)',
      '고객명',
      '이메일',
      '주소',
      '전화번호',
      '담당자',
      '구매일 (YYYY-MM-DD)',
      '만료일 (YYYY-MM-DD, 필수)',
      '엔진빌드',
      '버전',
      'Add-ons (쉼표로 구분)',
      '비고',
    ];

    // 샘플 데이터 행
    const sampleRow = [
      'EXO-2024-001',
      '홍길동 치과',
      'hong@example.com',
      '서울시 강남구 테헤란로 123',
      '010-1234-5678',
      '김담당',
      '2024-01-15',
      '2025-01-15',
      '4.0.1',
      '24.01',
      'DentalCAD, ChairsideCAD',
      '샘플 데이터',
    ];

    const ws = XLSX.utils.aoa_to_sheet([headerRow, labelRow, sampleRow]);

    // 컬럼 너비 설정
    ws['!cols'] = [
      { wch: 18 }, // serial_number
      { wch: 16 }, // customer_name
      { wch: 22 }, // customer_email
      { wch: 30 }, // customer_address
      { wch: 16 }, // customer_phone
      { wch: 12 }, // customer_manager
      { wch: 16 }, // purchase_date
      { wch: 16 }, // expiry_date
      { wch: 12 }, // engine_build
      { wch: 10 }, // version
      { wch: 24 }, // add_ons
      { wch: 20 }, // notes
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Serials');
    XLSX.writeFile(wb, outputPath);
  }

  private normalizeDate(value: any): string | null {
    if (!value) return null;

    if (typeof value === 'number') {
      // Excel serial date number
      const date = XLSX.SSF.parse_date_code(value);
      if (date) {
        return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
      }
    }

    const str = String(value).trim();
    // YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    // MM/DD/YYYY
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
}

export const excelService = new ExcelService();
