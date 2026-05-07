import React from 'react';

const VARS: { key: string; label: string }[] = [
  { key: 'CUSTOMER_NAME', label: '顧客名' },
  { key: 'CUSTOMER_EMAIL', label: 'メール' },
  { key: 'SERIAL_NUMBER', label: 'シリアル' },
  { key: 'EXPIRY_DATE', label: '有効期限' },
  { key: 'PURCHASE_DATE', label: '購入日' },
  { key: 'MAIN_PRODUCT', label: '製品名' },
  { key: 'MODULES', label: 'Add-on' },
  { key: 'TODAY', label: '今日' },
  { key: 'DEALER', label: 'ディーラー' },
  { key: 'SALES_MANAGER', label: '担当者' },
];

interface Props {
  onInsert: (variable: string) => void;
}

export default function VariableChips({ onInsert }: Props) {
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
          {v.label}
        </button>
      ))}
    </div>
  );
}
