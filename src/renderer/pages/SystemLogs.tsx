import React, { useEffect, useState } from 'react';
import { useLang } from '../App';
import { t } from '../i18n';
import { api } from '../client';
import type { AutoRenewalOrderNoticeLog } from '../../shared/types';

interface SystemLogsResponse {
    systemLogs?: string[];
    relatedEmails?: string[];
    adminReviews?: AdminReview[];
}

interface AdminReview {
    id: number;
    received_at: string;
    mail_from: string;
    subject: string;
    extracted_serial: string | null;
    response_errors: string;
    response_attempt: number;
}

function parseErrors(raw: string): string {
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.join(', ') : raw;
    } catch {
        return raw;
    }
}

export default function SystemLogs() {
    const { lang } = useLang();
    const [systemLogs, setSystemLogs] = useState<string[]>([]);
    const [relatedEmails, setRelatedEmails] = useState<string[]>([]);
    const [adminReviews, setAdminReviews] = useState<AdminReview[]>([]);
    const [loading, setLoading] = useState(true);
    const [dateStr, setDateStr] = useState<string>(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }));
    const [viewingMailId, setViewingMailId] = useState<number | null>(null);
    const [mailBody, setMailBody] = useState<string>('');
    const [autoRenewalOrderNotices, setAutoRenewalOrderNotices] = useState<AutoRenewalOrderNoticeLog[]>([]);
    const [viewingOrderNotice, setViewingOrderNotice] = useState<AutoRenewalOrderNoticeLog | null>(null);

    useEffect(() => { loadLogs(); }, [dateStr]);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const mailId = params.get('mailId');
        if (mailId) {
            openMailPopup(Number(mailId));
        }
    }, []);

    const loadLogs = async () => {
        setLoading(true);
        try {
            const [data, notices] = await Promise.all([
                api.getSystemLogs(dateStr) as Promise<SystemLogsResponse>,
                api.listAutoRenewalOrderNotices(100) as Promise<AutoRenewalOrderNoticeLog[]>,
            ]);
            setSystemLogs(data.systemLogs || []);
            setRelatedEmails(data.relatedEmails || []);
            setAdminReviews(data.adminReviews || []);
            setAutoRenewalOrderNotices(notices || []);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const openMailPopup = async (id: number) => {
        setViewingMailId(id);
        setMailBody(t(lang, 'system_mail_loading'));
        try {
            const body = await api.getCapturedMail(id);
            setMailBody(body);
        } catch (err) {
            setMailBody(t(lang, 'system_mail_load_fail'));
        }
    };

    return (
        <div style={{ position: 'relative', height: '100%', overflowY: 'auto', paddingBottom: 24 }}>
            {/* 메일 팝업 모달 */}
            {viewingMailId && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
                }} onClick={() => setViewingMailId(null)}>
                    <div style={{
                        backgroundColor: 'white', padding: 20, borderRadius: 8, width: '80%', maxHeight: '80%',
                        overflow: 'auto', position: 'relative', boxShadow: '0 4px 20px rgba(0,0,0,0.2)'
                    }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
                            <h3 style={{ margin: 0 }}>{t(lang, 'system_mail_view_title').replace('{id}', String(viewingMailId))}</h3>
                            <button className="btn btn-secondary" onClick={() => setViewingMailId(null)}>{t(lang, 'close')}</button>
                        </div>
                        <div style={{
                            padding: 15, border: '1px solid #eee', borderRadius: 4, background: '#f9f9f9',
                            whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 14, minHeight: 200
                        }} dangerouslySetInnerHTML={{ __html: mailBody.includes('<') && mailBody.includes('>') ? mailBody : `<pre style="white-space: pre-wrap">${mailBody}</pre>` }} />
                    </div>
                </div>
            )}

            {viewingOrderNotice && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
                }} onClick={() => setViewingOrderNotice(null)}>
                    <div style={{
                        backgroundColor: 'white', padding: 20, borderRadius: 8, width: '82%', maxHeight: '84%',
                        overflow: 'auto', position: 'relative', boxShadow: '0 4px 20px rgba(0,0,0,0.2)'
                    }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
                            <h3 style={{ margin: 0 }}>
                                {t(lang, 'auto_renewal_order_notice_view_title').replace('{id}', String(viewingOrderNotice.id))}
                            </h3>
                            <button className="btn btn-secondary" onClick={() => setViewingOrderNotice(null)}>{t(lang, 'close')}</button>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 8, marginBottom: 16, fontSize: 13 }}>
                            <strong>{t(lang, 'auto_renewal_order_notice_recipient')}</strong><span>{viewingOrderNotice.recipient_email || '-'}</span>
                            <strong>{t(lang, 'auto_renewal_order_notice_subject')}</strong><span>{viewingOrderNotice.subject || '-'}</span>
                            <strong>Status</strong>
                            <span style={{ color: viewingOrderNotice.status === 'sent' ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                                {viewingOrderNotice.status === 'sent'
                                    ? t(lang, 'auto_renewal_order_notice_status_sent')
                                    : t(lang, 'auto_renewal_order_notice_status_failed')}
                            </span>
                            <strong>{t(lang, 'auto_renewal_order_notice_message')}</strong><span>{viewingOrderNotice.message || '-'}</span>
                        </div>
                        <div style={{
                            padding: 15, border: '1px solid #eee', borderRadius: 4, background: '#f9f9f9',
                            fontSize: 14, minHeight: 200
                        }} dangerouslySetInnerHTML={{ __html: viewingOrderNotice.html_body || '<p>(본문 없음)</p>' }} />
                    </div>
                </div>
            )}

            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h1 className="page-title">{t(lang, 'nav_system_logs')}</h1>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <input
                        type="date"
                        value={dateStr}
                        onChange={e => setDateStr(e.target.value)}
                        style={{ padding: '6px 12px', border: '1px solid #e5e7eb', borderRadius: 6 }}
                    />
                    <button className="btn btn-secondary" onClick={loadLogs}>{t(lang, 'logs_btn_refresh')}</button>
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div className="table-container" style={{ border: '2px solid var(--yellow)' }}>
                    <h3 style={{ margin: 0, padding: '12px 16px', background: 'var(--bg3)', borderBottom: '1px solid var(--border)', fontSize: 16 }}>
                        {t(lang, 'admin_review_title').replace('{n}', String(adminReviews.length))}
                    </h3>
                    {adminReviews.length === 0 ? (
                        <div style={{ padding: 24, textAlign: 'center' }}>{t(lang, 'admin_review_empty')}</div>
                    ) : (
                        <div style={{ overflow: 'auto', maxHeight: '40vh' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead><tr>
                                    <th>{t(lang, 'admin_review_received')}</th><th>{t(lang, 'admin_review_sender')}</th>
                                    <th>{t(lang, 'admin_review_subject')}</th><th>{t(lang, 'admin_review_serial')}</th>
                                    <th>{t(lang, 'admin_review_errors')}</th><th>{t(lang, 'admin_review_attempt')}</th><th />
                                </tr></thead>
                                <tbody>{adminReviews.map(item => (
                                    <tr key={item.id} style={{ borderTop: '1px solid var(--border)' }}>
                                        <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{item.received_at}</td>
                                        <td style={{ padding: 8 }}>{item.mail_from}</td><td style={{ padding: 8 }}>{item.subject}</td>
                                        <td style={{ padding: 8 }}>{item.extracted_serial || '-'}</td>
                                        <td style={{ padding: 8 }}>{parseErrors(item.response_errors)}</td>
                                        <td style={{ padding: 8 }}>{item.response_attempt}</td>
                                        <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                                            <button className="btn btn-secondary" onClick={() => openMailPopup(item.id)}>{t(lang, 'view_content_bracket')}</button>
                                            <button className="btn btn-primary" style={{ marginLeft: 6 }} onClick={async () => { await api.resolveAdminReview(item.id); await loadLogs(); }}>{t(lang, 'admin_review_resolve')}</button>
                                        </td>
                                    </tr>
                                ))}</tbody>
                            </table>
                        </div>
                    )}
                </div>
                {/* === 상단: System Logs === */}
                <div className="table-container" style={{ flex: 1, minHeight: 300 }}>
                    <h3 style={{ margin: '0 0 10px 0', padding: '12px 16px', background: 'var(--bg3)', borderBottom: '1px solid var(--border)', fontSize: 16, color: 'var(--text)' }}>
                        🖥️ {t(lang, 'system_logs_title_count').replace('{n}', String(systemLogs.length))}
                    </h3>
                    {loading ? (
                        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text)' }}>{t(lang, 'loading')}</div>
                    ) : systemLogs.length === 0 ? (
                        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text)' }}>{t(lang, 'system_logs_empty_date')}</div>
                    ) : (
                        <div style={{ overflowX: 'auto', maxHeight: '40vh' }}>
                            <pre style={{ margin: 0, padding: 16, fontSize: 13, background: 'var(--bg4)', color: 'var(--text)', whiteSpace: 'pre-wrap', minHeight: '100%' }}>
                                {systemLogs.join('\n')}
                            </pre>
                        </div>
                    )}
                </div>

                {/* === 하단: 관련 메일 수신 알림 === */}
                <div className="table-container" style={{ flex: 1, minHeight: 300, border: '1px solid var(--yellow)' }}>
                    <h3 style={{ margin: '0 0 10px 0', padding: '12px 16px', background: 'var(--bg3)', borderBottom: '1px solid var(--border)', fontSize: 16, color: 'var(--text)' }}>
                        🔔 {t(lang, 'related_emails_title_count').replace('{n}', String(relatedEmails.length))}
                    </h3>
                    <p style={{ margin: '0 16px 10px', fontSize: 13, color: 'var(--text)' }}>{t(lang, 'related_emails_desc')}</p>
                    {loading ? (
                        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text)' }}>{t(lang, 'loading')}</div>
                    ) : relatedEmails.length === 0 ? (
                        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text)' }}>{t(lang, 'related_emails_empty')}</div>
                    ) : (
                        <div style={{ overflowX: 'auto', maxHeight: '40vh' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                    <tr style={{ background: 'var(--bg3)', borderBottom: '1px solid var(--border)' }}>
                                        <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text)' }}>Time</th>
                                        <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text)' }}>Detail</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {relatedEmails.map((log, idx) => {
                                        // example log format: "[2026-03-11T03:55:00.000Z] [INFO] [System Log] 관련 메일 수신 (키워드 매칭, 갱신 조건 미달): from=..., subject=... [mailId=123]"
                                        const timeMatch = log.match(/\[(.*?)\]/);
                                        const timeStr = timeMatch ? timeMatch[1] : '';
                                        const mailIdMatch = log.match(/\[mailId=(\d+)\]/);
                                        const mailId = mailIdMatch ? Number(mailIdMatch[1]) : null;
                                        const detail = log.split(']: ')[1]?.replace(/\[mailId=\d+\]/, '') || log;

                                        return (
                                            <tr key={idx} style={{
                                                borderBottom: '1px solid var(--border)',
                                                cursor: mailId ? 'pointer' : 'default',
                                                backgroundColor: mailId ? 'var(--bg3)' : 'transparent'
                                            }} onClick={() => mailId && openMailPopup(mailId)}>
                                                <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: 'var(--text)' }}>{timeStr}</td>
                                                <td style={{ padding: '8px 12px' }}>
                                                    {detail}
                                                    {mailId && <span style={{ marginLeft: 8, color: 'var(--accent)', textDecoration: 'underline', fontSize: 11 }}>{t(lang, 'view_content_bracket')}</span>}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                <div className="table-container" style={{ flex: 1, minHeight: 300, border: '1px solid var(--border)' }}>
                    <h3 style={{ margin: '0 0 10px 0', padding: '12px 16px', background: 'var(--bg3)', borderBottom: '1px solid var(--border)', fontSize: 16, color: 'var(--text)' }}>
                        {t(lang, 'auto_renewal_order_notices_title_count').replace('{n}', String(autoRenewalOrderNotices.length))}
                    </h3>
                    <p style={{ margin: '0 16px 10px', fontSize: 13, color: 'var(--text)' }}>{t(lang, 'auto_renewal_order_notices_desc')}</p>
                    {loading ? (
                        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text)' }}>{t(lang, 'loading')}</div>
                    ) : autoRenewalOrderNotices.length === 0 ? (
                        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text)' }}>{t(lang, 'auto_renewal_order_notices_empty')}</div>
                    ) : (
                        <div style={{ overflowX: 'auto', maxHeight: '40vh' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                    <tr style={{ background: 'var(--bg3)', borderBottom: '1px solid var(--border)' }}>
                                        <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text)' }}>Time</th>
                                        <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text)' }}>Status</th>
                                        <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text)' }}>Serial</th>
                                        <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text)' }}>Customer</th>
                                        <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text)' }}>Expiry</th>
                                        <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text)' }}>Recipient</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {autoRenewalOrderNotices.map(notice => {
                                        const statusLabel = notice.status === 'sent'
                                            ? t(lang, 'auto_renewal_order_notice_status_sent')
                                            : t(lang, 'auto_renewal_order_notice_status_failed');
                                        const statusColor = notice.status === 'sent' ? 'var(--green)' : 'var(--red)';

                                        return (
                                            <tr key={notice.id} style={{
                                                borderBottom: '1px solid var(--border)',
                                                cursor: 'pointer',
                                                backgroundColor: 'var(--bg3)'
                                            }} onClick={() => setViewingOrderNotice(notice)}>
                                                <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: 'var(--text)' }}>{notice.sent_at}</td>
                                                <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                                                    <span style={{ color: statusColor, fontWeight: 700 }}>{statusLabel}</span>
                                                </td>
                                                <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: 'var(--text)' }}>{notice.serial_number}</td>
                                                <td style={{ padding: '8px 12px', color: 'var(--text)' }}>{notice.customer_name || '-'}</td>
                                                <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: 'var(--text)' }}>
                                                    {(notice.previous_expiry_date || '-') + ' -> ' + (notice.renewed_expiry_date || '-')}
                                                </td>
                                                <td style={{ padding: '8px 12px', color: 'var(--text)' }}>
                                                    {notice.recipient_email || '-'}
                                                    <span style={{ marginLeft: 8, color: 'var(--accent)', textDecoration: 'underline', fontSize: 11 }}>{t(lang, 'view_content_bracket')}</span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
