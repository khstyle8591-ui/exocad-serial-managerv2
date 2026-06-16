import type { CustomerInput, PendingOrder, PollSource, Serial } from './types';

type OrderUpdateInput = Partial<PendingOrder>;
type OrderApproveInput = {
  serial_status?: Serial['status'];
  customer_id?: number;
  customer_data?: CustomerInput;
};
type PollDryRunInput = {
  sourceId?: string;
  sourceOverrides?: Partial<PollSource>;
  targetDate?: string;
};

const SERIAL_STATUSES: Array<Serial['status']> = [
  'active',
  'cancelled',
  'expired',
  'not-activated',
  'broken',
];

const ORDER_TYPES: Array<PendingOrder['order_type']> = ['new', 'renewal', 'addon'];

const ORDER_UPDATE_FIELDS = [
  'serial_number',
  'customer_name',
  'customer_email',
  'customer_address',
  'customer_phone',
  'dealer',
  'sales_manager',
  'purchase_date',
  'expiry_date',
  'engine_build',
  'version',
  'main_product',
  'modules',
  'product_code',
  'notes',
  'order_type',
] as const;

const ORDER_UPDATE_DATA_FIELDS = [
  'serial_number',
  'customer_name',
  'customer_email',
  'customer_phone',
  'customer_address',
  'sales_manager',
  'purchase_date',
  'expiry_date',
  'version',
  'main_product',
  'modules',
  'notes',
  'serial_status',
] as const;

const CUSTOMER_FIELDS = [
  'name',
  'email',
  'phone',
  'address',
  'dealer',
  'sales_manager',
  'notes',
] as const;

const POLL_SOURCE_STRING_FIELDS = [
  'id',
  'name',
  'url',
  'login_url',
  'login_id',
  'login_pw',
  'field_serial',
  'field_customer',
  'field_phone',
  'field_purchase',
  'field_expiry',
  'field_product',
  'product_filter',
  'last_polled',
] as const;

const MAX_SHORT = 500;
const MAX_LONG = 5000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function optionalString(value: unknown, field: string, maxLength = MAX_SHORT): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object') throw new Error(`${field} must be a string`);
  const text = String(value).trim();
  if (text.length > maxLength) throw new Error(`${field} is too long (max ${maxLength})`);
  return text;
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${field} must be a positive number`);
  return n;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  throw new Error(`${field} must be a boolean`);
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error(`${field} must be a string array`);
  return value.map((item, index) => {
    if (typeof item === 'object' || item === null) throw new Error(`${field}[${index}] must be a string`);
    return optionalString(item, `${field}[${index}]`) ?? '';
  });
}

function optionalDate(value: unknown, field: string): string | undefined {
  const text = optionalString(value, field);
  if (text === undefined || text === '') return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${field} must use YYYY-MM-DD`);
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new Error(`${field} is invalid`);
  }
  return text;
}

function optionalStatus(value: unknown): Serial['status'] | undefined {
  const text = optionalString(value, 'serial_status');
  if (text === undefined || text === '') return undefined;
  if (!SERIAL_STATUSES.includes(text as Serial['status'])) throw new Error('serial_status is invalid');
  return text as Serial['status'];
}

function optionalOrderType(value: unknown): PendingOrder['order_type'] | undefined {
  const text = optionalString(value, 'order_type');
  if (text === undefined || text === '') return undefined;
  if (!ORDER_TYPES.includes(text as PendingOrder['order_type'])) throw new Error('order_type is invalid');
  return text as PendingOrder['order_type'];
}

function parseCustomerData(value: unknown): CustomerInput | undefined {
  if (value === undefined || value === null) return undefined;
  const input = requireRecord(value, 'customer_data');
  const clean: CustomerInput = { name: '' };
  for (const key of CUSTOMER_FIELDS) {
    const parsed = optionalString(input[key], `customer_data.${key}`, key === 'address' || key === 'notes' ? MAX_LONG : MAX_SHORT);
    if (parsed !== undefined) {
      clean[key] = parsed;
    }
  }
  return clean;
}

