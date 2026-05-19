import * as XLSX from 'xlsx';
import type { SerialInput, SerialWithCustomer, ExcelSerialRow } from '../../shared/types';
import { getDateString, getTodayDateString } from '../utils/date-utils';

const SERIAL_EXCEL_HEADERS = [
  'serial_number', 'customer_name', 'customer_email', 'customer_phone',
  'customer_address', 'dealer', 'customer_manager', 'purchase_date',
  'expiry_date', 'status', 'engine_build', 'version', 'main_product',
  'modules', 'renewal_stop_requested', 'notes',
];

const SERIAL_EXCEL_LABELS = [
  '시리얼 넘버 (필수)', '고객명', '이메일', '전화번호',
  '주소', '딜러', '담당자', '구매일 (YYYY-MM-DD)',
  '만료일 (YYYY-MM-DD)', '상태', '엔진빌드', '버전', '메인 제품',
  '모듈 (쉼표로 구분)', '갱신 중단 요청 (Y/N)', '비고',
];

const SERIAL_EXCEL_SAMPLE = [
  'EXO-2024-001', '홍길동 치과', 'hong@example.com', '010-1234-5678',
  '서울시 강남구 테헤란로 123', 'Dealer KR', '김담당', '2024-01-15',
  '2025-01-15', 'active', '4.0.1', '24.01', 'DentalCAD',
  'ChairsideCAD, exoplan', 'N', '샘플 데이터',
];

const SERIAL_EXCEL_COLS = [
  { wch: 18 }, { wch: 16 }, { wch: 22 }, { wch: 16 },
  { wch: 30 }, { wch: 14 }, { wch: 12 }, { wch: 16 },
  { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 12 },
  { wch: 18 }, { wch: 28 }, { wch: 18 }, { wch: 24 },
];

const VALID_SERIAL_STATUSES = new Set(['active', 'cancelled', 'expired', 'not-activated', 'broken']);

