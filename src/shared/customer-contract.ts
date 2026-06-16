import type { CustomerInput } from './types';

type CustomerMergeQuery = {
  email?: string;
  name?: string;
  phone?: string;
  dealer?: string;
};

const CUSTOMER_STRING_LIMITS = {
  name: 200,
  email: 200,
  phone: 200,
  address: 1000,
  dealer: 200,
  sales_manager: 200,
  notes: 1000,
} as const;

const CUSTOMER_FIELDS = Object.keys(CUSTOMER_STRING_LIMITS) as Array<keyof typeof CUSTOMER_STRING_LIMITS>;
const MERGE_FIELDS = ['email', 'name', 'phone', 'dealer'] as const;

function asRecord(raw: unknown, label: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${label} must be an object`);
  }
  return raw as Record<string, unknown>;
}

function toLimitedString(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object') {
    throw new Error(`${field} must be a string`);
  }
  const text = String(value).trim();
  if (text.length > maxLength) {
    throw new Error(`${field} is too long (max ${maxLength})`);
  }
  return text;
}

export function parseCustomerInput(raw: unknown): CustomerInput {
  const input = asRecord(raw, 'Customer input');
  const parsed: CustomerInput = { name: '' };

  for (const field of CUSTOMER_FIELDS) {
    const value = toLimitedString(input[field], field, CUSTOMER_STRING_LIMITS[field]);
    if (value !== undefined) {
      parsed[field] = value;
    }
  }

  return parsed;
}

export function parseCustomerUpdateInput(raw: unknown): Partial<CustomerInput> {
  const input = asRecord(raw, 'Customer update input');
  const parsed: Partial<CustomerInput> = {};

  for (const field of CUSTOMER_FIELDS) {
    const value = toLimitedString(input[field], field, CUSTOMER_STRING_LIMITS[field]);
    if (value !== undefined) {
      parsed[field] = value;
    }
  }

  return parsed;
}

export function parseCustomerSearchQuery(raw: unknown): string {
  const value = toLimitedString(raw, 'query', 200);
  return value ?? '';
}

export function parseCustomerMergeQuery(raw: unknown): CustomerMergeQuery {
  const input = asRecord(raw, 'Customer merge query');
  const parsed: CustomerMergeQuery = {};

  for (const field of MERGE_FIELDS) {
    const value = toLimitedString(input[field], field, CUSTOMER_STRING_LIMITS[field]);
    if (value !== undefined) {
      parsed[field] = value;
    }
  }

  return parsed;
}
