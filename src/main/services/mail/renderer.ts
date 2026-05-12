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
] as const;

export type TemplateVarName = (typeof TEMPLATE_VARIABLE_NAMES)[number];

/** Replace {{VAR}} placeholders. Unresolved vars are left as-is. */
export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_match, key: string) => vars[key] ?? `{{${key}}}`);
}
