import React, { useEffect, useState } from 'react';
import { useLang } from '../App';
import { t } from '../i18n';
import { api } from '../api';

export default function SystemLogs() {
    const { lang } = useLang();
    const [systemLogs, setSystemLogs] = useState<string[]>([]);
    const [relatedEmails, setRelatedEmails] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [dateStr, setDateStr] = useState<string>(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }));
    const [viewingMailId, setViewingMailId] = useState<number | null>(null);
    const [mailBody, setMailBody] = useState<string>('');

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
            const data = await api.getSystemLogs(dateStr) as any;
            setSystemLogs(data.systemLogs || []);
            setRelatedEmails(data.relatedEmails || []);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const openMailPopup = async (id: number) => {
        setViewingMailId(id);
        setMailBody('로딩 중...');
        try {
            const body = await api.getCapturedMail(id);
            setMailBody(body);
        } catch (err) {
            setMailBody('메일 내용을 불러올 수 없습니다.');
        }
    };

    return (
        <div style={{ position: 'relative' }}>
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
                            <h3 style={{ margin: 0 }}>메일 내용 보기 (ID: {viewingMailId})</h3>
                            <button className="btn btn-secondary" onClick={() => setViewingMailId(null)}>닫기</button>
                        </div>
                        <div style={{
                            padding: 15, border: '1px solid #eee', borderRadius: 4, background: '#f9f9f9',
                            whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 14, minHeight: 200
                        }} dangerouslySetInnerHTML={{ __html: mailBody.includes('<') && mailBody.includes('>') ? mailBody : `<pre style="white-space: pre-wrap">${mailBody}</pre>` }} />
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
                {/* === 상단: System Logs === */}
                <div className="table-container" style={{ flex: 1, minHeight: 300 }}>
                    <h3 style={{ margin: '0 0 10px 0', padding: '12px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: 16, color: '#0f172a' }}>
                        🖥️ System Logs ( {systemLogs.length}건 )
                    </h3>
                    {loading ? (
                        <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>{t(lang, 'loading')}</div>
                    ) : systemLogs.length === 0 ? (
                        <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>해당 날짜 로그가 없습니다.</div>
                    ) : (
                        <div style={{ overflowX: 'auto', maxHeight: '40vh' }}>
                            <pre style={{ margin: 0, padding: 16, fontSize: 13, background: '#1e293b', color: '#f8fafc', whiteSpace: 'pre-wrap', minHeight: '100%' }}>
                                {systemLogs.join('\n')}
                            </pre>
                        </div>
                    )}
                </div>

                {/* === 하단: 관련 메일 수신 알림 === */}
                <div className="table-container" style={{ flex: 1, minHeight: 300, border: '1px solid #fde68a' }}>
                    <h3 style={{ margin: '0 0 10px 0', padding: '12px 16px', background: '#fefce8', borderBottom: '1px solid #fef08a', fontSize: 16, color: '#854d0e' }}>
                        🔔 관련 메일 수신 알림 ( {relatedEmails.length}건 )
                    </h3>
                    <p style={{ margin: '0 16px 10px', fontSize: 13, color: '#6b7280' }}>제품 이름은 포함되어 있으나 갱신 키워드 또는 시리얼 포맷이 일치하지 않아 갱신 요청으로 분류되지 않은 메일입니다.</p>
                    {loading ? (
                        <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>{t(lang, 'loading')}</div>
                    ) : relatedEmails.length === 0 ? (
                        <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>관련 메일 수신 기록이 없습니다.</div>
                    ) : (
                        <div style={{ overflowX: 'auto', maxHeight: '40vh' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                    <tr style={{ background: '#fefce8', borderBottom: '1px solid #fde68a' }}>
                                        <th style={{ padding: '8px 12px', textAlign: 'left', color: '#854d0e' }}>Time</th>
                                        <th style={{ padding: '8px 12px', textAlign: 'left', color: '#854d0e' }}>Detail</th>
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
                                                borderBottom: '1px solid #fef9c3', 
                                                cursor: mailId ? 'pointer' : 'default',
                                                backgroundColor: mailId ? '#fffdf0' : 'transparent'
                                            }} onClick={() => mailId && openMailPopup(mailId)}>
                                                <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: '#888' }}>{timeStr}</td>
                                                <td style={{ padding: '8px 12px' }}>
                                                    {detail}
                                                    {mailId && <span style={{ marginLeft: 8, color: '#2563eb', textDecoration: 'underline', fontSize: 11 }}>[내용 보기]</span>}
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
