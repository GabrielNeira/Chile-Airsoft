import { FormEvent, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { getOperatorIdMetricsByUserId, OperatorIdMetricsRow } from '../lib/operatorMetricsApi';
import './god-user-maintainer.css';

type AppRole = 'player' | 'field_admin' | 'organizer' | 'super_admin';

interface GodUserMaintainerProps {
  enabled: boolean;
}

interface GodUserReportRow {
  user_id: string;
  email: string;
  nickname: string;
  real_name: string;
  operator_role: string;
  blood_group: string;
  team: string;
  roles: string[] | null;
  profile_created_at: string | null;
}

interface UserMaintainerRow {
  userId: string;
  email: string;
  nickname: string;
  realName: string;
  operatorRole: string;
  bloodGroup: string;
  team: string;
  roles: string[];
  createdAt: string;
  avatarUrl?: string | null;
}

const ACHIEVEMENT_TEMPLATES = [
  {
    code: 'first_match',
    title: 'Bautismo de Fuego',
    description: 'Registra tu asistencia en tu primera partida oficial.',
    rarity: 'común',
    icon: '🔥'
  },
  {
    code: 'fairplay_honor',
    title: 'Espíritu Deportivo',
    description: 'Mantén un puntaje de Fair Play impecable (90+).',
    rarity: 'raro',
    icon: '🛡️'
  },
  {
    code: 'veteran_5',
    title: 'Vanguardia Veterana',
    description: 'Completa exitosamente 5 eventos en canchas oficiales.',
    rarity: 'raro',
    icon: '🎖️'
  },
  {
    code: 'calibrated_gun',
    title: 'Calibración Precisa',
    description: 'Pasa exitosamente la validación de crono para tu réplica principal.',
    rarity: 'común',
    icon: '⚙️'
  },
  {
    code: 'team_operative',
    title: 'Fuerza de Tarea',
    description: 'Pertenece a un equipo activo o club registrado en la plataforma.',
    rarity: 'legendario',
    icon: '👥'
  }
];

function mapError(error: unknown): string {
  const message = (error as { message?: string })?.message ?? 'Error inesperado.';
  const lower = message.toLowerCase();
  if (lower.includes('row-level security')) {
    return 'No tienes permisos para administrar usuarios con esta cuenta.';
  }
  if (lower.includes('permission denied')) {
    return 'Tu cuenta no puede leer tablas directas. Usa el reporte GOD consolidado (RPC).';
  }
  return message;
}

function normalizeAvatarUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  const value = rawUrl.trim();
  if (!value) return null;
  
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    if ((host.includes('google.') || host.includes('bing.')) && parsed.searchParams.get('imgurl')) {
      const embedded = parsed.searchParams.get('imgurl');
      if (embedded) return normalizeAvatarUrl(embedded);
    }
  } catch {
    // Ignore URL parse error for non-URLs
  }

  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:')) {
    return value;
  }
  if (value.startsWith('//')) {
    return `https:${value}`;
  }
  if (value.startsWith('www.')) {
    return `https://${value}`;
  }
  return value;
}

