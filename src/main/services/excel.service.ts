import ExcelJS from 'exceljs';
import type { SerialInput, SerialWithCustomer } from '../../shared/types';
import { getDateString, getTodayDateString } from '../utils/date-utils';

type NormalizedExcelRow = Record<
  | 'serial_number'
  | 'expiry_date'
  | 'customer_name'
  | 'customer_email'
  | 'customer_address'
  | 'customer_phone'
  | 'customer_manager'
  | 'dealer'
  | 'purchase_date'
  | 'engine_build'
  | 'version'
  | 'main_product'
  | 'modules'
  | 'add_ons'
  | 'status'
  | 'renewal_stop_requested'
  | 'notes',
  unknown
>;

type ExcelRawRow = Record<string, unknown>;
type ModuleEntry = string | { name?: unknown };
type SerialExportRow = SerialWithCustomer & {
  add_ons?: unknown;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  customer_address?: string;
  dealer?: string;
  customer_manager?: string;
};

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

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

const SERIAL_EXCEL_WIDTHS = [18, 16, 22, 16, 30, 14, 12, 16, 16, 14, 12, 12, 18, 28, 18, 24];
const VALID_SERIAL_STATUSES = new Set(['active', 'cancelled', 'expired', 'not-activated', 'broken']);
const SERIAL_STATUS_ALIASES: Record<string, SerialInput['status']> = {
  active: 'active',
  activated: 'active',
  valid: 'active',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  cancel: 'cancelled',
  'opted out': 'cancelled',
  'opt out': 'cancelled',
  optedout: 'cancelled',
  optout: 'cancelled',
  expired: 'expired',
  expire: 'expired',
  'not active': 'not-activated',
  notactive: 'not-activated',
  'not activated': 'not-activated',
  'not-activated': 'not-activated',
  notactivated: 'not-activated',
  inactive: 'not-activated',
  broken: 'broken',
};

