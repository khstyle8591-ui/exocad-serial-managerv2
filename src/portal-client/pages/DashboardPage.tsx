import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { t, type Lang } from '../i18n';

interface LinkedProduct {
  main_product: string;
  masked_serial: string;
  status: string;
  renewal_stop_requested?: number;
}

interface ProfileData {
  name: string;
  linked_products: LinkedProduct[];
}

function statusBadge(p: LinkedProduct, lang: Lang) {
  if (p.renewal_stop_requested) return <span className="badge badge-yellow">{t(lang, 'status_stop_requested')}</span>;
  if (p.status === 'active')    return <span className="badge badge-green">{t(lang, 'status_active')}</span>;
  if (p.status === 'cancelled') return <span className="badge badge-red">{t(lang, 'status_cancelled')}</span>;
  if (p.status === 'expired')   return <span className="badge badge-gray">{t(lang, 'status_expired')}</span>;
  return <span className="badge badge-gray">{p.status}</span>;
}

export default function DashboardPage() {
  const { lang, account } = useAuth();
  const [products, setProducts] = useState<LinkedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<ProfileData>('/profile')
      .then(d => setProducts(d.linked_products))
      .catch(e => setError(e instanceof Error ? e.message : ''))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="portal-page">
      <h1 className="page-title">{t(lang, 'dashboard')}</h1>
      <p className="page-subtitle" style={{ marginBottom: 24 }}>
        {account?.name}
      </p>

      <div className="portal-card">
        <div className="portal-card-title">{t(lang, 'my_products')}</div>

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
            <div className="spinner" />
          </div>
        )}

        {error && <div className="alert alert-error">{error}</div>}

        {!loading && !error && products.length === 0 && (
          <div style={{ color: 'var(--text3)', fontSize: 13, marginBottom: 12 }}>
            {t(lang, 'no_products')}
          </div>
        )}

        {products.map((p, i) => (
          <div key={i} className="product-card">
            <div className="product-card-info">
              <div className="product-card-name">{p.main_product}</div>
              <div className="product-card-serial">{p.masked_serial}</div>
            </div>
            {statusBadge(p, lang)}
          </div>
        ))}

        {!loading && products.length === 0 && (
          <Link to="/setup" className="btn btn-secondary btn-sm mt-8">
            {t(lang, 'link_serial_nav')}
          </Link>
        )}
      </div>
    </div>
  );
}
