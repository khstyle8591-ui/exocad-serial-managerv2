import type { ReactNode } from 'react';

interface Props {
  open: boolean;
  title?: string;
  onClose: () => void;
  closeLabel: string;
  children: ReactNode;
}

export default function Modal({ open, title, onClose, closeLabel, children }: Props) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg2)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          maxWidth: 420, width: '100%',
          padding: 24,
          boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
        }}
      >
        {title && (
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>
            {title}
          </div>
        )}
        <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, whiteSpace: 'pre-line' }}>
          {children}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="btn btn-primary" onClick={onClose}>{closeLabel}</button>
        </div>
      </div>
    </div>
  );
}
