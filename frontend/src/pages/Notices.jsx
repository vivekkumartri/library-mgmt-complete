import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import api, { apiErrorMessage } from '../services/api';
import { Loading, ErrorState, EmptyState } from '../components/AsyncState';

export default function Notices() {
  const { t } = useTranslation();
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/notices');
      setNotices(res.data.notices);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleStatus(notice) {
    try {
      await api.patch(`/notices/${notice.notice_id}`, { status: notice.status === 'active' ? 'inactive' : 'active' });
      load();
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  return (
    <div>
      <div className="topbar">
        <h2 style={{ margin: 0 }}>{t('notices.title')}</h2>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>
          {t('notices.addNotice')}
        </button>
      </div>

      {loading && <Loading />}
      {error && !loading && <ErrorState message={error} onRetry={load} />}
      {!loading && !error && notices.length === 0 && <EmptyState />}

      {!loading && !error && notices.length > 0 && (
        <div className="card">
          {notices.map((n) => (
            <div className="list-item" key={n.notice_id}>
              <div>
                <strong>{n.title_en}</strong>
                {n.title_hi && <span style={{ color: 'var(--color-ink-soft)' }}> · {n.title_hi}</span>}
                <div style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
                  {n.description_en}
                  {n.publish_date || n.expiry_date ? ` (${n.publish_date || 'now'} → ${n.expiry_date || 'no expiry'})` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {n.priority === 'high' && <span className="badge badge-danger">High</span>}
                <span className={`badge ${n.status === 'active' ? 'badge-success' : 'badge-neutral'}`}>{n.status}</span>
                <button className="btn btn-outline" onClick={() => setEditing(n)}>
                  Edit
                </button>
                <button className="btn btn-outline" onClick={() => toggleStatus(n)}>
                  {n.status === 'active' ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && <NoticeFormDrawer onClose={() => setShowForm(false)} onDone={() => { setShowForm(false); load(); }} />}
      {editing && (
        <NoticeFormDrawer notice={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

function NoticeFormDrawer({ notice, onClose, onDone }) {
  const isEdit = !!notice;
  const [titleEn, setTitleEn] = useState(notice?.title_en || '');
  const [descriptionEn, setDescriptionEn] = useState(notice?.description_en || '');
  const [titleHi, setTitleHi] = useState(notice?.title_hi || '');
  const [descriptionHi, setDescriptionHi] = useState(notice?.description_hi || '');
  const [publishDate, setPublishDate] = useState(notice?.publish_date || '');
  const [expiryDate, setExpiryDate] = useState(notice?.expiry_date || '');
  const [priority, setPriority] = useState(notice?.priority || 'normal');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!titleEn) {
      setError('An English title is required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const payload = { titleEn, descriptionEn, titleHi, descriptionHi, publishDate, expiryDate, priority };
      if (isEdit) {
        await api.patch(`/notices/${notice.notice_id}`, {
          title_en: titleEn, description_en: descriptionEn, title_hi: titleHi, description_hi: descriptionHi,
          publish_date: publishDate, expiry_date: expiryDate, priority,
        });
      } else {
        await api.post('/notices', payload);
      }
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <h3>{isEdit ? 'Edit notice' : 'New notice'}</h3>

        <div className="field">
          <label>Title (English) *</label>
          <input className="input" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} />
        </div>
        <div className="field">
          <label>Description (English)</label>
          <textarea className="input" rows={2} value={descriptionEn} onChange={(e) => setDescriptionEn(e.target.value)} />
        </div>
        <div className="field">
          <label>Title (Hindi)</label>
          <input className="input" value={titleHi} onChange={(e) => setTitleHi(e.target.value)} />
        </div>
        <div className="field">
          <label>Description (Hindi)</label>
          <textarea className="input" rows={2} value={descriptionHi} onChange={(e) => setDescriptionHi(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Publish date</label>
            <input className="input" type="date" value={publishDate} onChange={(e) => setPublishDate(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Expiry date</label>
            <input className="input" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Priority</label>
          <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
        </div>

        {error && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn btn-primary" disabled={busy} onClick={submit}>
            {isEdit ? 'Save changes' : 'Publish notice'}
          </button>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
