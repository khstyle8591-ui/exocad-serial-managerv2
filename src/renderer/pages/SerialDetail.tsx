import React, { useState, useEffect } from 'react';
import type { SerialMailNoticeLog, SerialWithCustomer } from '../../shared/types';
import { useLang } from '../App';
import { t } from '../i18n';
import SerialForm from '../components/SerialForm';
import ConfirmModal from '../components/ConfirmModal';
import ModuleListEditor from '../components/ModuleListEditor';
import { api } from '../client';

interface Props {
  serialId: number;
  onBack: () => void;
  onUpdated: (serial: SerialWithCustomer) => void;
  onDeleted: (id: number) => void;
}

export default function SerialDetail({ serialId, onBack, onUpdated, onDeleted }: Props) {
  const { lang } = useLang();
  const [serial, setSerial] = useState<SerialWithCustomer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [mailLogs, setMailLogs] = useState<SerialMailNoticeLog[]>([]);
  const [showEdit, setShowEdit] = useState(false);
  const [confirm, setConfirm] = useState<{
    title: string; message: string; label: string; danger?: boolean; action: () => Promise<void>;
  } | null>(null);

    const reload = async () => {
    try {
      const s = await api.getSerial(serialId);
      if (!s) { setError(t(lang, 'serial_not_found')); return; }
      setSerial(s);
      const logs = await api.listSerialMailNoticeLogs(serialId) as SerialMailNoticeLog[];
      setMailLogs(logs);
    } catch (e: any) {
      setError(e?.message ?? t(lang, 'load_failed'));
    }
  };

  useEffect(() => {
    setLoading(true);
    reload().finally(() => setLoading(false));
  }, [serialId]);

  const doAction = async (action: () => Promise<SerialWithCustomer | undefined | void>) => {
    try {
      const result = await action();
      if (result) { setSerial(result); onUpdated(result); }
      else await reload();
    } catch (e: any) {
      alert(e?.message ?? t(lang, 'error_occurred'));
    } finally {
      setBusy('');
      setConfirm(null);
    }
  };

  const ask = (cfg: typeof confirm) => setConfirm(cfg);

  if (loading) return <div style={{ padding: 40, color: 'var(--text3)' }}>{t(lang, 'loading')}</div>;
  if (error || !serial) return (
    <div style={{ padding: 40 }}>
      <button onClick={onBack} style={backBtn}>{t(lang, 'btn_back')}</button>
      <p style={{ color: 'var(--red)' }}>{error || t(lang, 'no_data')}</p>
    </div>
  );

  const modules: string[] = (() => { try { return JSON.parse(serial.modules ?? '[]'); } catch { return []; } })();
  const isStop = serial.renewal_stop_requested === 1;

  return (
    <div style={{ padding: '24px 28px', maxWidth: 800 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={onBack} style={backBtn}>{t(lang, 'btn_back')}</button>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
          <code style={{ background: 'var(--bg3)', padding: '2px 8px', borderRadius: 6, fontSize: 17, color: 'var(--text)' }}>{serial.serial_number}</code>
        </h1>
        <StatusBadge status={serial.status} />
        {isStop && <span title={t(lang, 'serial_stop_requested')} style={{ color: 'var(--red)', fontSize: 18 }}>🛑</span>}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {serial.status === 'not-activated' && (
          <ActionButton
            label={`✅ ${t(lang, 'serial_activate_label')}`}
            color="var(--accent)"
            busy={busy === 'activate'}
            lang={lang}
            onClick={() => ask({
              title: t(lang, 'serial_activate_title'),
              message: t(lang, 'serial_activate_msg').replace('{sn}', serial.serial_number),
              label: t(lang, 'serial_activate_label'),
              action: async () => {
                setBusy('activate');
                const r = await api.activateSerial(serial.id);
                if (r) { setSerial(r); onUpdated(r); }
              },
            })}
          />
        )}

        <ActionButton
          label={`🔄 ${t(lang, 'serial_renew_label')}`}
          color="var(--blue)"
          busy={busy === 'renew'}
          lang={lang}
          onClick={() => ask({
            title: t(lang, 'serial_renew_title'),
            message: t(lang, 'serial_renew_msg').replace('{sn}', serial.serial_number),
            label: t(lang, 'serial_renew_label'),
            action: async () => {
              setBusy('renew');
              const r = await api.renewSerial(serial.id);
              if (r) { setSerial(r); onUpdated(r); }
            },
          })}
        />

        <ActionButton
          label={`🗂 ${t(lang, 'serial_canceldb_label')}`}
          color="var(--text3)"
          busy={busy === 'cancel-db'}
          lang={lang}
          onClick={() => ask({
            title: t(lang, 'serial_canceldb_title'),
            message: t(lang, 'serial_canceldb_msg'),
            label: t(lang, 'serial_canceldb_label'),
            danger: true,
            action: async () => {
              setBusy('cancel-db');
              const r = await api.cancelSerialDb(serial.id);
              if (r) { setSerial(r); onUpdated(r); }
            },
          })}
        />

        <ActionButton
          label={isStop ? `🟢 ${t(lang, 'serial_stop_cancel_label')}` : `🛑 ${t(lang, 'serial_stop_request_label')}`}
          color={isStop ? 'var(--accent)' : 'var(--red)'}
          busy={busy === 'stop'}
          lang={lang}
          onClick={() => ask({
            title: isStop ? t(lang, 'serial_stop_cancel_title') : t(lang, 'serial_stop_request_title'),
            message: isStop ? t(lang, 'serial_stop_cancel_msg') : t(lang, 'serial_stop_request_msg'),
            label: isStop ? t(lang, 'serial_stop_cancel_label') : t(lang, 'serial_stop_request_label'),
            danger: !isStop,
            action: async () => {
              setBusy('stop');
              await api.setStopRequested(serial.id, !isStop);
              await reload();
            },
          })}
        />

        <ActionButton label={`✏️ ${t(lang, 'edit')}`} color="var(--text2)" busy={false} lang={lang} onClick={() => setShowEdit(true)} />

        <ActionButton
          label={`🗑 ${t(lang, 'delete')}`}
          color="var(--red)"
          busy={false}
          lang={lang}
          onClick={() => ask({
            title: t(lang, 'serial_delete_title'),
            message: t(lang, 'serial_delete_msg').replace('{sn}', serial.serial_number),
            label: t(lang, 'delete'),
            danger: true,
            action: async () => {
              const r = await api.deleteSerial(serial.id);
              if (!r.success) { alert(r.error ?? t(lang, 'delete')); return; }
              onDeleted(serial.id);
            },
          })}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <Card title={t(lang, 'section_customer_info')}>
          <Field label={t(lang, 'label_customer_name')} value={serial.customer?.name} />
          <Field label={t(lang, 'label_email')}         value={serial.customer?.email} />
          <Field label={t(lang, 'label_phone')}         value={serial.customer?.phone} />
          <Field label={t(lang, 'label_address')}       value={serial.customer?.address} />
          <Field label={t(lang, 'label_dealer')}        value={serial.customer?.dealer} />
          <Field label={t(lang, 'label_manager')}       value={serial.customer?.sales_manager} />
        </Card>

        <Card title={t(lang, 'section_serial_info')}>
          <Field label={t(lang, 'label_purchase_date')}  value={serial.purchase_date?.slice(0, 10)} />
          <Field label={t(lang, 'label_expiry_date')}    value={serial.expiry_date?.slice(0, 10)} />
          <Field label={t(lang, 'label_activated_at')}   value={serial.activated_at?.slice(0, 10)} />
          <Field label={t(lang, 'label_engine_build')}   value={serial.engine_build} />
          <Field label={t(lang, 'label_version')}        value={serial.version} />
          <Field label={t(lang, 'label_main_product')}   value={serial.main_product} />
        </Card>
      </div>

      <Card title={t(lang, 'label_modules')}>
        <ModuleListEditor modules={modules} onChange={() => {}} disabled />
      </Card>

      {serial.notes && (
        <Card title={t(lang, 'label_notes')} style={{ marginTop: 16 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{serial.notes}</p>
        </Card>
      )}

      {isStop && serial.stop_requested_at && (
        <div style={{ marginTop: 16, padding: '10px 14px', background: 'var(--red-dim)', border: '1px solid rgba(240,82,82,0.3)', borderRadius: 8, fontSize: 13, color: 'var(--red)' }}>
          🛑 {t(lang, 'serial_stop_requested')}: {serial.stop_requested_at.slice(0, 16)}
        </div>
      )}

      <Card title={t(lang, 'section_mail_notice_history')} style={{ marginTop: 16 }}>
        {mailLogs.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text3)' }}>{t(lang, 'mail_notice_history_empty')}</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {mailLogs.map(log => (
              <div key={log.id} style={{
                display: 'grid',
                gridTemplateColumns: '120px 56px minmax(0, 1fr) 70px',
                gap: 10,
                alignItems: 'center',
                padding: '8px 0',
                borderBottom: '1px solid var(--border)',
                fontSize: 12,
              }}>
                <span style={{ color: 'var(--text2)' }}>{log.sent_at.slice(0, 16)}</span>
                <span style={{ color: 'var(--text3)' }}>D-{log.days_before}</span>
                <span style={{ minWidth: 0, color: 'var(--text)' }}>
                  <span style={{ fontWeight: 600 }}>{log.template_code}</span>
                  <span style={{ color: 'var(--text3)' }}> / {log.recipient_email}</span>
                  {log.message && log.status === 'failed' && (
                    <span style={{ display: 'block', color: 'var(--red)', marginTop: 2, overflowWrap: 'anywhere' }}>{log.message}</span>
                  )}
                </span>
                <span style={{
                  justifySelf: 'end',
                  color: log.status === 'sent' ? 'var(--accent)' : 'var(--red)',
                  fontWeight: 700,
                }}>
                  {log.status === 'sent' ? t(lang, 'mail_notice_status_sent') : t(lang, 'mail_notice_status_failed')}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {showEdit && (
        <SerialForm
          mode="edit"
          initial={serial}
          onSaved={s => { setSerial(s); onUpdated(s); setShowEdit(false); }}
          onClose={() => setShowEdit(false)}
        />
      )}

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.label}
          danger={confirm.danger}
          onConfirm={() => doAction(confirm.action)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    active:          { bg: 'rgba(34,197,94,0.15)',   color: '#22c55e' },
    cancelled:       { bg: 'rgba(239,68,68,0.15)',   color: '#fc8181' },
    expired:         { bg: 'rgba(245,158,11,0.15)',  color: '#fbbf24' },
    'not-activated': { bg: 'rgba(156,163,175,0.12)', color: 'var(--text3)' },
    broken:          { bg: 'rgba(167,139,250,0.15)', color: '#a78bfa' },
  };
  const c = map[status] ?? { bg: 'var(--bg3)', color: 'var(--text3)' };
  return (
    <span style={{ padding: '4px 12px', borderRadius: 14, fontSize: 12, fontWeight: 600, background: c.bg, color: c.color }}>
      {status}
    </span>
  );
}

function ActionButton({ label, color, busy, lang, onClick }: {
  label: string; color: string; busy: boolean; lang: import('../i18n').Language; onClick: () => void;
}) {
  return (
    <button onClick={onClick} disabled={busy} style={{
      padding: '7px 16px', borderRadius: 7, border: `1px solid ${color}40`,
      background: `${color}15`, color, cursor: busy ? 'default' : 'pointer',
      fontSize: 13, fontWeight: 500, opacity: busy ? 0.6 : 1,
    }}>
      {busy ? t(lang, 'processing') : label}
    </button>
  );
}

function Card({ title, children, style }: { title: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, background: 'var(--bg2)', ...style }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', marginBottom: 6, fontSize: 13 }}>
      <span style={{ width: 80, color: 'var(--text3)', flexShrink: 0 }}>{label}</span>
      <span style={{ color: 'var(--text)' }}>{value}</span>
    </div>
  );
}

const backBtn: React.CSSProperties = {
  padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border2)',
  background: 'var(--bg3)', cursor: 'pointer', fontSize: 13, color: 'var(--text)',
};
