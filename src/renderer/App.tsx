import React, { useState, useEffect, createContext, useContext } from 'react';
import Dashboard from './pages/Dashboard';
import SerialData from './pages/SerialData';
import Orders from './pages/Orders';
import RequestedOrder from './pages/RequestedOrder';
import MailSystem from './pages/MailSystem';
import Notification from './pages/Notification';
import Settings from './pages/Settings';
import Portal from './pages/Portal';
import Logs from './pages/Logs';
import SystemLogs from './pages/SystemLogs';
import Customers from './pages/Customers';
import Products from './pages/Products';
import type { AppSettings } from '../shared/types';
import type { Language, TranslationKey } from './i18n';
import { t } from './i18n';
import { api } from './client';

interface LangCtx {
  lang: Language;
  setLang: (l: Language) => void;
}
export const LanguageContext = createContext<LangCtx>({ lang: 'ko', setLang: () => {} });

export const NavigationContext = createContext<{
  page: Page;
  setPage: (p: Page, params?: unknown) => void;
  params: unknown;
}>({ page: 'dashboard', setPage: () => {}, params: null });

export const useLang = () => useContext(LanguageContext);
export const useNav  = () => useContext(NavigationContext);

type Page = 'dashboard' | 'serial-data' | 'orders' | 'requested-order' | 'mail-system' | 'notification' | 'settings' | 'logs' | 'system_logs' | 'customers' | 'products' | 'portal';

