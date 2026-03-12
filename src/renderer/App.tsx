import React, { useState, useEffect, createContext, useContext } from 'react';
import Dashboard from './pages/Dashboard';
import Serials from './pages/Serials';
import Orders from './pages/Orders';
import Settings from './pages/Settings';
import Logs from './pages/Logs';
import SystemLogs from './pages/SystemLogs';
import type { Language } from './i18n';
import { t } from './i18n';
import { api } from './api';

// ── 언어 Context ──────────────────────────────────────────────────────────────
interface LangCtx {
  lang: Language;
  setLang: (l: Language) => void;
}
export const LanguageContext = createContext<LangCtx>({ lang: 'ko', setLang: () => { } });

export const NavigationContext = createContext<{
  page: Page;
  setPage: (p: Page, params?: any) => void;
  params: any;
}>({ page: 'dashboard', setPage: () => { }, params: null });

export const useLang = () => useContext(LanguageContext);
export const useNav = () => useContext(NavigationContext);

type Page = 'dashboard' | 'serials' | 'orders' | 'settings' | 'logs' | 'system_logs';

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [params, setParams] = useState<any>(null);
  const [lang, setLang] = useState<Language>('ko');

  const handleSetPage = (p: Page, pms?: any) => {
    setPage(p);
    setParams(pms || null);
  };

  // 앱 시작 시 저장된 언어 설정 불러오기
  useEffect(() => {
    (async () => {
      try {
        const settings = await api.getSettings() as any;
        if (settings.app_language) {
          setLang(settings.app_language as Language);
        }
      } catch {
        // 설정 로드 실패 시 기본값 유지
      }
    })();
  }, []);

  const NAV_ITEMS: { key: Page; label: string; icon: string }[] = [
    { key: 'dashboard', label: t(lang, 'nav_dashboard'), icon: '📊' },
    { key: 'serials', label: t(lang, 'nav_serials'), icon: '🔑' },
    { key: 'orders', label: t(lang, 'nav_orders'), icon: '📬' },
    { key: 'logs', label: t(lang, 'nav_logs'), icon: '📋' },
    { key: 'system_logs', label: t(lang, 'nav_system_logs'), icon: '🖥️' },
    { key: 'settings', label: t(lang, 'nav_settings'), icon: '⚙️' },
  ];

  const renderPage = () => {
    switch (page) {
      case 'dashboard': return <Dashboard />;
      case 'serials': return <Serials />;
      case 'orders': return <Orders />;
      case 'settings': return <Settings />;
      case 'logs': return <Logs />;
      case 'system_logs': return <SystemLogs />;
    }
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang }}>
      <NavigationContext.Provider value={{ page, setPage: handleSetPage, params }}>
        <div className="app-layout">
          <div className="sidebar">
            <div className="sidebar-header">{t(lang, 'app_title')}</div>
            <ul className="sidebar-nav">
              {NAV_ITEMS.map(item => (
                <li
                  key={item.key}
                  className={page === item.key ? 'active' : ''}
                  onClick={() => handleSetPage(item.key)}
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="main-content">
            {renderPage()}
          </div>
        </div>
      </NavigationContext.Provider>
    </LanguageContext.Provider>
  );
}