function parsePollSourceOverrides(value: unknown): Partial<PollSource> | undefined {
  if (value === undefined || value === null) return undefined;
  const input = requireRecord(value, 'sourceOverrides');
  const clean: Partial<PollSource> = {};

  for (const key of POLL_SOURCE_STRING_FIELDS) {
    const parsed = optionalString(input[key], `sourceOverrides.${key}`, MAX_LONG);
    if (parsed !== undefined) {
      (clean as Record<string, unknown>)[key] = parsed;
    }
  }

  const enabled = optionalBoolean(input.enabled, 'sourceOverrides.enabled');
  if (enabled !== undefined) clean.enabled = enabled;

  const registerDirectly = optionalBoolean(input.register_directly, 'sourceOverrides.register_directly');
  if (registerDirectly !== undefined) clean.register_directly = registerDirectly;

  const intervalMin = optionalNumber(input.interval_min, 'sourceOverrides.interval_min');
  if (intervalMin !== undefined) clean.interval_min = intervalMin;

  const scheduleTimes = optionalStringArray(input.schedule_times, 'sourceOverrides.schedule_times');
  if (scheduleTimes !== undefined) clean.schedule_times = scheduleTimes;

  return clean;
}

export function parseOrderId(raw: unknown): number {
  const id = optionalNumber(raw, 'id');
  if (id === undefined) throw new Error('id is required');
  return Math.trunc(id);
}

export function parseOrderUpdateInput(raw: unknown): OrderUpdateInput {
  const input = requireRecord(raw, 'Order update input');
  const clean: OrderUpdateInput = {};

  for (const key of ORDER_UPDATE_FIELDS) {
    if (key === 'order_type') {
      const parsed = optionalOrderType(input[key]);
      if (parsed !== undefined) clean.order_type = parsed;
      continue;
    }
    const parsed = optionalString(input[key], key, key === 'notes' ? MAX_LONG : MAX_SHORT);
    if (parsed !== undefined) {
      (clean as Record<string, unknown>)[key] = parsed;
    }
  }

  return clean;
}

export function parseOrderUpdateDataInput(raw: unknown): OrderUpdateInput & { serial_status?: Serial['status'] } {
  const input = requireRecord(raw, 'Order update-data input');
  const clean: OrderUpdateInput & { serial_status?: Serial['status'] } = {};

  for (const key of ORDER_UPDATE_DATA_FIELDS) {
    if (key === 'serial_status') {
      const parsed = optionalStatus(input[key]);
      if (parsed !== undefined) clean.serial_status = parsed;
      continue;
    }
    const parsed = optionalString(input[key], key, key === 'notes' ? MAX_LONG : MAX_SHORT);
    if (parsed !== undefined) {
      (clean as Record<string, unknown>)[key] = parsed;
    }
  }

  return clean;
}

export function parseOrderApproveInput(raw: unknown): OrderApproveInput {
  if (raw === undefined || raw === null) return {};
  const input = requireRecord(raw, 'Order approve input');
  const serialStatus = optionalStatus(input.serial_status);
  const customerId = optionalNumber(input.customer_id, 'customer_id');
  const customerData = parseCustomerData(input.customer_data);

  return {
    ...(serialStatus !== undefined ? { serial_status: serialStatus } : {}),
    ...(customerId !== undefined ? { customer_id: customerId } : {}),
    ...(customerData !== undefined ? { customer_data: customerData } : {}),
  };
}

export function parseOrderPollNowInput(raw: unknown): string | undefined {
  return optionalString(raw, 'sourceId');
}

export function parseOrderPollTargetDate(raw: unknown): string | undefined {
  return optionalDate(raw, 'targetDate');
}

export function parseOrderPollDryRunInput(raw: unknown): PollDryRunInput {
  if (raw === undefined || raw === null) return {};
  const input = requireRecord(raw, 'Order poll dry-run input');
  const sourceId = optionalString(input.sourceId, 'sourceId');
  const sourceOverrides = parsePollSourceOverrides(input.sourceOverrides);
  const targetDate = optionalDate(input.targetDate, 'targetDate');

  return {
    ...(sourceId !== undefined ? { sourceId } : {}),
    ...(sourceOverrides !== undefined ? { sourceOverrides } : {}),
    ...(targetDate !== undefined ? { targetDate } : {}),
  };
}
