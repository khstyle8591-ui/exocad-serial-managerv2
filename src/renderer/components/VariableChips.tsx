import React from 'react';
import { useLang } from '../App';
import { t, type TranslationKey } from '../i18n';

const VARS: { key: string; labelKey: TranslationKey }[] = [
  { key: 'CUSTOMER_NAME', labelKey: 'var_customer_name' },
  { key: 'CUSTOMER_EMAIL', labelKey: 'var_customer_email' },
  { key: 'SERIAL_NUMBER', labelKey: 'var_serial_number' },
  { key: 'EXPIRY_DATE', labelKey: 'var_expiry_date' },
  { key: 'PURCHASE_DATE', labelKey: 'var_purchase_date' },
  { key: 'MAIN_PRODUCT', labelKey: 'var_main_product' },
  { key: 'MODULES', labelKey: 'col_addons' },
  { key: 'TODAY', labelKey: 'var_today' },
  { key: 'DEALER', labelKey: 'var_dealer' },
  { key: 'SALES_MANAGER', labelKey: 'var_sales_manager' },
  { key: 'NAME', labelKey: 'var_name' },
  { key: 'SERIAL', labelKey: 'var_serial' },
  { key: 'ADDRESS', labelKey: 'var_address' },
  { key: 'EMAIL', labelKey: 'var_email' },
  { key: 'REQUEST_ID', labelKey: 'var_request_id' },
  { key: 'ACCOUNT_NAME', labelKey: 'var_account_name' },
  { key: 'LOGIN_ID', labelKey: 'var_login_id' },
  { key: 'EXOCAD_ID', labelKey: 'var_exocad_id' },
  { key: 'PACKAGE_LABEL', labelKey: 'var_package_label' },
  { key: 'PACKAGE_QTY', labelKey: 'var_package_qty' },
  { key: 'PACKAGE_PRICE', labelKey: 'var_package_price' },
  { key: 'RESET_URL', labelKey: 'var_reset_url' },
  { key: 'INCLUDE_QUOTE', labelKey: 'var_include_quote' },
  { key: 'PREVIOUS_EXPIRY_DATE', labelKey: 'var_previous_expiry_date' },
  { key: 'MISSING_FIELDS', labelKey: 'var_missing_fields' },
  { key: 'RECEIVED_SUBJECT', labelKey: 'var_received_subject' },
  { key: 'DETECTED_SERIAL', labelKey: 'var_detected_serial' },
  { key: 'RESPONSE_ERRORS', labelKey: 'var_response_errors' },
  { key: 'REPLY_TEMPLATE', labelKey: 'var_reply_template' },
];

/** Built-in template code -> variable keys actually used in its subject/body. */
const TEMPLATE_CODE_VARS: Record<string, string[]> = {
  renewal_reminder: ['CUSTOMER_NAME', 'SERIAL_NUMBER', 'MAIN_PRODUCT', 'MODULES', 'EXPIRY_DATE', 'SALES_MANAGER'],
  expiry_notice: ['CUSTOMER_NAME', 'SERIAL_NUMBER', 'EXPIRY_DATE', 'MAIN_PRODUCT', 'MODULES', 'SALES_MANAGER'],
  stop_expiry_reminder: ['CUSTOMER_NAME', 'SERIAL_NUMBER', 'EXPIRY_DATE', 'MAIN_PRODUCT', 'MODULES', 'SALES_MANAGER'],
  stop_request_received: ['CUSTOMER_NAME', 'SERIAL_NUMBER', 'MAIN_PRODUCT', 'EXPIRY_DATE', 'TODAY', 'SALES_MANAGER'],
  missing_info_request: ['CUSTOMER_NAME', 'MISSING_FIELDS', 'RECEIVED_SUBJECT', 'DETECTED_SERIAL'],
  invalid_cancellation_response: ['CUSTOMER_NAME', 'RESPONSE_ERRORS', 'DETECTED_SERIAL', 'RECEIVED_SUBJECT', 'REPLY_TEMPLATE'],
  portal_reset_password: ['NAME', 'RESET_URL'],
  portal_renewal_stop_confirm: ['NAME', 'SERIAL', 'REQUEST_ID', 'TODAY'],
  portal_renewal_resume_confirm: ['NAME', 'SERIAL', 'REQUEST_ID', 'INCLUDE_QUOTE', 'TODAY'],
  manual_renewal_confirm: ['CUSTOMER_NAME', 'SERIAL_NUMBER', 'MAIN_PRODUCT', 'PREVIOUS_EXPIRY_DATE', 'EXPIRY_DATE', 'SALES_MANAGER'],
  portal_credit_notify_admin: ['REQUEST_ID', 'CUSTOMER_NAME', 'ADDRESS', 'ACCOUNT_NAME', 'LOGIN_ID', 'EMAIL', 'EXOCAD_ID', 'PACKAGE_LABEL', 'PACKAGE_QTY', 'PACKAGE_PRICE', 'TODAY'],
  portal_credit_confirm: ['NAME', 'PACKAGE_LABEL', 'EXOCAD_ID', 'REQUEST_ID', 'TODAY'],
  cancel_confirmation: ['CUSTOMER_NAME', 'SERIAL_NUMBER', 'MAIN_PRODUCT', 'TODAY'],
};

interface Props {
  onInsert: (variable: string) => void;
  /** Template code — used to narrow the chip list to variables actually used by that built-in template. */
  code?: string;
}

export default function VariableChips({ onInsert, code }: Props) {
  const { lang } = useLang();
  const allowed = code ? TEMPLATE_CODE_VARS[code] : undefined;
  const visible = allowed ? VARS.filter(v => allowed.includes(v.key)) : VARS;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
      {visible.map(v => (
        <button
          key={v.key}
          type="button"
          onClick={() => onInsert(`{{${v.key}}}`)}
          title={`{{${v.key}}}`}
          style={{
            padding: '2px 10px',
            fontSize: 11,
            fontFamily: 'monospace',
            borderRadius: 12,
            border: '1px solid rgba(61,216,200,0.4)',
            background: 'var(--accent-dim)',
            color: 'var(--accent)',
            cursor: 'pointer',
            lineHeight: '18px',
          }}
        >
          {t(lang, v.labelKey)}
        </button>
      ))}
    </div>
  );
}
