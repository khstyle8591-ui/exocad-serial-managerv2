export interface TemplateVars {
  CUSTOMER_NAME?: string;
  CUSTOMER_EMAIL?: string;
  SERIAL_NUMBER?: string;
  EXPIRY_DATE?: string;
  PURCHASE_DATE?: string;
  MAIN_PRODUCT?: string;
  MODULES?: string;
  TODAY?: string;
  DEALER?: string;
  SALES_MANAGER?: string;
  NAME?: string;
  SERIAL?: string;
  ADDRESS?: string;
  EMAIL?: string;
  REQUEST_ID?: string;
  ACCOUNT_NAME?: string;
  LOGIN_ID?: string;
  EXOCAD_ID?: string;
  PACKAGE_LABEL?: string;
  PACKAGE_QTY?: string;
  PACKAGE_PRICE?: string;
  RESET_URL?: string;
  INCLUDE_QUOTE?: string;
  PREVIOUS_EXPIRY_DATE?: string;
  MISSING_FIELDS?: string;
  RECEIVED_SUBJECT?: string;
  DETECTED_SERIAL?: string;
  RESPONSE_ERRORS?: string;
  REPLY_TEMPLATE?: string;
  [key: string]: string | undefined;
}

export const TEMPLATE_VARIABLE_NAMES = [
  'CUSTOMER_NAME',
  'CUSTOMER_EMAIL',
  'SERIAL_NUMBER',
  'EXPIRY_DATE',
  'PURCHASE_DATE',
  'MAIN_PRODUCT',
  'MODULES',
  'TODAY',
  'DEALER',
  'SALES_MANAGER',
  'NAME',
  'SERIAL',
  'ADDRESS',
  'EMAIL',
  'REQUEST_ID',
  'ACCOUNT_NAME',
  'LOGIN_ID',
  'EXOCAD_ID',
  'PACKAGE_LABEL',
  'PACKAGE_QTY',
  'PACKAGE_PRICE',
  'RESET_URL',
  'INCLUDE_QUOTE',
  'PREVIOUS_EXPIRY_DATE',
  'MISSING_FIELDS',
  'RESPONSE_ERRORS',
  'DETECTED_SERIAL',
  'RECEIVED_SUBJECT',
  'REPLY_TEMPLATE',
] as const;

export type TemplateVarName = (typeof TEMPLATE_VARIABLE_NAMES)[number];

/** Replace {{VAR}} placeholders. Unresolved vars are left as-is. */
export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_match, key: string) => vars[key] ?? `{{${key}}}`);
}
