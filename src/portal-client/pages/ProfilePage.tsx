import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { t, type Lang } from '../i18n';

const LANGS: { value: Lang; label: string }[] = [
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
];

export default function ProfilePage() {
  const { lang, account, setLang, refresh } = useAuth();
  const [pwForm, setPwForm] = useState({ current_password: '', password: '', confirm_password: '' });
  const [pwError, setPwError]     = useState('');
  const [pwSuccess, setPwSuccess] = useState('');
  const [pwLoading, setPwLoading] = useState(false);

  const [editForm, setEditForm] = useState({ email: '', phone: '', address: '', exocad_id: '' });
  const [editing, setEditing] = useState(false);
  const [editError, setEditError]     = useState('');
  const [editSuccess, setEditSuccess] = useState('');
  const [editLoading, setEditLoading] = useState(false);

  function setPw(k: keyof typeof pwForm) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setPwForm(f => ({ ...f, [k]: e.target.value }));
  }

  function setEdit(k: keyof typeof editForm) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setEditForm(f => ({ ...f, [k]: e.target.value }));
  }

  function startEdit() {
    if (!account) return;
    setEditForm({
      email: account.email || '',
      phone: account.phone || '',
      address: account.address || '',
      exocad_id: account.exocad_id || '',
    });
    setEditError(''); setEditSuccess('');
    setEditing(true);
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setEditError(''); setEditSuccess('');
    setEditLoading(true);
    try {
      await api.patch('/profile', editForm);
      await refresh();
      setEditSuccess(t(lang, 'profile_updated'));
      setEditing(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : t(lang, 'error_generic'));
    } finally {
      setEditLoading(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(''); setPwSuccess('');
    setPwLoading(true);
    try {
      await api.post('/profile/change-password', pwForm);
      setPwSuccess(t(lang, 'pw_changed'));
      setPwForm({ current_password: '', password: '', confirm_password: '' });
    } catch (err) {
      setPwError(err instanceof Error ? err.message : t(lang, 'error_generic'));
    } finally {
      setPwLoading(false);
    }
  }

  if (!account) return null;

  return (
    <div className="portal-page">
      <h1 className="page-title">{t(lang, 'my_profile')}</h1>
      <p className="page-subtitle" style={{ marginBottom: 24 }} />

      {/* Profile info */}
      <div className="portal-card">
        <div className="portal-card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {t(lang, 'my_profile')}
          {!editing && (
            <button className="btn btn-sm btn-secondary" onClick={startEdit}>{t(lang, 'edit')}</button>
          )}
        </div>

        {editError   && <div className="alert alert-error">{editError}</div>}
        {editSuccess && <div className="alert alert-success">{editSuccess}</div>}

        {!editing ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {[
                [t(lang, 'login_id'),       account.login_id],
                [t(lang, 'name'),           account.name],
                [t(lang, 'email'),          account.email],
                [t(lang, 'phone_label'),    account.phone || '—'],
                [t(lang, 'address_label'),  account.address || '—'],
                [t(lang, 'exocad_id_label'), account.exocad_id || '—'],
              ].map(([label, value]) => (
                <tr key={label} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 0', color: 'var(--text3)', width: '35%' }}>{label}</td>
                  <td style={{ padding: '10px 0', color: 'var(--text)' }}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <form onSubmit={handleSaveProfile} style={{ maxWidth: 420 }}>
            <div className="form-group">
              <label>{t(lang, 'login_id')}</label>
              <input type="text" value={account.login_id} disabled />
            </div>
            <div className="form-group">
              <label>{t(lang, 'name')}</label>
              <input type="text" value={account.name} disabled />
            </div>
            <div className="form-group">
              <label>{t(lang, 'email')}</label>
              <input type="email" value={editForm.email} onChange={setEdit('email')} required />
            </div>
            <div className="form-group">
              <label>{t(lang, 'phone_label')}</label>
              <input type="text" value={editForm.phone} onChange={setEdit('phone')} />
            </div>
            <div className="form-group">
              <label>{t(lang, 'address_label')}</label>
              <input type="text" value={editForm.address} onChange={setEdit('address')} />
            </div>
            <div className="form-group">
              <label>{t(lang, 'exocad_id_label')}</label>
              <input type="text" value={editForm.exocad_id} onChange={setEdit('exocad_id')} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn btn-primary" disabled={editLoading}>
                {editLoading ? <span className="spinner" style={{ width: 16, height: 16 }} /> : t(lang, 'save')}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => { setEditing(false); setEditError(''); }}>
                {t(lang, 'cancel')}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Language */}
      <div className="portal-card">
        <div className="portal-card-title">{t(lang, 'language')}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {LANGS.map(l => (
            <button
              key={l.value}
              className={`btn btn-sm ${lang === l.value ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setLang(l.value)}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {/* Change password */}
      <div className="portal-card">
        <div className="portal-card-title">{t(lang, 'change_password')}</div>

        {pwError   && <div className="alert alert-error">{pwError}</div>}
        {pwSuccess && <div className="alert alert-success">{pwSuccess}</div>}

        <form onSubmit={handleChangePassword} style={{ maxWidth: 360 }}>
          <div className="form-group">
            <label>{t(lang, 'current_password')}</label>
            <input
              type="password"
              autoComplete="current-password"
              value={pwForm.current_password}
              onChange={setPw('current_password')}
              required
            />
          </div>
          <div className="form-group">
            <label>{t(lang, 'new_password')}</label>
            <input
              type="password"
              autoComplete="new-password"
              value={pwForm.password}
              onChange={setPw('password')}
              required
            />
            <p className="form-help">{t(lang, 'password_hint')}</p>
          </div>
          <div className="form-group">
            <label>{t(lang, 'confirm_password')}</label>
            <input
              type="password"
              autoComplete="new-password"
              value={pwForm.confirm_password}
              onChange={setPw('confirm_password')}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={pwLoading}>
            {pwLoading ? <span className="spinner" style={{ width: 16, height: 16 }} /> : t(lang, 'save')}
          </button>
        </form>
      </div>
    </div>
  );
}
