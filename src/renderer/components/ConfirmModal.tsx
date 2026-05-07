/**
 * ConfirmModal.tsx — Generic yes/no confirmation dialog.
 */
import React from 'react';

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({ title, message, confirmLabel = '확인', danger = false, onConfirm, onCancel }: Props) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000,
    }}>
      <div style={{
        background: 'var(--bg2)', borderRadius: 12, width: 400, padding: 28,
        boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
        border: '1px solid var(--border2)',
      }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{title}</h3>
        <p style={{ margin: '0 0 24px', color: 'var(--text2)', fontSize: 14, lineHeight: 1.6 }}>{message}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} className="btn btn-secondary">
            취소
          </button>
          <button onClick={onConfirm} className={danger ? 'btn btn-danger' : 'btn btn-primary'}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