// ── SVG icons ──────────────────────────────────────────────────────────────────
const SvgIcon = ({ d, size = 14 }: { d: React.ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>{d}</svg>
);

const NavIcons: Record<string, React.ReactNode> = {
  dashboard:        <SvgIcon d={<><rect x="1" y="1" width="6" height="6" rx="1.5" fill="currentColor" opacity=".5"/><rect x="9" y="1" width="6" height="6" rx="1.5" fill="currentColor"/><rect x="1" y="9" width="6" height="6" rx="1.5" fill="currentColor"/><rect x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity=".5"/></>} />,
  serials:          <SvgIcon d={<><rect x="1" y="3" width="14" height="2" rx="1" fill="currentColor"/><rect x="1" y="7" width="10" height="2" rx="1" fill="currentColor"/><rect x="1" y="11" width="12" height="2" rx="1" fill="currentColor"/></>} />,
  'serial-data':    <SvgIcon d={<><rect x="1" y="3" width="14" height="2" rx="1" fill="currentColor"/><rect x="1" y="7" width="10" height="2" rx="1" fill="currentColor"/><rect x="1" y="11" width="12" height="2" rx="1" fill="currentColor"/></>} />,
  orders:           <SvgIcon d={<><rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M5 7h6M5 10h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></>} />,
  'requested-order':<SvgIcon d={<><rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M5 7h6M5 10h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></>} />,
  customers:        <SvgIcon d={<><circle cx="6" cy="5" r="3" fill="currentColor" opacity=".7"/><path d="M1 13c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="12" cy="5" r="2" fill="currentColor" opacity=".4"/><path d="M14 13c0-1.66-.9-3.12-2.25-3.89" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></>} />,
  products:         <SvgIcon d={<><path d="M8 1L14 4.5V11.5L8 15L2 11.5V4.5L8 1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M8 1V15M2 4.5L14 4.5" stroke="currentColor" strokeWidth="1.2" opacity=".5"/></>} />,
  logs:             <SvgIcon d={<><rect x="2" y="1" width="12" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M5 5h6M5 8h6M5 11h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></>} />,
  system_logs:      <SvgIcon d={<><rect x="1" y="2" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M5 16h6M8 12v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M4 7l2 2-2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><rect x="8" y="8" width="4" height="1.5" rx=".75" fill="currentColor"/></>} />,
  'mail-system':    <SvgIcon d={<><rect x="1" y="3" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M1 5l7 5 7-5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></>} />,
  notification:     <SvgIcon d={<><path d="M8 1a5 5 0 0 0-5 5v3l-1.5 2.5h13L13 9V6a5 5 0 0 0-5-5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="M6 13.5a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></>} />,
  settings:         <SvgIcon d={<><circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M2.93 2.93l1.41 1.41M11.66 11.66l1.41 1.41M2.93 13.07l1.41-1.41M11.66 4.34l1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></>} />,
  key:              <SvgIcon d={<><circle cx="6" cy="7" r="3.5" stroke="currentColor" strokeWidth="1.4"/><path d="M8.5 9.5L14 15M11 12.5l1.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></>} />,
  portal:           <SvgIcon d={<><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4"/><path d="M1.5 8h13M8 1.5c1.8 1.7 2.8 4 2.8 6.5S9.8 12.8 8 14.5C6.2 12.8 5.2 10.5 5.2 8S6.2 3.2 8 1.5z" stroke="currentColor" strokeWidth="1.2"/></>} />,
};

const MAIN_NAV: { key: Page; labelKey: TranslationKey; icon: string }[] = [
  { key: 'dashboard',        labelKey: 'nav_dashboard',    icon: 'dashboard' },
  { key: 'serial-data',      labelKey: 'nav_serials',       icon: 'serial-data' },
  { key: 'requested-order',  labelKey: 'nav_orders',        icon: 'requested-order' },
  { key: 'customers',        labelKey: 'nav_customers',     icon: 'customers' },
  { key: 'products',         labelKey: 'nav_products',      icon: 'products' },
  { key: 'mail-system',      labelKey: 'nav_mail',          icon: 'mail-system' },
  { key: 'portal',           labelKey: 'nav_portal',        icon: 'portal' },
  { key: 'notification',     labelKey: 'nav_notification',  icon: 'notification' },
  { key: 'logs',             labelKey: 'nav_logs',          icon: 'logs' },
  { key: 'system_logs',      labelKey: 'nav_system_logs',   icon: 'system_logs' },
];

export default function App() {
  const [page, setPage]   = useState<Page>('dashboard');
  const [params, setParams] = useState<unknown>(null);
  const [lang, setLang]   = useState<Language>('ko');

  const handleSetPage = (p: Page, pms?: unknown) => {
    setPage(p);
    setParams(pms || null);
  };

  useEffect(() => {
    (async () => {
      try {
        const settings = await api.getSettings() as AppSettings;
        if (settings.app_language) setLang(settings.app_language as Language);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const renderPage = () => {
    switch (page) {
      case 'dashboard':        return <Dashboard />;
      case 'serial-data':      return <SerialData />;
      case 'requested-order':  return <RequestedOrder />;
      case 'orders':           return <Orders />;
      case 'mail-system':      return <MailSystem />;
      case 'notification':     return <Notification />;
      case 'customers':        return <Customers />;
      case 'products':         return <Products />;
      case 'logs':             return <Logs />;
      case 'system_logs':      return <SystemLogs />;
      case 'settings':         return <Settings />;
      case 'portal':           return <Portal />;
    }
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang }}>
      <NavigationContext.Provider value={{ page, setPage: handleSetPage, params }}>
        <div className="app-layout">
          {/* ── Sidebar ── */}
          <div className="sidebar">
            {/* Logo */}
            <div style={{
              padding: '20px 16px 18px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: 9,
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                background: 'linear-gradient(135deg, var(--accent2), var(--accent))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#0d0f12',
              }}>
                {NavIcons.key}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', lineHeight: 1 }}>exocad</div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2, letterSpacing: '0.05em' }}>SERIAL MANAGER</div>
              </div>
            </div>

            {/* Nav */}
            <ul className="sidebar-nav">
              {MAIN_NAV.map(item => {
                const active = page === item.key;
                const label = t(lang, item.labelKey);
                return (
                  <li key={item.key} className={active ? 'active' : ''} onClick={() => handleSetPage(item.key)}>
                    {NavIcons[item.icon]}
                    <span>{label}</span>
                  </li>
                );
              })}
            </ul>

            {/* Bottom: Settings + User */}
            <div style={{ padding: '12px 8px', borderTop: '1px solid var(--border)' }}>
              <button
                onClick={() => handleSetPage('settings')}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9,
                  width: '100%', padding: '8px 10px', borderRadius: 7,
                  background: page === 'settings' ? 'var(--accent-dim2)' : 'transparent',
                  color: page === 'settings' ? 'var(--accent)' : 'var(--text2)',
                  border: '1px solid transparent',
                  cursor: 'pointer', fontSize: 13,
                  fontWeight: page === 'settings' ? 500 : 400,
                  transition: 'all 0.12s',
                  fontFamily: 'inherit',
                  marginBottom: 2,
                }}
                onMouseEnter={e => { if (page !== 'settings') { (e.currentTarget as HTMLElement).style.background = 'var(--bg3)'; (e.currentTarget as HTMLElement).style.color = 'var(--text)'; } }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = page === 'settings' ? 'var(--accent-dim2)' : 'transparent'; (e.currentTarget as HTMLElement).style.color = page === 'settings' ? 'var(--accent)' : 'var(--text2)'; }}
              >
                {NavIcons.settings}
                <span>{t(lang, 'nav_settings')}</span>
              </button>
              <div style={{ padding: '8px 10px 2px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 26, height: 26, borderRadius: '50%',
                  background: 'var(--bg4)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 600, color: 'var(--accent)', flexShrink: 0,
                }}>A</div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>Admin</div>
                  <div style={{ fontSize: 10, color: 'var(--text3)' }}>geomedi</div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Main content ── */}
          <div className="main-content">
            {renderPage()}
          </div>
        </div>
      </NavigationContext.Provider>
    </LanguageContext.Provider>
  );
}