export default function GodUserMaintainer({ enabled }: GodUserMaintainerProps) {
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('Mantenedor listo.');
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<UserMaintainerRow[]>([]);

  // Selected User State
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedTab, setSelectedTab] = useState<'profile' | 'metrics' | 'achievements' | 'roles'>('profile');

  // Detailed CRUD Form States
  const [editNickname, setEditNickname] = useState('');
  const [editRealName, setEditRealName] = useState('');
  const [editTeam, setEditTeam] = useState('');
  const [editOperatorRole, setEditOperatorRole] = useState('assault');
  const [editBloodGroup, setEditBloodGroup] = useState('O+');
  const [editIceName, setEditIceName] = useState('');
  const [editIcePhone, setEditIcePhone] = useState('');
  const [editIceName2, setEditIceName2] = useState('');
  const [editIcePhone2, setEditIcePhone2] = useState('');
  const [editAllergies, setEditAllergies] = useState('');

  // Selected User Metas/DB Data
  const [selectedMetrics, setSelectedMetrics] = useState<OperatorIdMetricsRow | null>(null);
  const [selectedAchievements, setSelectedAchievements] = useState<string[]>([]);
  const [selectedFieldsAdmin, setSelectedFieldsAdmin] = useState<string[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Global Config/Setup States
  const [allFields, setAllFields] = useState<any[]>([]);
  const [roleReason, setRoleReason] = useState('Actualización de permisos por Superadmin');
  const [deleteCandidate, setDeleteCandidate] = useState<UserMaintainerRow | null>(null);

  const selectedUser = useMemo(
    () => users.find((item) => item.userId === selectedUserId) ?? null,
    [users, selectedUserId]
  );

  const filteredUsers = useMemo(() => {
    const token = search.trim().toLowerCase();
    if (!token) return users;

    return users.filter((item) => {
      const haystack = [
        item.email,
        item.nickname,
        item.realName,
        item.operatorRole,
        item.team,
        item.bloodGroup,
        item.userId,
        item.roles.join(' ')
      ]
        .join(' | ')
        .toLowerCase();

      return haystack.includes(token);
    });
  }, [search, users]);

  // Load registered fields & users on mount/enable
  useEffect(() => {
    if (!enabled) {
      setUsers([]);
      setSelectedUserId('');
      setAllFields([]);
      return;
    }

    void loadUsers();
    void loadAllFields();
  }, [enabled]);

  // Handle selected user change
  useEffect(() => {
    if (!selectedUserId) {
      setSelectedMetrics(null);
      setSelectedAchievements([]);
      setSelectedFieldsAdmin([]);
      resetFormStates();
      return;
    }

    void loadSelectedUserDetails(selectedUserId);
  }, [selectedUserId]);

  function resetFormStates() {
    setEditNickname('');
    setEditRealName('');
    setEditTeam('');
    setEditOperatorRole('assault');
    setEditBloodGroup('O+');
    setEditIceName('');
    setEditIcePhone('');
    setEditIceName2('');
    setEditIcePhone2('');
    setEditAllergies('');
  }

  async function loadAllFields() {
    if (!supabase) return;
    try {
      const { data, error: fieldsErr } = await supabase
        .from('fields')
        .select('id, name, city')
        .order('name');
      if (fieldsErr) throw fieldsErr;
      setAllFields(data || []);
    } catch (err) {
      console.error('Error loading fields catalog:', err);
    }
  }

  async function loadUsers() {
    if (!supabase || !enabled) return;

    setLoading(true);
    setError(null);

    try {
      const { data, error: reportError } = await supabase.rpc('god_user_maintainer_report', {
        p_search: search.trim() || null,
        p_limit: 500,
        p_offset: 0
      });

      if (reportError) throw reportError;

      // Query avatar urls directly from operator_profiles
      const { data: avatarRows } = await supabase
        .from('operator_profiles')
        .select('user_id, avatar_url');
      const avatarMap = new Map<string, string>();
      if (avatarRows) {
        avatarRows.forEach((row: any) => {
          if (row.avatar_url) {
            avatarMap.set(row.user_id, row.avatar_url);
          }
        });
      }

      const merged: UserMaintainerRow[] = ((data as GodUserReportRow[] | null) ?? []).map((row) => ({
        userId: row.user_id,
        email: row.email ?? 'sin-email',
        nickname: row.nickname ?? 'sin-nickname',
        realName: row.real_name ?? 'sin-nombre',
        operatorRole: row.operator_role ?? 'other',
        bloodGroup: row.blood_group ?? 'N/D',
        team: row.team ?? 'Sin equipo',
        roles: row.roles ?? [],
        createdAt: row.profile_created_at ?? new Date(0).toISOString(),
        avatarUrl: avatarMap.get(row.user_id) || null
      }));

      setUsers(merged);
      if (merged.length > 0 && !selectedUserId) {
        setSelectedUserId(merged[0].userId);
      }
      setStatusMessage(`Usuarios cargados: ${merged.length}.`);
    } catch (loadError) {
      setError(mapError(loadError));
    } finally {
      setLoading(false);
    }
  }

  async function loadSelectedUserDetails(userId: string) {
    if (!supabase) return;
    setDetailLoading(true);
    setError(null);

    try {
      // 1. Fetch Profile Table Details (CRUD fields)
      const { data: profile, error: profileErr } = await supabase
        .from('operator_profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (profileErr) throw profileErr;

      if (profile) {
        setEditNickname(profile.nickname || '');
        setEditRealName(profile.real_name || '');
        setEditTeam(profile.team || 'Sin equipo');
        setEditOperatorRole(profile.operator_role || 'assault');
        setEditBloodGroup(profile.blood_group || 'O+');
        setEditIceName(profile.emergency_contact_name || '');
        setEditIcePhone(profile.emergency_contact_phone || '');
        setEditIceName2(profile.emergency_contact_name_2 || '');
        setEditIcePhone2(profile.emergency_contact_phone_2 || '');
        setEditAllergies(profile.allergies || '');
      }

      // 2. Fetch Metrics View
      const metricsData = await getOperatorIdMetricsByUserId(userId);
      setSelectedMetrics(metricsData);

      // 3. Fetch Achievements unlocked
      const { data: achievementsData, error: achErr } = await supabase
        .from('operator_achievements')
        .select(`
          achievement:achievements (
            code
          )
        `)
        .eq('operator_user_id', userId);

      if (achErr) throw achErr;
      if (achievementsData) {
        const codes = achievementsData
          .map((item: any) => item.achievement?.code)
          .filter(Boolean);
        setSelectedAchievements(codes);
      } else {
        setSelectedAchievements([]);
      }

      // 4. Fetch Field Admin associations
      const { data: faData, error: faErr } = await supabase
        .from('field_admins')
        .select('field_id')
        .eq('user_id', userId);

      if (faErr) {
        // Fallback elegantly if the policy is not set up yet
        console.warn('Field admins select RLS restricted. Apply the policy hotfix.');
        setSelectedFieldsAdmin([]);
      } else {
        setSelectedFieldsAdmin(faData ? faData.map((item: any) => item.field_id) : []);
      }
    } catch (err) {
      console.error('Error fetching operator detail details:', err);
      setError(mapError(err));
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase || !selectedUserId) return;

    setBusy(true);
    setError(null);
    try {
      const { error: updateError } = await supabase
        .from('operator_profiles')
        .update({
          nickname: editNickname.trim(),
          real_name: editRealName.trim(),
          team: editTeam.trim() || null,
          operator_role: editOperatorRole,
          blood_group: editBloodGroup,
          emergency_contact_name: editIceName.trim() || null,
          emergency_contact_phone: editIcePhone.trim() || null,
          emergency_contact_name_2: editIceName2.trim() || null,
          emergency_contact_phone_2: editIcePhone2.trim() || null,
          allergies: editAllergies.trim() || null,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', selectedUserId);

      if (updateError) throw updateError;

      setStatusMessage('Perfil y datos de operador actualizados correctamente.');
      await loadUsers();
      await loadSelectedUserDetails(selectedUserId);
    } catch (updateFailure) {
      setError(mapError(updateFailure));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteProfile() {
    if (!selectedUser) return;
    setDeleteCandidate(selectedUser);
  }

  async function handleConfirmDeleteProfile() {
    if (!supabase || !deleteCandidate) return;

    setBusy(true);
    setError(null);

    try {
      const { data, error: deleteError } = await supabase.rpc('god_delete_user_totally', {
        p_user_id: deleteCandidate.userId,
        p_reason: roleReason.trim() || 'Eliminación total desde mantenedor avanzado GOD'
      });

      if (deleteError) {
        const lowered = deleteError.message.toLowerCase();
        if (lowered.includes('could not find the function')) {
          throw new Error('Falta la función god_delete_user_totally. Ejecuta db/supabase_god_user_delete.sql en Supabase.');
        }
        throw deleteError;
      }

      const deletedEmail = String((data as { email?: string } | null)?.email ?? deleteCandidate.email);
      setStatusMessage(`Usuario eliminado totalmente: ${deletedEmail}.`);

      setSelectedUserId('');
      setDeleteCandidate(null);
      await loadUsers();
    } catch (deleteErr) {
      setError(mapError(deleteErr));
    } finally {
      setBusy(false);
    }
  }

  // Toggle roles fast via checkboxes
  async function handleToggleRole(role: AppRole, active: boolean) {
    if (!supabase || !selectedUser) return;

    setBusy(true);
    setError(null);

    try {
      const rpcName = active ? 'grant_role' : 'revoke_role';
      const { error: rpcErr } = await supabase.rpc(rpcName, {
        p_user_email: selectedUser.email,
        p_role: role,
        p_reason: roleReason.trim() || 'Modificación rápida de roles por Superadmin'
      });

      if (rpcErr) throw rpcErr;

      setStatusMessage(`Rol ${role} ${active ? 'asignado' : 'revocado'} a ${selectedUser.email}.`);
      await loadUsers();
      if (selectedUserId) {
        await loadSelectedUserDetails(selectedUserId);
      }
    } catch (err) {
      setError(mapError(err));
    } finally {
      setBusy(false);
    }
  }

  // Toggle field administrator mappings
  async function handleToggleFieldAdmin(fieldId: string, active: boolean) {
    if (!supabase || !selectedUser) return;

    setBusy(true);
    setError(null);

    try {
      const { error: rpcErr } = await supabase.rpc('set_field_admin_by_email', {
        p_field_id: fieldId,
        p_user_email: selectedUser.email,
        p_enabled: active
      });

      if (rpcErr) throw rpcErr;

      setStatusMessage(`Rol administrador de cancha ${active ? 'otorgado' : 'revocado'} para ${selectedUser.email}.`);
      if (selectedUserId) {
        await loadSelectedUserDetails(selectedUserId);
      }
    } catch (err) {
      setError(mapError(err));
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) {
    return (
      <section className="god-shell">
        <h3 className="god-title">Admin GOD</h3>
        <p className="god-muted">Esta cuenta no tiene permisos para el mantenedor global.</p>
      </section>
    );
  }

  // User avatar resolver
  const getAvatarSeed = (user: UserMaintainerRow | null) => {
    if (!user) return '';
    return encodeURIComponent(user.nickname || user.realName || 'admin');
  };

  return (
    <section className="god-shell" aria-label="Mantenedor avanzado de jugadores admin god">
      <header className="god-header">
        <h3 className="god-title">Mantenedor Avanzado de Jugadores</h3>
        <p className="god-subtitle">
          Edición CRUD, auditoría de logros, estadísticas y asignación de administradores de cancha.
        </p>
      </header>

      <div className="god-toolbar">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por email, nickname, nombre real, rol, equipo..."
        />
        <button type="button" onClick={() => void loadUsers()} disabled={loading || busy}>
          {loading ? 'Cargando...' : 'Recargar'}
        </button>
      </div>

      <div className="god-maintainer-layout">
        {/* LEFT COLUMN: Registered users list */}
        <aside className="god-sidebar">
          <div className="god-sidebar-header">
            <h4>Operadores Registrados</h4>
            <span className="god-count-badge">{filteredUsers.length}</span>
          </div>

          <div className="god-user-list-container">
            {filteredUsers.length === 0 ? (
              <p className="god-empty-msg">No se encontraron operadores.</p>
            ) : (
              <ul className="god-user-cards-list">
                {filteredUsers.map((item) => {
                  const isActive = selectedUserId === item.userId;
                  return (
                    <li key={item.userId}>
                      <button
                        type="button"
                        className={`god-user-card-btn ${isActive ? 'is-active' : ''}`}
                        onClick={() => setSelectedUserId(item.userId)}
                      >
                        <img
                          src={normalizeAvatarUrl(item.avatarUrl) || `https://api.dicebear.com/9.x/adventurer/png?seed=${getAvatarSeed(item)}`}
                          alt="Avatar"
                          className="god-card-avatar"
                        />
                        <div className="god-card-info">
                          <span className="god-card-nickname">{item.nickname}</span>
                          <span className="god-card-email">{item.email}</span>
                          <div className="god-card-role-pills">
                            {item.roles.length === 0 ? (
                              <span className="god-role-pill is-none">sin roles</span>
                            ) : (
                              item.roles.map((r) => (
                                <span key={r} className={`god-role-pill is-${r}`}>
                                  {r === 'field_admin' ? 'admin cancha' : r === 'super_admin' ? 'superadmin' : r}
                                </span>
                              ))
                            )}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* RIGHT COLUMN: Selected user details dashboard */}
        <main className="god-detail-pane">
          {selectedUser ? (
            <div className="god-detail-wrapper">
              <header className="god-detail-header">
                <img
                  src={normalizeAvatarUrl(selectedUser.avatarUrl) || `https://api.dicebear.com/9.x/adventurer/png?seed=${getAvatarSeed(selectedUser)}`}
                  alt="Selected avatar"
                  className="god-detail-avatar"
                />
                <div className="god-detail-title-block">
                  <h3>{selectedUser.nickname}</h3>
                  <p>{selectedUser.email}</p>
                </div>
              </header>

              <nav className="god-detail-tabs" aria-label="Secciones de detalle del usuario">
                <button
                  type="button"
                  className={`god-tab-btn ${selectedTab === 'profile' ? 'is-active' : ''}`}
                  onClick={() => setSelectedTab('profile')}
                >
                  Datos & CRUD
                </button>
                <button
                  type="button"
                  className={`god-tab-btn ${selectedTab === 'metrics' ? 'is-active' : ''}`}
                  onClick={() => setSelectedTab('metrics')}
                >
                  Estadísticas
                </button>
                <button
                  type="button"
                  className={`god-tab-btn ${selectedTab === 'achievements' ? 'is-active' : ''}`}
                  onClick={() => setSelectedTab('achievements')}
                >
                  Logros
                </button>
                <button
                  type="button"
                  className={`god-tab-btn ${selectedTab === 'roles' ? 'is-active' : ''}`}
                  onClick={() => setSelectedTab('roles')}
                >
                  Roles & Canchas
                </button>
              </nav>

              <div className="god-tab-content">
                {detailLoading ? (
                  <div className="god-loader-spinner">
                    <div className="spinner"></div>
                    <p>Cargando información del operador...</p>
                  </div>
                ) : (
                  <>
                    {/* TAB 1: Profile CRUD Form */}
                    {selectedTab === 'profile' && (
                      <form className="god-detail-form" onSubmit={handleSaveProfile}>
                        <div className="god-form-grid">
                          <label className="god-form-field">
                            <span>User ID (Solo Lectura)</span>
                            <input value={selectedUser.userId} readOnly className="is-readonly" />
                          </label>

                          <label className="god-form-field">
                            <span>Nickname</span>
                            <input
                              value={editNickname}
                              onChange={(e) => setEditNickname(e.target.value)}
                              required
                            />
                          </label>

                          <label className="god-form-field">
                            <span>Nombre Real</span>
                            <input
                              value={editRealName}
                              onChange={(e) => setEditRealName(e.target.value)}
                              required
                            />
                          </label>

                          <label className="god-form-field">
                            <span>Grupo Sanguíneo</span>
                            <select
                              value={editBloodGroup}
                              onChange={(e) => setEditBloodGroup(e.target.value)}
                            >
                              <option value="A+">A+</option>
                              <option value="A-">A-</option>
                              <option value="B+">B+</option>
                              <option value="B-">B-</option>
                              <option value="AB+">AB+</option>
                              <option value="AB-">AB-</option>
                              <option value="O+">O+</option>
                              <option value="O-">O-</option>
                            </select>
                          </label>

                          <label className="god-form-field">
                            <span>Equipo</span>
                            <input
                              value={editTeam}
                              onChange={(e) => setEditTeam(e.target.value)}
                            />
                          </label>

                          <label className="god-form-field">
                            <span>Rol de Operador</span>
                            <select
                              value={editOperatorRole}
                              onChange={(e) => setEditOperatorRole(e.target.value)}
                            >
                              <option value="assault">Assault</option>
                              <option value="sniper">Sniper</option>
                              <option value="medic">Medic</option>
                              <option value="support">Support</option>
                              <option value="dmr">DMR</option>
                              <option value="breacher">Breacher</option>
                              <option value="recon">Recon</option>
                              <option value="commander">Commander</option>
                              <option value="other">Other</option>
                            </select>
                          </label>
                        </div>

                        <hr className="god-divider" />
                        <h4 className="god-section-subtitle">Contacto de Emergencia & ICE</h4>

                        <div className="god-form-grid">
                          <label className="god-form-field">
                            <span>Contacto Principal (Nombre)</span>
                            <input
                              value={editIceName}
                              onChange={(e) => setEditIceName(e.target.value)}
                              placeholder="Ej: Mamá, Pareja"
                            />
                          </label>

                          <label className="god-form-field">
                            <span>Contacto Principal (Teléfono)</span>
                            <input
                              value={editIcePhone}
                              onChange={(e) => setEditIcePhone(e.target.value)}
                              placeholder="Ej: +56912345678"
                            />
                          </label>

                          <label className="god-form-field">
                            <span>Contacto Secundario (Nombre)</span>
                            <input
                              value={editIceName2}
                              onChange={(e) => setEditIceName2(e.target.value)}
                            />
                          </label>

                          <label className="god-form-field">
                            <span>Contacto Secundario (Teléfono)</span>
                            <input
                              value={editIcePhone2}
                              onChange={(e) => setEditIcePhone2(e.target.value)}
                            />
                          </label>
                        </div>

                        <label className="god-form-field label-full">
                          <span>Alergias o Información Médica Crítica</span>
                          <textarea
                            value={editAllergies}
                            onChange={(e) => setEditAllergies(e.target.value)}
                            placeholder="Ninguna / Penicilina, Asma, etc."
                            rows={3}
                          />
                        </label>

                        <div className="god-form-actions">
                          <button type="submit" className="god-btn-primary" disabled={busy}>
                            {busy ? 'Guardando...' : 'Guardar Cambios'}
                          </button>
                          <button
                            type="button"
                            className="god-btn-danger"
                            onClick={() => void handleDeleteProfile()}
                            disabled={busy}
                          >
                            Eliminar Totalmente
                          </button>
                        </div>
                      </form>
                    )}

                    {/* TAB 2: Metrics */}
                    {selectedTab === 'metrics' && (
                      <div className="god-metrics-view">
                        <div className="god-metrics-summary-grid">
                          <article className="god-metric-card highlight">
                            <span className="god-metric-icon">🎯</span>
                            <div className="god-metric-data">
                              <span className="god-metric-value">
                                {selectedMetrics?.operator_score ?? 0}
                              </span>
                              <span className="god-metric-label">Operator Score</span>
                            </div>
                          </article>

                          <article className="god-metric-card highlight">
                            <span className="god-metric-icon">🛡️</span>
                            <div className="god-metric-data">
                              <span className="god-metric-value">
                                {selectedMetrics?.fair_play_score ?? 100} / 100
                              </span>
                              <span className="god-metric-label">Fair Play Score</span>
                            </div>
                          </article>

                          <article className="god-metric-card">
                            <span className="god-metric-icon">📅</span>
                            <div className="god-metric-data">
                              <span className="god-metric-value">
                                {selectedMetrics?.total_confirmed_events ?? 0}
                              </span>
                              <span className="god-metric-label">Eventos Asistidos</span>
                            </div>
                          </article>

                          <article className="god-metric-card">
                            <span className="god-metric-icon">🏆</span>
                            <div className="god-metric-data">
                              <span className="god-metric-value">
                                {selectedMetrics?.total_achievements_unlocked ?? 0}
                              </span>
                              <span className="god-metric-label">Logros Desbloqueados</span>
                            </div>
                          </article>
                        </div>

                        <h4 className="god-section-subtitle">Historial de Fair Play</h4>
                        <div className="god-fairplay-cards-row">
                          <div className="god-fp-badge green">
                            <span className="count">{selectedMetrics?.total_fair_play_green ?? 0}</span>
                            <span className="label">Tarjetas Verdes</span>
                          </div>
                          <div className="god-fp-badge yellow">
                            <span className="count">{selectedMetrics?.total_fair_play_yellow ?? 0}</span>
                            <span className="label">Tarjetas Amarillas</span>
                          </div>
                          <div className="god-fp-badge red">
                            <span className="count">{selectedMetrics?.total_fair_play_red ?? 0}</span>
                            <span className="label">Tarjetas Rojas</span>
                          </div>
                        </div>

                        <h4 className="god-section-subtitle">Estadísticas Adicionales</h4>
                        <table className="god-metrics-table">
                          <tbody>
                            <tr>
                              <th>Partidas Jugadas</th>
                              <td>{selectedMetrics?.total_matches_participated ?? 0}</td>
                            </tr>
                            <tr>
                              <th>Victorias / Derrotas</th>
                              <td>
                                {selectedMetrics?.total_matches_won ?? 0} V / {selectedMetrics?.total_matches_lost ?? 0} D
                              </td>
                            </tr>
                            <tr>
                              <th>Tiempo Total en Cancha</th>
                              <td>
                                {selectedMetrics?.total_field_time_seconds
                                  ? `${Math.round(selectedMetrics.total_field_time_seconds / 3600)} horas`
                                  : '0 horas'}
                              </td>
                            </tr>
                            <tr>
                              <th>Última Sincronización</th>
                              <td>
                                {selectedMetrics?.metrics_updated_at
                                  ? new Date(selectedMetrics.metrics_updated_at).toLocaleString()
                                  : 'Nunca'}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* TAB 3: Achievements list */}
                    {selectedTab === 'achievements' && (
                      <div className="god-achievements-view">
                        <div className="god-achievements-grid">
                          {ACHIEVEMENT_TEMPLATES.map((ach) => {
                            const isUnlocked = selectedAchievements.includes(ach.code);
                            return (
                              <article
                                key={ach.code}
                                className={`god-achievement-item ${isUnlocked ? 'is-unlocked' : 'is-locked'}`}
                              >
                                <span className="ach-icon" role="img" aria-hidden="true">
                                  {ach.icon}
                                </span>
                                <div className="ach-body">
                                  <h5>{ach.title}</h5>
                                  <p>{ach.description}</p>
                                  <div className="ach-footer-meta">
                                    <span className={`rarity rarity-${ach.rarity}`}>
                                      {ach.rarity}
                                    </span>
                                    <span className={`status-pill ${isUnlocked ? 'unlocked' : 'locked'}`}>
                                      {isUnlocked ? 'Desbloqueado' : 'Bloqueado'}
                                    </span>
                                  </div>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* TAB 4: Roles & Field Admin Assignments */}
                    {selectedTab === 'roles' && (
                      <div className="god-roles-view">
                        <h4 className="god-section-subtitle">Roles de Plataforma Global</h4>
                        <p className="god-section-desc">
                          Modifica los permisos de acceso del usuario marcando o desmarcando los roles.
                        </p>

                        <div className="god-roles-grid">
                          {(['player', 'field_admin', 'organizer', 'super_admin'] as AppRole[]).map((r) => {
                            const hasRole = selectedUser.roles.includes(r);
                            return (
                              <label key={r} className="god-role-toggle-item">
                                <input
                                  type="checkbox"
                                  checked={hasRole}
                                  onChange={(e) => void handleToggleRole(r, e.target.checked)}
                                  disabled={busy}
                                />
                                <div className="toggle-label">
                                  <strong>
                                    {r === 'field_admin' ? 'Administrador de Cancha' : r === 'super_admin' ? 'Super Administrador' : r === 'organizer' ? 'Organizador' : 'Jugador'}
                                  </strong>
                                  <span className="role-code">({r})</span>
                                </div>
                              </label>
                            );
                          })}
                        </div>

                        <div className="god-roles-reason-block">
                          <label>
                            <span>Motivo de Modificación / Auditoría</span>
                            <input
                              value={roleReason}
                              onChange={(e) => setRoleReason(e.target.value)}
                              placeholder="Ej: Cambio de permisos autorizado"
                            />
                          </label>
                        </div>

                        {selectedUser.roles.includes('field_admin') && (
                          <>
                            <hr className="god-divider" />
                            <h4 className="god-section-subtitle">Asignación de Canchas Administradas</h4>
                            <p className="god-section-desc">
                              Selecciona las canchas oficiales en las que este usuario tiene permisos para validar crono, asistencia y reportar incidentes.
                            </p>

                            {allFields.length === 0 ? (
                              <p className="god-empty-msg">No hay canchas registradas en el sistema.</p>
                            ) : (
                              <div className="god-fields-grid">
                                {allFields.map((field) => {
                                  const isAdmin = selectedFieldsAdmin.includes(field.id);
                                  return (
                                    <label key={field.id} className="god-field-checkbox-card">
                                      <input
                                        type="checkbox"
                                        checked={isAdmin}
                                        onChange={(e) => void handleToggleFieldAdmin(field.id, e.target.checked)}
                                        disabled={busy}
                                      />
                                      <div className="checkbox-card-body">
                                        <strong>{field.name}</strong>
                                        <span>{field.city || 'Ciudad no especificada'}</span>
                                      </div>
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="god-detail-empty">
              <span>👤</span>
              <p>Selecciona un operador registrado del listado de la izquierda para ver y editar sus datos.</p>
            </div>
          )}
        </main>
      </div>

      {error ? <p className="god-error">{error}</p> : null}
      <p className="god-status" aria-live="polite">{statusMessage}</p>

      {/* Delete confirmation modal */}
      {deleteCandidate ? (
        <div className="god-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="god-delete-title">
          <section className="god-modal-card">
            <h4 id="god-delete-title">Confirmar Eliminación Total</h4>
            <p>
              Estás a punto de eliminar completamente al usuario <strong>{deleteCandidate.nickname}</strong> ({deleteCandidate.email}).
            </p>
            <p className="warning-text">
              ⚠️ Esta acción borrará permanentemente su perfil de operador, roles, asistencias, logros y credenciales, además de revocar su cuenta de autenticación.
            </p>

            <div className="god-inline-actions">
              <button type="button" disabled={busy} onClick={() => setDeleteCandidate(null)} className="god-btn-cancel">
                Cancelar
              </button>
              <button type="button" disabled={busy} onClick={() => void handleConfirmDeleteProfile()} className="god-btn-confirm-delete">
                {busy ? 'Eliminando...' : 'Confirmar Eliminación Total'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