export class ExcelService {
  parseExcelFile(filePath: string): { serials: SerialInput[]; errors: string[] } {
    const errors: string[] = [];
    const serials: SerialInput[] = [];

    try {
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      // defval: '' 를 추가하여 모든 키가 객체에 존재하도록 보장
      const rows = XLSX.utils.sheet_to_json<ExcelSerialRow>(sheet, { defval: '' });

      for (let i = 0; i < rows.length; i++) {
        let row = rows[i] as any;
        row = this.normalizeRowKeys(row);
        const rowNum = i + 2;

        // 헤더나 샘플 행 건너뛰기 (시리얼 넘버가 특정 키워드인 경우)
        if (row.serial_number && (
          row.serial_number.includes('시리얼 넘버') ||
          row.serial_number.includes('EXO-2024-001') ||
          row.serial_number === 'serial_number'
        )) {
          continue;
        }

        if (!row.serial_number) {
          const hasOtherData = Object.values(row).some(v => v !== undefined && v !== null && v !== '');
          if (!hasOtherData) continue;
          errors.push(`행 ${rowNum}: serial_number 누락`);
          continue;
        }

        const modules = this.parseModules(row.modules ?? row.add_ons, rowNum, errors);

        serials.push({
          serial_number: String(row.serial_number).trim(),
          customer_name: String(row.customer_name || '').trim(),
          customer_email: String(row.customer_email || '').trim(),
          customer_address: String(row.customer_address || '').trim(),
          customer_phone: String(row.customer_phone || '').trim(),
          customer_manager: String(row.customer_manager || '').trim(),
          dealer: String(row.dealer || '').trim(),
          purchase_date: this.normalizeDate(row.purchase_date) || getTodayDateString(),
          expiry_date: this.normalizeDate(row.expiry_date) || '',
          status: this.normalizeStatus(row.status),
          engine_build: String(row.engine_build || '').trim(),
          version: String(row.version || '').trim(),
          main_product: String(row.main_product || '').trim(),
          modules,
          renewal_stop_requested: this.normalizeBoolean(row.renewal_stop_requested),
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
      const rows = XLSX.utils.sheet_to_json<ExcelSerialRow>(sheet, { defval: '' });
      for (let i = 0; i < rows.length; i++) {
        let row = rows[i] as any;
        row = this.normalizeRowKeys(row);
        const rowNum = i + 2;

        if (row.serial_number && (
          row.serial_number.includes('시리얼 넘버') ||
          row.serial_number.includes('EXO-2024-001') ||
          row.serial_number === 'serial_number'
        )) {
          continue;
        }

        if (!row.serial_number) {
          const hasOtherData = Object.values(row).some(v => v !== undefined && v !== null && v !== '');
          if (!hasOtherData) continue;
          errors.push(`행 ${rowNum}: serial_number 누락`);
          continue;
        }
        const modules = this.parseModules(row.modules ?? row.add_ons, rowNum, errors);
        serials.push({
          serial_number: String(row.serial_number).trim(),
          customer_name: String(row.customer_name || '').trim(),
          customer_email: String(row.customer_email || '').trim(),
          customer_address: String(row.customer_address || '').trim(),
          customer_phone: String(row.customer_phone || '').trim(),
          customer_manager: String(row.customer_manager || '').trim(),
          dealer: String(row.dealer || '').trim(),
          purchase_date: this.normalizeDate(row.purchase_date) || getTodayDateString(),
          expiry_date: this.normalizeDate(row.expiry_date) || '',
          status: this.normalizeStatus(row.status),
          engine_build: String(row.engine_build || '').trim(),
          version: String(row.version || '').trim(),
          main_product: String(row.main_product || '').trim(),
          modules,
          renewal_stop_requested: this.normalizeBoolean(row.renewal_stop_requested),
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
    const ws = XLSX.utils.aoa_to_sheet([SERIAL_EXCEL_HEADERS, SERIAL_EXCEL_LABELS, SERIAL_EXCEL_SAMPLE]);
    ws['!cols'] = SERIAL_EXCEL_COLS;
    XLSX.utils.book_append_sheet(wb, ws, 'Serials');
    XLSX.writeFile(wb, outputPath);
  }

  exportSerials(serials: SerialWithCustomer[], outputPath: string): void {
    const wb = XLSX.utils.book_new();
    const rows = serials.map((s: any) => {
      const modules = (() => {
        const raw = s.modules ?? s.add_ons ?? '[]';
        try {
          const parsed = JSON.parse(raw || '[]');
          if (!Array.isArray(parsed)) return '';
          return parsed.map((item: any) => typeof item === 'string' ? item : item?.name).filter(Boolean).join(', ');
        } catch {
          return typeof raw === 'string' ? raw : '';
        }
      })();

      return [
        s.serial_number,
        s.customer?.name ?? s.customer_name ?? '',
        s.customer?.email ?? s.customer_email ?? '',
        s.customer?.phone ?? s.customer_phone ?? '',
        s.customer?.address ?? s.customer_address ?? '',
        s.customer?.dealer ?? s.dealer ?? '',
        s.customer?.sales_manager ?? s.customer_manager ?? '',
        s.purchase_date ?? '',
        s.expiry_date ?? '',
        s.status ?? '',
        s.engine_build ?? '',
        s.version ?? '',
        s.main_product ?? '',
        modules,
        s.renewal_stop_requested ? 'Y' : 'N',
        s.notes ?? '',
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([SERIAL_EXCEL_HEADERS, ...rows]);
    ws['!cols'] = SERIAL_EXCEL_COLS;
    XLSX.utils.book_append_sheet(wb, ws, 'Serials');
    XLSX.writeFile(wb, outputPath);
  }

  /** 템플릿을 Buffer로 반환 — 웹서버 HTTP 스트리밍용 */
  generateTemplateBuffer(): Buffer {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([SERIAL_EXCEL_HEADERS, SERIAL_EXCEL_LABELS, SERIAL_EXCEL_SAMPLE]);
    ws['!cols'] = SERIAL_EXCEL_COLS;
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
      if (!isNaN(d.getTime())) return getDateString(d);
    } catch { /* ignore */ }

    return null;
  }

  private normalizeRowKeys(raw: any): any {
    const normalized: any = {};
    for (const key of Object.keys(raw)) {
      // BOM 및 제어문자 제거 루틴 강화
      const cleanKey = key.replace(/[\ufeff\x00-\x1F\x7F-\x9F]/g, "").trim();
      normalized[cleanKey] = raw[key];
    }

    const getVal = (keys: string[]) => {
      // 1. 정확한 매칭
      for (const k of keys) {
        let val = normalized[k];
        if (val !== undefined && val !== null && val !== '') {
          return typeof val === 'string' ? val.trim() : val;
        }
      }

      // 2. 소문자 및 공백 제거 후 비교 (강력한 매칭)
      const simplifiedKeys = keys.map(k => k.toLowerCase().replace(/\s+/g, ''));
      for (const actualKey of Object.keys(normalized)) {
        const simplifiedActual = actualKey.toLowerCase().replace(/\s+/g, '');
        if (simplifiedKeys.includes(simplifiedActual)) {
          let val = normalized[actualKey];
          if (val !== undefined && val !== null && val !== '') {
            return typeof val === 'string' ? val.trim() : val;
          }
        }
      }
      return undefined;
    };

    return {
      serial_number: getVal(['serial_number', '시리얼 넘버 (필수)', '시리얼 넘버', 'Serial Number', 'serial', 'S/N', 'SN', '시리얼번호', '시리얼', 'LOT']),
      expiry_date: getVal(['expiry_date', '만료일 (YYYY-MM-DD, 필수)', '만료일', 'Expiry Date', 'expiry', '만료날짜', '出荷日']),
      customer_name: getVal(['customer_name', '고객명', 'Customer Name', 'customer', '고객', '注文先']),
      customer_email: getVal(['customer_email', '이메일', 'Email', 'email']),
      customer_address: getVal(['customer_address', '주소', 'Address', 'address', '納品先']),
      customer_phone: getVal(['customer_phone', '전화번호', 'Phone', 'phone', '연락처']),
      customer_manager: getVal(['customer_manager', '담당자', 'Manager', 'manager']),
      dealer: getVal(['dealer', '딜러', 'Dealer']),
      purchase_date: getVal(['purchase_date', '구매일 (YYYY-MM-DD)', '구매일', 'Purchase Date', 'purchase', '구매날짜', '入荷일', '入荷日']),
      engine_build: getVal(['engine_build', '엔진빌드', 'Engine Build', 'engine']),
      version: getVal(['version', '버전', 'Version', '品名']),
      main_product: getVal(['main_product', '메인 제품', 'Main Product', 'main product', '제품명']),
      modules: getVal(['modules', '모듈 (쉼표로 구분)', '모듈', 'Modules', 'Module']),
      add_ons: getVal(['add_ons', 'Add-ons (쉼표로 구분)', 'Add-ons', 'addons', '애드온']),
      status: getVal(['status', '상태', 'Status']),
      renewal_stop_requested: getVal(['renewal_stop_requested', '갱신 중단 요청 (Y/N)', '갱신 중단 요청', 'Renewal Stop Requested', 'Stop']),
      notes: getVal(['notes', '비고', 'Notes', '메모']),
    };
  }

  private parseModules(value: any, rowNum: number, errors: string[]): string[] {
    const raw = String(value || '').trim();
    if (!raw) return [];
    try {
      if (raw.startsWith('[')) {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.map((item: any) => typeof item === 'string' ? item : item?.name).filter(Boolean);
      }
      return raw.split(/[,\/]/).map(name => name.trim()).filter(Boolean);
    } catch {
      errors.push(`행 ${rowNum}: modules 파싱 실패`);
      return [];
    }
  }

  private normalizeStatus(value: any): SerialInput['status'] | undefined {
    const status = String(value || '').trim();
    return VALID_SERIAL_STATUSES.has(status) ? status as SerialInput['status'] : undefined;
  }

  private normalizeBoolean(value: any): boolean | undefined {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return undefined;
    return ['1', 'true', 'y', 'yes', '예', '네', '중단', 'stop'].includes(normalized);
  }

}

export const excelService = new ExcelService();
