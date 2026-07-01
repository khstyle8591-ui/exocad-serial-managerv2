/**

import { api } from '../client';
/**
 * LegacyImportWizard.tsx — 4-step legacy DB migration modal (dark theme)
 */
import React, { useState, useEffect, useCallback } from 'react';
import type { MergeCandidate, CustomerInput, LegacyImportResult } from '../../shared/types';
import { useLang } from '../App';
import { t } from '../i18n';
import { translateServerError } from '../utils/serverError';

interface LegacyRow {
  id: number;
  serial_number: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  customer_address: string;
  customer_manager: string;
  purchase_date: string | null;
  expiry_date: string | null;
  status: string;
  engine_build: string;
  version: string;
  add_ons: string;
  notes: string;
  has_unprocessed_stop_request: boolean;
}

type CustomerDecision =
  | { kind: 'existing'; customer_id: number; customer_name: string }
  | { kind: 'new'; data: CustomerInput };

interface RowDecision {
  customer: CustomerDecision;
  set_stop_requested: boolean;
  status_override: string;
  notes_override: string;
}

interface WizardProps {
  onClose: () => void;
  onDone: () => void;
}

function StepBar({ current }: { current: number }) {
  const { lang } = useLang();
  const steps = ['legacy_step_select', 'legacy_step_merge', 'legacy_step_review', 'legacy_step_run'];
  return (
    <div style={{ display: 'flex', gap: 0, marginBottom: 24 }}>
      {steps.map((label, i) => {
        const idx = i + 1;
        const done = idx < current;
        const active = idx === current;
        return (
          <React.Fragment key={idx}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600,
                background: done ? '#22c55e' : active ? 'var(--accent)' : 'var(--bg4)',
                color: done || active ? '#0d1117' : 'var(--text3)',
              }}>
                {done ? '✓' : idx}
              </div>
              <div style={{ fontSize: 11, color: active ? 'var(--accent)' : 'var(--text3)', marginTop: 4 }}>{t(lang, label as any)}</div>
            </div>
            {i < steps.length - 1 && (
              <div style={{ height: 2, flex: 1, background: done ? '#22c55e' : 'var(--border)', marginTop: 13 }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default function LegacyImportWizard({ onClose, onDone }: WizardProps) {
  const { lang } = useLang();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [rows, setRows] = useState<LegacyRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const [suggestions, setSuggestions] = useState<Record<number, MergeCandidate[]>>({});
  const [decisions, setDecisions] = useState<Record<number, RowDecision>>({});

  const [results, setResults] = useState<Record<number, LegacyImportResult & { serial_number: string }>>({});
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);

    useEffect(() => {
    setLoading(true);
    const filter = statusFilter.length > 0 ? { status: statusFilter } : undefined;
    api.listLegacySerials(filter)
      .then((data: any[]) => setRows(data as LegacyRow[]))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  const allStatuses = ['active', 'cancelled', 'expired', 'not-activated', 'broken'];
  const filteredRows = rows;

  const toggleRow = (id: number) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected(prev =>
      prev.size === filteredRows.length
        ? new Set()
        : new Set(filteredRows.map(r => r.id))
    );

  const loadSuggestions = useCallback(async () => {
    setLoading(true);
    const newSuggestions: Record<number, MergeCandidate[]> = {};
    const newDecisions: Record<number, RowDecision> = { ...decisions };

    for (const id of Array.from(selected)) {
      const row = rows.find(r => r.id === id);
      if (!row) continue;
      try {
        const candidates = await api.suggestLegacyMerge({
          customer_name: row.customer_name,
          customer_email: row.customer_email,
          customer_phone: row.customer_phone,
        });
        newSuggestions[id] = candidates;

        if (!newDecisions[id]) {
          const top = candidates[0];
          newDecisions[id] = {
            customer: top && top.score >= 0.8
              ? { kind: 'existing', customer_id: top.customer.id, customer_name: top.customer.name }
              : { kind: 'new', data: {
                  name: row.customer_name,
                  email: row.customer_email,
                  phone: row.customer_phone,
                  address: row.customer_address,
                  sales_manager: row.customer_manager,
                } },
            set_stop_requested: false,
            status_override: row.status,
            notes_override: row.notes,
          };
        }
      } catch {
        newSuggestions[id] = [];
      }
    }

    setSuggestions(newSuggestions);
    setDecisions(newDecisions);
    setLoading(false);
  }, [selected, rows]);

  const runImport = async () => {
    setImporting(true);
    const newResults: typeof results = {};

    for (const id of Array.from(selected)) {
      const row = rows.find(r => r.id === id);
      const decision = decisions[id];
      if (!row || !decision) continue;

      const input = {
        legacy_id: id,
        target_customer: decision.customer.kind === 'existing'
          ? { kind: 'existing' as const, customer_id: decision.customer.customer_id }
          : { kind: 'new' as const, data: decision.customer.data },
        set_stop_requested: decision.set_stop_requested,
        status_override: decision.status_override as any,
        field_overrides: decision.notes_override !== row.notes
          ? { notes: decision.notes_override }
          : undefined,
      };

      const result = await api.importLegacySerial(input);
      newResults[id] = { ...result, serial_number: row.serial_number };
    }

    setResults(newResults);
    setImporting(false);
    setImportDone(true);
  };

  const goNext = async () => {
    if (step === 1) {
      if (selected.size === 0) { setError(t(lang, 'legacy_select_required')); return; }
      setError('');
      await loadSuggestions();
      setStep(2);
    } else if (step === 2) {
      setError('');
      setStep(3);
    } else if (step === 3) {
      setStep(4);
      await runImport();
    }
  };

  const goBack = () => {
    if (step > 1 && !importing) setStep(step - 1);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: 'var(--bg2)', borderRadius: 12, width: 860, maxHeight: '90vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)', border: '1px solid var(--border2)',
      }}>
        <div style={{ padding: '20px 28px 0', borderBottom: '1px solid var(--border)', paddingBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{t(lang, 'legacy_title')}</h2>
            {!importing && (
              <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text3)' }}>✕</button>
            )}
          </div>
          <StepBar current={step} />
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '20px 28px' }}>
          {error && (
            <div style={{ background: 'rgba(220,38,38,0.15)', border: '1px solid rgba(220,38,38,0.4)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#fc8181', fontSize: 13 }}>
              {error}
            </div>
          )}

          {step === 1 && <Step1
            rows={filteredRows} loading={loading} selected={selected}
            statusFilter={statusFilter} allStatuses={allStatuses}
            onToggleRow={toggleRow} onToggleAll={toggleAll} onStatusFilter={setStatusFilter}
          />}
          {step === 2 && <Step2
            rows={rows.filter(r => selected.has(r.id))} suggestions={suggestions}
            decisions={decisions}
            onDecisionChange={(id, d) => setDecisions(prev => ({ ...prev, [id]: d }))}
          />}
          {step === 3 && <Step3
            rows={rows.filter(r => selected.has(r.id))} decisions={decisions}
            onDecisionChange={(id, d) => setDecisions(prev => ({ ...prev, [id]: d }))}
          />}
          {step === 4 && <Step4
            rows={rows.filter(r => selected.has(r.id))} results={results} importing={importing}
          />}
        </div>

        <div style={{ padding: '16px 28px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
          <div>
            {step > 1 && step < 4 && !importing && (
              <button onClick={goBack} style={btnSecondary}>{t(lang, 'legacy_prev')}</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {!importDone && step < 4 && !importing && (
              <button onClick={onClose} style={btnSecondary}>{t(lang, 'cancel')}</button>
            )}
            {step < 4 && (
              <button onClick={goNext} disabled={loading || importing} style={btnPrimary}>
                {step === 3 ? t(lang, 'legacy_run') : t(lang, 'legacy_next')}
              </button>
            )}
            {importDone && (
              <button onClick={onDone} style={btnPrimary}>{t(lang, 'done')}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Step1({ rows, loading, selected, statusFilter, allStatuses, onToggleRow, onToggleAll, onStatusFilter }: {
  rows: LegacyRow[]; loading: boolean; selected: Set<number>;
  statusFilter: string[]; allStatuses: string[];
  onToggleRow: (id: number) => void; onToggleAll: () => void; onStatusFilter: (f: string[]) => void;
}) {
  const { lang } = useLang();
  const toggleStatus = (s: string) =>
    onStatusFilter(statusFilter.includes(s) ? statusFilter.filter(x => x !== s) : [...statusFilter, s]);

  return (
    <div>
      <p style={{ margin: '0 0 12px', color: 'var(--text3)', fontSize: 13 }}>
        {t(lang, 'legacy_step1_desc').replace('{selected}', String(selected.size)).replace('{total}', String(rows.length))}
      </p>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text3)', lineHeight: '24px' }}>{t(lang, 'filter_status')}</span>
        {allStatuses.map(s => (
          <button key={s} onClick={() => toggleStatus(s)} style={{
            padding: '2px 10px', borderRadius: 12, fontSize: 12, cursor: 'pointer', border: '1px solid',
            background: statusFilter.includes(s) ? 'var(--accent)' : 'var(--bg3)',
            color: statusFilter.includes(s) ? '#0d1117' : 'var(--text)',
            borderColor: statusFilter.includes(s) ? 'var(--accent)' : 'var(--border)',
          }}>
            {s}
          </button>
        ))}
        {statusFilter.length > 0 && (
          <button onClick={() => onStatusFilter([])} style={{ fontSize: 12, color: '#fc8181', border: 'none', background: 'none', cursor: 'pointer' }}>
            {t(lang, 'reset_filter')}
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>{t(lang, 'loading')}</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--bg3)' }}>
              <th style={th}><input type="checkbox" checked={selected.size === rows.length && rows.length > 0} onChange={onToggleAll} /></th>
              <th style={th}>{t(lang, 'col_serial')}</th>
              <th style={th}>{t(lang, 'col_customer')}</th>
              <th style={th}>{t(lang, 'label_email')}</th>
              <th style={th}>{t(lang, 'col_status')}</th>
              <th style={th}>{t(lang, 'col_expiry_date')}</th>
              <th style={th}>{t(lang, 'legacy_col_stop')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id} onClick={() => onToggleRow(row.id)} style={{
                cursor: 'pointer',
                background: selected.has(row.id) ? 'rgba(61,216,200,0.08)' : 'transparent',
                borderBottom: '1px solid var(--border)',
              }}>
                <td style={td}><input type="checkbox" checked={selected.has(row.id)} onChange={() => onToggleRow(row.id)} onClick={e => e.stopPropagation()} /></td>
                <td style={td}><code style={{ fontSize: 11, background: 'var(--bg3)', padding: '2px 5px', borderRadius: 3 }}>{row.serial_number}</code></td>
                <td style={td}>{row.customer_name}</td>
                <td style={td}>{row.customer_email}</td>
                <td style={td}><StatusBadge status={row.status} /></td>
                <td style={td}>{row.expiry_date?.slice(0, 10) ?? '-'}</td>
                <td style={{ ...td, textAlign: 'center' }}>
                  {row.has_unprocessed_stop_request ? <span style={{ color: '#f59e0b' }}>⚠</span> : '-'}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--text3)' }}>{t(lang, 'legacy_empty')}</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Step2({ rows, suggestions, decisions, onDecisionChange }: {
  rows: LegacyRow[]; suggestions: Record<number, MergeCandidate[]>;
  decisions: Record<number, RowDecision>; onDecisionChange: (id: number, d: RowDecision) => void;
}) {
  const { lang } = useLang();
  return (
    <div>
      <p style={{ margin: '0 0 16px', color: 'var(--text3)', fontSize: 13 }}>{t(lang, 'legacy_step2_desc')}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {rows.map(row => {
          const dec = decisions[row.id];
          const cands = suggestions[row.id] ?? [];
          if (!dec) return <div key={row.id} style={{ color: 'var(--text3)', fontSize: 12 }}>{t(lang, 'loading')} ({row.serial_number})</div>;

          return (
            <div key={row.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <strong style={{ fontSize: 13, color: 'var(--text)' }}>{row.serial_number}</strong>
                <span style={{ fontSize: 12, color: 'var(--text3)' }}>{row.customer_name} / {row.customer_email}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {cands.map(c => (
                  <label key={c.customer.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', color: 'var(--text)' }}>
                    <input
                      type="radio"
                      checked={dec.customer.kind === 'existing' && dec.customer.customer_id === c.customer.id}
                      onChange={() => onDecisionChange(row.id, { ...dec, customer: { kind: 'existing', customer_id: c.customer.id, customer_name: c.customer.name } })}
                    />
                    <span>
                      <span style={{ color: scoreColor(c.score) }}>●</span>{' '}
                      <strong>{c.customer.name}</strong>
                      <span style={{ color: 'var(--text3)', marginLeft: 4 }}>({c.matched_field}) — {c.customer.email || c.customer.phone}</span>
                      <span style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 4 }}>score {c.score.toFixed(1)}</span>
                    </span>
                  </label>
                ))}
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', color: 'var(--text)' }}>
                  <input
                    type="radio"
                    checked={dec.customer.kind === 'new'}
                    onChange={() => onDecisionChange(row.id, { ...dec, customer: { kind: 'new', data: { name: row.customer_name, email: row.customer_email, phone: row.customer_phone, address: row.customer_address, sales_manager: row.customer_manager } } })}
                  />
                  <span style={{ color: 'var(--accent)' }}>✦ {t(lang, 'legacy_create_customer').replace('{name}', row.customer_name)}</span>
                </label>
              </div>
              {row.has_unprocessed_stop_request && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 12, color: '#f59e0b', cursor: 'pointer' }}>
                  <input type="checkbox" checked={dec.set_stop_requested} onChange={e => onDecisionChange(row.id, { ...dec, set_stop_requested: e.target.checked })} />
                  {t(lang, 'legacy_stop_migrate')}
                </label>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Step3({ rows, decisions, onDecisionChange }: {
  rows: LegacyRow[]; decisions: Record<number, RowDecision>; onDecisionChange: (id: number, d: RowDecision) => void;
}) {
  const { lang } = useLang();
  const statusOptions = ['active', 'cancelled', 'expired', 'not-activated', 'broken'];
  return (
    <div>
      <p style={{ margin: '0 0 16px', color: 'var(--text3)', fontSize: 13 }}>{t(lang, 'legacy_step3_desc')}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.map(row => {
          const dec = decisions[row.id];
          if (!dec) return null;
          const customerLabel = dec.customer.kind === 'existing' ? `${t(lang, 'legacy_existing_prefix')}: ${dec.customer.customer_name}` : `${t(lang, 'customer_new_prefix')}: ${dec.customer.data.name}`;
          return (
            <div key={row.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 14, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <code style={{ fontSize: 12, color: 'var(--text)' }}>{row.serial_number}</code>
                <span style={{ color: 'var(--text3)' }}>{customerLabel}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
                <div>
                  <label style={labelStyle2}>{t(lang, 'col_status')}</label>
                  <select value={dec.status_override} onChange={e => onDecisionChange(row.id, { ...dec, status_override: e.target.value })} style={inputStyle2}>
                    {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle2}>{t(lang, 'col_expiry_date')}</label>
                  <input type="text" value={row.expiry_date?.slice(0, 10) ?? ''} disabled style={{ ...inputStyle2, opacity: 0.6 }} />
                </div>
                <div>
                  <label style={labelStyle2}>{t(lang, 'col_engine_build')}</label>
                  <input type="text" value={row.engine_build} disabled style={{ ...inputStyle2, opacity: 0.6 }} />
                </div>
                <div>
                  <label style={labelStyle2}>{t(lang, 'col_version')}</label>
                  <input type="text" value={row.version} disabled style={{ ...inputStyle2, opacity: 0.6 }} />
                </div>
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={labelStyle2}>{t(lang, 'label_notes')}</label>
                  <textarea value={dec.notes_override} onChange={e => onDecisionChange(row.id, { ...dec, notes_override: e.target.value })} style={{ ...inputStyle2, height: 48, resize: 'vertical' }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Step4({ rows, results, importing }: {
  rows: LegacyRow[]; results: Record<number, LegacyImportResult & { serial_number: string }>; importing: boolean;
}) {
  const { lang } = useLang();
  const done = Object.keys(results).length;
  const total = rows.length;
  const success = Object.values(results).filter(r => r.success).length;
  const failed = Object.values(results).filter(r => !r.success).length;

  return (
    <div>
      {importing ? (
        <div>
          <p style={{ color: 'var(--text3)', fontSize: 13 }}>{t(lang, 'legacy_processing').replace('{done}', String(done)).replace('{total}', String(total))}</p>
          <div style={{ background: 'var(--bg3)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
            <div style={{ background: 'var(--accent)', height: '100%', width: `${(done / total) * 100}%`, transition: 'width 0.3s' }} />
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
            <div style={{ padding: '10px 20px', borderRadius: 8, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#22c55e' }}>{success}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>{t(lang, 'success')}</div>
            </div>
            {failed > 0 && (
              <div style={{ padding: '10px 20px', borderRadius: 8, background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)', textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#fc8181' }}>{failed}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>{t(lang, 'fail')}</div>
              </div>
            )}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--bg3)' }}>
                <th style={th}>{t(lang, 'col_serial')}</th>
                <th style={th}>{t(lang, 'result')}</th>
                <th style={th}>{t(lang, 'detail')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const result = results[row.id];
                if (!result) return null;
                return (
                  <tr key={row.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={td}><code style={{ color: 'var(--text)' }}>{row.serial_number}</code></td>
                    <td style={td}>
                      {result.success
                        ? <span style={{ color: '#22c55e' }}>✓ {t(lang, 'success')}</span>
                        : <span style={{ color: '#fc8181' }}>✗ {t(lang, 'fail')}</span>}
                    </td>
                    <td style={{ ...td, color: 'var(--text3)' }}>{result.error ? translateServerError(result.error, lang) : `id=${result.serial_id}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { lang } = useLang();
  const colors: Record<string, { bg: string; text: string }> = {
    active: { bg: 'rgba(34,197,94,0.15)', text: '#22c55e' },
    cancelled: { bg: 'rgba(239,68,68,0.15)', text: '#fc8181' },
    expired: { bg: 'rgba(245,158,11,0.15)', text: '#fbbf24' },
    'not-activated': { bg: 'rgba(156,163,175,0.15)', text: 'var(--text3)' },
    broken: { bg: 'rgba(167,139,250,0.15)', text: '#a78bfa' },
  };
  const labels: Record<string, string> = {
    active: t(lang, 'status_active'),
    cancelled: t(lang, 'status_cancelled'),
    expired: t(lang, 'status_expired'),
    'not-activated': t(lang, 'status_not_activated'),
    broken: t(lang, 'status_broken'),
  };
  const c = colors[status] ?? { bg: 'var(--bg3)', text: 'var(--text3)' };
  return (
    <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, background: c.bg, color: c.text }}>
      {labels[status] ?? status}
    </span>
  );
}

function scoreColor(score: number): string {
  if (score >= 0.9) return '#22c55e';
  if (score >= 0.7) return '#fbbf24';
  return 'var(--text3)';
}

const th: React.CSSProperties = {
  padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 600,
  color: 'var(--text3)', borderBottom: '2px solid var(--border)',
};
const td: React.CSSProperties = {
  padding: '7px 10px', verticalAlign: 'middle', color: 'var(--text)',
};
const btnPrimary: React.CSSProperties = {
  padding: '8px 20px', borderRadius: 6, background: 'var(--accent)', color: '#0d1117',
  border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13,
};
const btnSecondary: React.CSSProperties = {
  padding: '8px 20px', borderRadius: 6, background: 'var(--bg3)', color: 'var(--text)',
  border: '1px solid var(--border2)', cursor: 'pointer', fontSize: 13,
};
const labelStyle2: React.CSSProperties = {
  display: 'block', fontSize: 11, color: 'var(--text3)', marginBottom: 3,
};
const inputStyle2: React.CSSProperties = {
  width: '100%', padding: '5px 8px', border: '1px solid var(--border2)',
  borderRadius: 4, fontSize: 12, boxSizing: 'border-box',
  background: 'var(--bg3)', color: 'var(--text)',
};
