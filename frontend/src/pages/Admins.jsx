import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import api, { apiErrorMessage } from '../services/api';
import { Loading, ErrorState, EmptyState } from '../components/AsyncState';

const PERMISSION_KEYS = [
  ['students', 'Student management'],
  ['seats', 'Seat management'],
  ['allocations', 'Allocation management'],
  ['attendance', 'Attendance'],
  ['payments', 'Payments & billing'],
  ['expenses', 'Expenses'],
  ['reports', 'Reports'],
  ['notices', 'Notices & announcements'],
];

export default function Admins() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [admins, setAdmins] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [showRoleForm, setShowRoleForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [a, r] = await Promise.all([api.get('/admins'), api.get('/roles')]);
      setAdmins(a.data.admins);
      setRoles(r.data.roles);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (user?.role !== 'super_admin') {
    return (
      <div className="card">
        <p>Only a Super Admin can manage admins and permissions.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="topbar">
        <h2 style={{ margin: 0 }}>{t('adminsPage.title')}</h2>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>
          {t('adminsPage.addAdmin')}
        </button>
      </div>

      {loading && <Loading />}
      {error && !loading && <ErrorState message={error} onRetry={load} />}
      {!loading && !error && admins.length === 0 && <EmptyState />}

      {!loading && !error && admins.length > 0 && (
        <div className="card">
          {admins.map((a) => (
            <div className="list-item" key={a.admin_id}>
              <div>
                <strong>{a.name}</strong>
                <div style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>{a.email}</div>
                {a.role === 'staff' && (
                  <div style={{ fontSize: 12, color: 'var(--color-ink-soft)', marginTop: 4 }}>
                    {permissionSummary(a.permissions_json)}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={`badge ${a.role === 'super_admin' ? 'badge-info' : 'badge-neutral'}`}>
                  {a.role === 'super_admin' ? t('adminsPage.superAdmin') : t('adminsPage.staff')}
                </span>
                <span className={`badge ${a.status === 'active' ? 'badge-success' : 'badge-danger'}`}>{a.status}</span>
                {a.role !== 'super_admin' && (
                  <button className="btn btn-outline" onClick={() => setEditing(a)}>
                    {t('adminsPage.editPermissions')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="topbar" style={{ marginTop: 24 }}>
        <h3 style={{ margin: 0 }}>{t('adminsPage.roles')}</h3>
        <button className="btn btn-outline" onClick={() => setShowRoleForm(true)}>
          {t('adminsPage.addRole')}
        </button>
      </div>
      <div className="card">
        {roles.length === 0 && <p style={{ color: 'var(--color-ink-soft)' }}>No roles defined yet.</p>}
        {roles.map((r) => (
          <div className="list-item" key={r.role_id}>
            <div>
              <strong>{r.role_name}</strong>
              <div style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>{r.description || permissionSummary(r.permissions_json)}</div>
            </div>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 12, color: 'var(--color-ink-soft)' }}>
        Roles are a quick way to fill in permissions when adding a staff member — assign one when creating or editing an admin below, then fine-tune individual checkboxes if needed.
      </p>

      {showForm && <AdminFormDrawer roles={roles} onClose={() => setShowForm(false)} onDone={() => { setShowForm(false); load(); }} />}
      {editing && (
        <EditPermissionsDrawer admin={editing} roles={roles} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />
      )}
      {showRoleForm && <RoleFormDrawer onClose={() => setShowRoleForm(false)} onDone={() => { setShowRoleForm(false); load(); }} />}
    </div>
  );
}

function permissionSummary(json) {
  try {
    const perms = json ? JSON.parse(json) : {};
    const enabled = PERMISSION_KEYS.filter(([key]) => perms[key]).map(([, label]) => label);
    return enabled.length > 0 ? enabled.join(', ') : 'No permissions granted yet';
  } catch {
    return 'No permissions granted yet';
  }
}

function AdminFormDrawer({ roles, onClose, onDone }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('staff');
  const [roleId, setRoleId] = useState('');
  const [permissions, setPermissions] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function togglePermission(key) {
    setPermissions((p) => ({ ...p, [key]: !p[key] }));
  }

  function applyRole(id) {
    setRoleId(id);
    const found = roles.find((r) => r.role_id === id);
    if (found) {
      try {
        setPermissions(JSON.parse(found.permissions_json || '{}'));
      } catch {
        // ignore malformed role JSON, leave permissions as-is
      }
    }
  }

  async function submit() {
    if (!name || !email || !password) {
      setError('Name, email and password are required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post('/admins', { name, email, password, role, permissions, roleId: roleId || undefined });
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
        <h3>Add admin</h3>
        <div className="field">
          <label>Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>Email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label>Password</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="field">
          <label>Role</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="staff">Staff</option>
            <option value="super_admin">Super Admin</option>
          </select>
        </div>
        {role === 'staff' && (
          <>
            {roles.length > 0 && (
              <div className="field">
                <label>Start from a role (optional)</label>
                <select className="input" value={roleId} onChange={(e) => applyRole(e.target.value)}>
                  <option value="">Custom — pick permissions below</option>
                  {roles.map((r) => (
                    <option key={r.role_id} value={r.role_id}>
                      {r.role_name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="field">
              <label>Permissions</label>
              {PERMISSION_KEYS.map(([key, label]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontWeight: 400 }}>
                  <input type="checkbox" checked={!!permissions[key]} onChange={() => togglePermission(key)} />
                  {label}
                </label>
              ))}
            </div>
          </>
        )}
        {error && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn btn-primary" disabled={busy} onClick={submit}>
            Create admin
          </button>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function RoleFormDrawer({ onClose, onDone }) {
  const [roleName, setRoleName] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function togglePermission(key) {
    setPermissions((p) => ({ ...p, [key]: !p[key] }));
  }

  async function submit() {
    if (!roleName) {
      setError('Role name is required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post('/roles', { roleName, description, permissions });
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
        <h3>Add role</h3>
        <div className="field">
          <label>Role name</label>
          <input className="input" value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder="e.g. Front Desk" />
        </div>
        <div className="field">
          <label>Description</label>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="field">
          <label>Permissions</label>
          {PERMISSION_KEYS.map(([key, label]) => (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontWeight: 400 }}>
              <input type="checkbox" checked={!!permissions[key]} onChange={() => togglePermission(key)} />
              {label}
            </label>
          ))}
        </div>
        {error && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn btn-primary" disabled={busy} onClick={submit}>
            Create role
          </button>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function EditPermissionsDrawer({ admin, roles, onClose, onDone }) {
  const [permissions, setPermissions] = useState(() => {
    try {
      return admin.permissions_json ? JSON.parse(admin.permissions_json) : {};
    } catch {
      return {};
    }
  });
  const [status, setStatus] = useState(admin.status);
  const [roleId, setRoleId] = useState(admin.role_id || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function togglePermission(key) {
    setPermissions((p) => ({ ...p, [key]: !p[key] }));
  }

  function applyRole(id) {
    setRoleId(id);
    const found = (roles || []).find((r) => r.role_id === id);
    if (found) {
      try {
        setPermissions(JSON.parse(found.permissions_json || '{}'));
      } catch {
        // ignore malformed role JSON
      }
    }
  }

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await api.patch(`/admins/${admin.admin_id}`, { permissions, status, roleId: roleId || '' });
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
        <h3>Edit permissions — {admin.name}</h3>
        <div className="field">
          <label>Status</label>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        {roles && roles.length > 0 && (
          <div className="field">
            <label>Apply a role (overwrites checkboxes below)</label>
            <select className="input" value={roleId} onChange={(e) => applyRole(e.target.value)}>
              <option value="">— Keep current permissions —</option>
              {roles.map((r) => (
                <option key={r.role_id} value={r.role_id}>
                  {r.role_name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label>Permissions</label>
          {PERMISSION_KEYS.map(([key, label]) => (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontWeight: 400 }}>
              <input type="checkbox" checked={!!permissions[key]} onChange={() => togglePermission(key)} />
              {label}
            </label>
          ))}
        </div>
        {error && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn btn-primary" disabled={busy} onClick={submit}>
            Save changes
          </button>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
