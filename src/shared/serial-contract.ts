import type { AddOn, Serial, SerialExportQuery, SerialInput, SerialListQuery } from './types';

const SERIAL_STATUSES: Array<Serial['status']> = [
  'active',
  'cancelled',
  'expired',
  'not-activated',
  'broken',
];

const SERIAL_INPUT_KEYS = new Set<keyof SerialInput>([
  'serial_number',
  'customer_id',
  'customer_resolution',
  'customer_merge_target_id',
  'customer_name',
  'customer_email',
  'customer_address',
  'customer_phone',
  'customer_manager',
  'dealer',
  'purchase_date',
  'expiry_date',
  'engine_build',
  'version',
  'main_product',
  'modules',
  'add_ons',
  'notes',
  'status',
  'renewal_stop_requested',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  return value;
}

function optionalNullableString(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  return value;
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error(`${field} must be a number`);
  return n;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  throw new Error(`${field} must be a boolean`);
}

function optionalCustomerResolution(value: unknown): SerialInput['customer_resolution'] | undefined {
  if (value === undefined || value === '') return undefined;
  if (value === 'merge' || value === 'separate') return value;
  throw new Error('customer_resolution is invalid');
}

function optionalStatus(value: unknown, allowAll = false): Serial['status'] | 'all' | undefined {
  if (value === undefined || value === '') return undefined;
  if (allowAll && value === 'all') return 'all';
  if (typeof value === 'string' && SERIAL_STATUSES.includes(value as Serial['status'])) {
    return value as Serial['status'];
  }
  throw new Error('status is invalid');
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`${field} must be a string array`);
  }
  return value;
}

export function parseAddOnInput(value: unknown): AddOn {
  if (!isRecord(value)) throw new Error('addon must be an object');
  const name = optionalString(value.name, 'name')?.trim();
  const added_date = optionalString(value.added_date, 'added_date')?.trim();
  if (!name) throw new Error('name is required');
  if (!added_date) throw new Error('added_date is required');
  return { name, added_date };
}

function optionalAddOns(value: unknown): AddOn[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('add_ons must be an array');
  return value.map(parseAddOnInput);
}

export function parseSerialInput(value: unknown): SerialInput {
  if (!isRecord(value)) throw new Error('serial input must be an object');
  const input = parseSerialUpdateInput(value);
  if (!input.serial_number?.trim()) throw new Error('serial_number is required');
  return { ...input, serial_number: input.serial_number.trim() };
}

export function parseSerialUpdateInput(value: unknown): Partial<SerialInput> {
  if (!isRecord(value)) throw new Error('serial input must be an object');
  const clean: Partial<SerialInput> = {};

  for (const key of Object.keys(value)) {
    if (!SERIAL_INPUT_KEYS.has(key as keyof SerialInput)) continue;
    const v = value[key];
    switch (key as keyof SerialInput) {
      case 'serial_number':
      case 'customer_name':
      case 'customer_email':
      case 'customer_address':
      case 'customer_phone':
      case 'customer_manager':
      case 'dealer':
      case 'purchase_date':
      case 'engine_build':
      case 'version':
      case 'main_product':
      case 'notes':
        (clean as Record<string, unknown>)[key] = optionalString(v, key);
        break;
      case 'expiry_date':
        clean.expiry_date = optionalNullableString(v, key);
        break;
      case 'customer_id':
        clean.customer_id = optionalNumber(v, key);
        break;
      case 'customer_merge_target_id':
        clean.customer_merge_target_id = optionalNumber(v, key);
        break;
      case 'customer_resolution':
        clean.customer_resolution = optionalCustomerResolution(v);
        break;
      case 'modules':
        clean.modules = optionalStringArray(v, key);
        break;
      case 'add_ons':
        clean.add_ons = optionalAddOns(v);
        break;
      case 'status':
        clean.status = optionalStatus(v) as Serial['status'] | undefined;
        break;
      case 'renewal_stop_requested':
        clean.renewal_stop_requested = optionalBoolean(v, key);
        break;
    }
  }

  return clean;
}

export function parseSerialListQuery(value: unknown): Required<Pick<SerialListQuery, 'limit' | 'offset'>> & SerialListQuery {
  const source = isRecord(value) ? value : {};
  const rawLimit = optionalNumber(source.limit, 'limit') ?? 50;
  const rawOffset = optionalNumber(source.offset, 'offset') ?? 0;
  const limit = Math.min(Math.max(Math.trunc(rawLimit), 1), 500);
  const offset = Math.max(Math.trunc(rawOffset), 0);
  const search = optionalString(source.search ?? source.q, 'search')?.trim();
  const status = optionalStatus(source.status, true);
  const customer_id = optionalNumber(source.customer_id, 'customer_id');
  const renewal_stop_requested = optionalBoolean(source.renewal_stop_requested, 'renewal_stop_requested');
  const expiring_this_month = optionalBoolean(source.expiring_this_month, 'expiring_this_month');

  return {
    limit,
    offset,
    ...(search ? { search } : {}),
    ...(status && status !== 'all' ? { status } : {}),
    ...(customer_id !== undefined ? { customer_id } : {}),
    ...(renewal_stop_requested !== undefined ? { renewal_stop_requested } : {}),
    ...(expiring_this_month !== undefined ? { expiring_this_month } : {}),
  };
}

export function parseSerialExportQuery(value: unknown): SerialExportQuery {
  const query = parseSerialListQuery(value);
  const { search, status, customer_id, renewal_stop_requested, expiring_this_month } = query;
  return {
    ...(search ? { search } : {}),
    ...(status && status !== 'all' ? { status } : {}),
    ...(customer_id !== undefined ? { customer_id } : {}),
    ...(renewal_stop_requested !== undefined ? { renewal_stop_requested } : {}),
    ...(expiring_this_month !== undefined ? { expiring_this_month } : {}),
  };
}
