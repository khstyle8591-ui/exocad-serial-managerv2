import React, { useEffect, useState } from 'react';
import type { BulkUpdatePreview, BulkRowResult } from '../../shared/types';
import { useLang } from '../App';
import { t } from '../i18n';
import { api } from '../client';

type Phase = 'loading' | 'preview' | 'applying' | 'done' | 'error';

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default function BulkUpdateModal({
  file, onClose, onApplied,
}: {
  file: File;
  onClose: () => void;
  onApplied: () => void;
}) {
  const { lang } = useLang();
  const [phase, setPhase] = useState<Phase>('loading');
  const [preview, setPreview] = useState<BulkUpdatePreview | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await api.bulkUpdate(file, 'preview');
        if (!cancelled) { setPreview(p); setPhase('preview'); }
      } catch (e) {
        if (!cancelled) { setErr(errMsg(e)); setPhase('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [file]);

  const applyableCount = preview
    ? preview.rows.filter(r => r.action === 'insert' || (r.action === 'update' && r.changes.some(c => c.status === 'apply'))).length
    : 0;

  const handleApply = async () => {
    setPhase('applying');
    try {
      const p = await api.bulkUpdate(file, 'apply');
      setPreview(p);
      setPhase('done');
    } catch (e) {
      setErr(errMsg(e));
      setPhase('error');
    }
  };

  const shownRows = preview ? preview.rows.filter(r => r.action !== 'skip') : [];

  return (
    <div style={overlay} onClick={phase === 'preview' || phase === 'error' ? onClose : undefined}>
      <div style={card} onClick={e => e.stopPropagation()}>
        <div style={header}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>{t(lang, 'bu_title')}</h2>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>{file.name}</span>
        </div>

        {(phase === 'loading' || phase === 'applying') && (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text3)', fontSize: 14 }}>
            {t(lang, phase === 'loading' ? 'bu_analyzing' : 'bu_applying')}
          </div>
        )}

        {phase === 'error' && (
          <div style={{ padding: 24 }}>
            <div style={{ color: '#fc8181', fontSize: 13, marginBottom: 20 }}>⚠ {err}</div>
            <div style={{ textAlign: 'right' }}>
              <button style={btnOutline} onClick={onClose}>{t(lang, 'bu_close')}</button>
            </div>
          </div>
        )}

        {(phase === 'preview' || phase === 'done') && preview && (
          <>
            {phase === 'done' && (
              <div style={doneBanner}>
                ✓ {t(lang, 'bu_done_title')} — {t(lang, 'bu_done_msg')
                  .replace('{ins}', String(preview.summary.insert))
                  .replace('{upd}', String(preview.summary.update))}
                {preview.backupPath && (
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                    {t(lang, 'bu_backup').replace('{file}', preview.backupPath.split(/[\\/]/).pop() ?? preview.backupPath)}
                  </div>
                )}
              </div>
            )}

            <div style={summaryRow}>
              <SumBadge label={t(lang, 'bu_sum_insert')} n={preview.summary.insert} color="#22c55e" />
              <SumBadge label={t(lang, 'bu_sum_update')} n={preview.summary.update} color="var(--accent)" />
              <SumBadge label={t(lang, 'bu_sum_skip')} n={preview.summary.skip} color="var(--text3)" />
              <SumBadge label={t(lang, 'bu_sum_conflict')} n={preview.summary.conflict} color="#fbbf24" />
              <SumBadge label={t(lang, 'bu_sum_error')} n={preview.summary.error} color="#fc8181" />
            </div>

            {!preview.hasSnapshot && (
              <div style={warnBanner}>{t(lang, 'bu_no_snapshot')}</div>
            )}
            {preview.summary.conflict > 0 && (
              <div style={infoBanner}>{t(lang, 'bu_conflict_note')}</div>
            )}

            <div style={{ fontSize: 11, color: 'var(--text3)', padding: '4px 20px' }}>
              {t(lang, 'bu_only_changes')
                .replace('{shown}', String(shownRows.length))
                .replace('{total}', String(preview.summary.total))}
            </div>

            <div style={tableWrap}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg3)', position: 'sticky', top: 0 }}>
                    <th style={{ ...bth, width: 48 }}>{t(lang, 'bu_col_row')}</th>
                    <th style={bth}>{t(lang, 'bu_col_serial')}</th>
                    <th style={{ ...bth, width: 72 }}>{t(lang, 'bu_col_action')}</th>
                    <th style={bth}>{t(lang, 'bu_col_changes')}</th>
                  </tr>
                </thead>
                <tbody>
                  {shownRows.map(r => (
                    <BulkRow key={r.rowNum} r={r} lang={lang} />
                  ))}
                </tbody>
              </table>
            </div>

            <div style={footer}>
              {phase === 'preview' ? (
                <>
                  <button style={btnOutline} onClick={onClose}>{t(lang, 'bu_cancel')}</button>
                  <button
                    style={{ ...btnPrimary, opacity: applyableCount === 0 ? 0.5 : 1, cursor: applyableCount === 0 ? 'not-allowed' : 'pointer' }}
                    disabled={applyableCount === 0}
                    onClick={handleApply}
                  >
                    {applyableCount === 0
                      ? t(lang, 'bu_nothing')
                      : t(lang, 'bu_apply_btn').replace('{n}', String(applyableCount))}
                  </button>
                </>
              ) : (
                <button style={btnPrimary} onClick={() => { onApplied(); onClose(); }}>{t(lang, 'bu_close')}</button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BulkRow({ r, lang }: { r: BulkRowResult; lang: string }) {
  const badge = r.action === 'insert'
    ? { label: 'bu_act_insert', bg: 'rgba(34,197,94,0.15)', color: '#22c55e' }
    : r.action === 'error'
      ? { label: 'bu_act_error', bg: 'rgba(239,68,68,0.15)', color: '#fc8181' }
      : { label: 'bu_act_update', bg: 'rgba(61,216,200,0.12)', color: 'var(--accent)' };
  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td style={{ ...btd, color: 'var(--text3)' }}>{r.rowNum}</td>
      <td style={btd}>
        <code style={{ fontSize: 11, background: 'var(--bg3)', padding: '1px 5px', borderRadius: 3, color: 'var(--text)' }}>
          {r.serial_number || '—'}
        </code>
      </td>
      <td style={btd}>
        <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600, background: badge.bg, color: badge.color }}>
          {t(lang as any, badge.label as any)}
        </span>
      </td>
      <td style={btd}>
        {r.action === 'error'
          ? <span style={{ color: '#fc8181' }}>{r.error}</span>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {r.warning && <span style={{ color: '#fbbf24', fontSize: 10 }}>⚠ {r.warning}</span>}
              {r.changes.map((c, i) => (
                <div key={i} style={{ color: c.status === 'conflict' ? '#fbbf24' : 'var(--text2)' }}>
                  {c.status === 'conflict' ? '⚠ ' : ''}
                  <b style={{ color: 'var(--text)' }}>{c.field}</b>:{' '}
                  <span style={{ color: 'var(--text3)' }}>{c.from || '∅'}</span>
                  {' → '}
                  <span>{c.to || '∅'}</span>
                </div>
              ))}
            </div>
          )}
      </td>
    </tr>
  );
}

function SumBadge({ label, n, color }: { label: string; n: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 18, fontWeight: 700, color }}>{n}</span>
      <span style={{ fontSize: 11, color: 'var(--text3)' }}>{label}</span>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
};
const card: React.CSSProperties = {
  background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12,
  width: '100%', maxWidth: 860, maxHeight: '86vh', display: 'flex', flexDirection: 'column',
  boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
};
const header: React.CSSProperties = {
  padding: '18px 20px', borderBottom: '1px solid var(--border)',
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
};
const summaryRow: React.CSSProperties = {
  display: 'flex', gap: 24, flexWrap: 'wrap', padding: '16px 20px 8px',
};
const tableWrap: React.CSSProperties = {
  flex: 1, overflow: 'auto', margin: '4px 20px 0', border: '1px solid var(--border)', borderRadius: 8, minHeight: 120,
};
const footer: React.CSSProperties = {
  padding: '16px 20px', borderTop: '1px solid var(--border)',
  display: 'flex', justifyContent: 'flex-end', gap: 10,
};
const doneBanner: React.CSSProperties = {
  margin: '16px 20px 0', padding: '10px 14px', borderRadius: 8, fontSize: 13,
  background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e',
};
const warnBanner: React.CSSProperties = {
  margin: '8px 20px 0', padding: '8px 12px', borderRadius: 6, fontSize: 12,
  background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#fbbf24',
};
const infoBanner: React.CSSProperties = {
  margin: '8px 20px 0', padding: '8px 12px', borderRadius: 6, fontSize: 12,
  background: 'rgba(61,216,200,0.06)', border: '1px solid rgba(61,216,200,0.2)', color: 'var(--text2)',
};
const bth: React.CSSProperties = {
  padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 600,
  color: 'var(--text3)', borderBottom: '1px solid var(--border)',
};
const btd: React.CSSProperties = {
  padding: '7px 10px', verticalAlign: 'top', color: 'var(--text)',
};
const btnPrimary: React.CSSProperties = {
  padding: '8px 18px', borderRadius: 7, background: 'var(--accent)', color: '#0d1117',
  border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13,
};
const btnOutline: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 7, background: 'var(--bg3)', color: 'var(--text)',
  border: '1px solid var(--border2)', cursor: 'pointer', fontSize: 13,
};