function excelSerialDateToString(value: number): string | null {
  const millis = Math.round((value - 25569) * 86400 * 1000);
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function cellValueToPrimitive(value: ExcelJS.CellValue): unknown {
  if (value == null) return '';
  if (value instanceof Date) return value;
  if (typeof value !== 'object') return value;
  if ('text' in value) return value.text;
  if ('result' in value) return value.result;
  if ('richText' in value && Array.isArray(value.richText)) {
    return value.richText.map(part => part.text).join('');
  }
  return String(value);
}

export function normalizeExcelDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return getDateString(value);
  if (typeof value === 'number') return excelSerialDateToString(value);

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

export class ExcelService {
  async parseExcelFile(filePath: string): Promise<{ serials: SerialInput[]; errors: string[] }> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    return this.parseWorkbook(workbook);
  }

  async parseExcelBuffer(buffer: Buffer): Promise<{ serials: SerialInput[]; errors: string[] }> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    return this.parseWorkbook(workbook);
  }

  async generateTemplate(outputPath: string): Promise<void> {
    const wb = this.buildTemplateWorkbook();
    await wb.xlsx.writeFile(outputPath);
  }

  async exportSerials(serials: SerialWithCustomer[], outputPath: string): Promise<void> {
    const wb = this.buildSerialsWorkbook(serials);
    await wb.xlsx.writeFile(outputPath);
  }

  async exportSerialsBuffer(serials: SerialWithCustomer[]): Promise<Buffer> {
    const wb = this.buildSerialsWorkbook(serials);
    const data = await wb.xlsx.writeBuffer();
    return Buffer.from(data);
  }

  async generateTemplateBuffer(): Promise<Buffer> {
    const wb = this.buildTemplateWorkbook();
    const data = await wb.xlsx.writeBuffer();
    return Buffer.from(data);
  }

  private parseWorkbook(workbook: ExcelJS.Workbook): { serials: SerialInput[]; errors: string[] } {
    const errors: string[] = [];
    const serials: SerialInput[] = [];

    try {
      const sheet = workbook.worksheets[0];
      if (!sheet) return { serials, errors: ['파일에 시트가 없습니다'] };

      const headerRow = sheet.getRow(1);
      const headerCount = Math.max(headerRow.cellCount, SERIAL_EXCEL_HEADERS.length);
      const headers = Array.from({ length: headerCount }, (_, index) => {
        const fallback = SERIAL_EXCEL_HEADERS[index] || `column_${index + 1}`;
        return String(cellValueToPrimitive(headerRow.getCell(index + 1).value) || fallback);
      });

      sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber === 1) return;
        const raw: ExcelRawRow = {};
        headers.forEach((header, index) => {
          const value = cellValueToPrimitive(row.getCell(index + 1).value);
          if (raw[header] !== undefined && (value === undefined || value === null || value === '')) return;
          raw[header] = value;
        });
        const normalized = this.normalizeRowKeys(raw);

        if (this.isTemplateRow(normalized)) return;
        if (!normalized.serial_number) {
          const hasOtherData = Object.values(normalized).some(v => v !== undefined && v !== null && v !== '');
          if (!hasOtherData) return;
          errors.push(`행 ${rowNumber}: serial_number 누락`);
          return;
        }

        serials.push(this.rowToSerialInput(normalized, rowNumber, errors));
      });
    } catch (err: unknown) {
      errors.push(`파일 읽기 오류: ${getErrorMessage(err)}`);
    }

    return { serials, errors };
  }

  private buildTemplateWorkbook(): ExcelJS.Workbook {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Serials');
    ws.addRows([SERIAL_EXCEL_HEADERS, SERIAL_EXCEL_LABELS, SERIAL_EXCEL_SAMPLE]);
    ws.columns = SERIAL_EXCEL_WIDTHS.map(width => ({ width }));
    return wb;
  }

  private buildSerialsWorkbook(serials: SerialWithCustomer[]): ExcelJS.Workbook {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Serials');
    ws.columns = SERIAL_EXCEL_WIDTHS.map(width => ({ width }));
    ws.addRow(SERIAL_EXCEL_HEADERS);
    ws.addRows(serials.map(serial => this.serialToRow(serial)));
    return wb;
  }

  private serialToRow(serial: SerialWithCustomer): unknown[] {
    const s = serial as SerialExportRow;
    const modules = (() => {
      const raw = s.modules ?? s.add_ons ?? '[]';
      try {
        const parsed = JSON.parse(raw || '[]');
        if (!Array.isArray(parsed)) return '';
        return parsed.map((item: ModuleEntry) => typeof item === 'string' ? item : item?.name).filter(Boolean).join(', ');
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
  }

  private isTemplateRow(row: NormalizedExcelRow): boolean {
    const serialNumber = String(row.serial_number || '');
    return !!serialNumber && (
      serialNumber.includes('시리얼 넘버') ||
      serialNumber.includes('EXO-2024-001') ||
      serialNumber === 'serial_number'
    );
  }

  private rowToSerialInput(row: NormalizedExcelRow, rowNum: number, errors: string[]): SerialInput {
    const modules = this.parseModules(row.modules ?? row.add_ons, rowNum, errors);
    return {
      serial_number: String(row.serial_number).trim(),
      customer_name: String(row.customer_name || '').trim(),
      customer_email: String(row.customer_email || '').trim(),
      customer_address: String(row.customer_address || '').trim(),
      customer_phone: String(row.customer_phone || '').trim(),
      customer_manager: String(row.customer_manager || '').trim(),
      dealer: String(row.dealer || '').trim(),
      purchase_date: normalizeExcelDate(row.purchase_date) || getTodayDateString(),
      expiry_date: normalizeExcelDate(row.expiry_date) || '',
      status: this.normalizeStatus(row.status, rowNum, errors),
      engine_build: String(row.engine_build || '').trim(),
      version: String(row.version || '').trim(),
      main_product: String(row.main_product || '').trim(),
      modules,
      renewal_stop_requested: this.normalizeBoolean(row.renewal_stop_requested),
      notes: String(row.notes || '').trim(),
    };
  }

  private normalizeRowKeys(raw: ExcelRawRow): NormalizedExcelRow {
    const normalized: ExcelRawRow = {};
    for (const key of Object.keys(raw)) {
      const cleanKey = key.replace(/[\ufeff\x00-\x1F\x7F-\x9F]/g, '').trim();
      normalized[cleanKey] = raw[key];
    }

    const getVal = (keys: string[]): unknown => {
      for (const k of keys) {
        const val = normalized[k];
        if (val !== undefined && val !== null && val !== '') {
          return typeof val === 'string' ? val.trim() : val;
        }
      }

      const simplifiedKeys = keys.map(k => k.toLowerCase().replace(/\s+/g, ''));
      for (const actualKey of Object.keys(normalized)) {
        const simplifiedActual = actualKey.toLowerCase().replace(/\s+/g, '');
        if (simplifiedKeys.includes(simplifiedActual)) {
          const val = normalized[actualKey];
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

  private parseModules(value: unknown, rowNum: number, errors: string[]): string[] {
    const raw = String(value || '').trim();
    if (!raw) return [];
    try {
      if (raw.startsWith('[')) {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.map((item: ModuleEntry) => typeof item === 'string' ? item : item?.name).filter(Boolean).map(String);
      }
      return raw.split(/[,/]/).map(name => name.trim()).filter(Boolean);
    } catch {
      errors.push(`행 ${rowNum}: modules 파싱 실패`);
      return [];
    }
  }

  private normalizeStatus(value: unknown, rowNum: number, errors: string[]): SerialInput['status'] | undefined {
    const raw = String(value || '').normalize('NFKC').trim();
    if (!raw) return undefined;

    const status = raw.toLowerCase().replace(/\s+/g, ' ');
    const compactStatus = status.replace(/[\s_-]+/g, '');
    const mapped = SERIAL_STATUS_ALIASES[status] || SERIAL_STATUS_ALIASES[compactStatus];
    if (mapped) return mapped;
    if (VALID_SERIAL_STATUSES.has(status)) return status as SerialInput['status'];

    errors.push(`행 ${rowNum}: status "${raw}" 인식 실패`);
    return undefined;
  }

  private normalizeBoolean(value: unknown): boolean | undefined {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return undefined;
    return ['1', 'true', 'y', 'yes', '예', '네', '중단', 'stop'].includes(normalized);
  }
}

export const excelService = new ExcelService();
