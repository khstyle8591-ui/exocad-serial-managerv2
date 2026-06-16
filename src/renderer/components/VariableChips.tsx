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
];

interface Props {
  onInsert: (variable: string) => void;
}

export default function VariableChips({ onInsert }: Props) {
  const { lang } = useLang();
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
      {VARS.map(v => (
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
