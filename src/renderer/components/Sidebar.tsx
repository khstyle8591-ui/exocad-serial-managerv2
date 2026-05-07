/**
 * Sidebar.tsx
 *
 * Collapsible hamburger sidebar. Active item highlighted.
 * Accepts `page` + `onNavigate` from App.tsx.
 */
import React from 'react';

export type AppPage =
  | 'dashboard'
  | 'serial-data'
  | 'customers'
  | 'logs'
  | 'requested-order'
  | 'mail-system'
  | 'notification'
  | 'setting';

interface NavItem {
  key: AppPage;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard',       label: 'Dashboard',        icon: '📊' },
  { key: 'serial-data',     label: 'Serial Data',      icon: '🔑' },
  { key: 'customers',       label: 'Customers',        icon: '👥' },
  { key: 'logs',            label: 'Logs',             icon: '📋' },
  { key: 'requested-order', label: 'Requested Order',  icon: '📬' },
  { key: 'mail-system',     label: 'Mail System',      icon: '✉️' },
  { key: 'notification',    label: 'Notification',     icon: '🔔' },
  { key: 'setting',         label: 'Setting',          icon: '⚙️' },
];

interface SidebarProps {
  page: AppPage;
  collapsed: boolean;
  onNavigate: (p: AppPage) => void;
  onToggle: () => void;
}

export default function Sidebar({ page, collapsed, onNavigate, onToggle }: SidebarProps) {
  const width = collapsed ? 56 : 200;

  return (
    <div style={{
      width,
      minHeight: '100vh',
      background: '#1e293b',
      display: 'flex',
      flexDirection: 'column',
      transition: 'width 0.2s ease',
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      {/* Header / hamburger */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '14px 12px',
        borderBottom: '1px solid #334155',
        cursor: 'pointer',
        userSelect: 'none',
      }} onClick={onToggle}>
        <span style={{ fontSize: 18, lineHeight: 1 }}>☰</span>
        {!collapsed && (
          <span style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap' }}>
            Exocad Manager
          </span>
        )}
      </div>

      {/* Nav items */}
      <nav style={{ flex: 1, paddingTop: 8 }}>
        {NAV_ITEMS.map(item => {
          const active = page === item.key;
          return (
            <div
              key={item.key}
              onClick={() => onNavigate(item.key)}
              title={collapsed ? item.label : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                cursor: 'pointer',
                background: active ? '#3b82f6' : 'transparent',
                borderRadius: collapsed ? 0 : 6,
                margin: collapsed ? 0 : '2px 6px',
                color: active ? '#fff' : '#94a3b8',
                transition: 'background 0.15s, color 0.15s',
              }}
              onMouseEnter={e => {
                if (!active) (e.currentTarget as HTMLDivElement).style.background = '#334155';
              }}
              onMouseLeave={e => {
                if (!active) (e.currentTarget as HTMLDivElement).style.background = 'transparent';
              }}
            >
              <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0 }}>{item.icon}</span>
              {!collapsed && (
                <span style={{ fontSize: 13, fontWeight: active ? 600 : 400, whiteSpace: 'nowrap' }}>
                  {item.label}
                </span>
              )}
            </div>
          );
        })}
      </nav>
    </div>
  );
}
