import { FormEvent, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
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
}

function mapError(error: unknown): string {
  const message = (error as { message?: string })?.message ?? 'Error inesperado.';
  if (message.toLowerCase().includes('row-level security')) {
    return 'No tienes permisos para administrar usuarios con esta cuenta.';
  }
  if (message.toLowerCase().includes('permission denied')) {
    return 'Tu cuenta no puede leer tablas directas. Usa el reporte GOD consolidado (RPC).';
  }
  return message;
}

export default function GodUserMaintainer({ enabled }: GodUserMaintainerProps) {
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('Mantenedor listo.');
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<UserMaintainerRow[]>([]);

  const [selectedUserId, setSelectedUserId] = useState('');
  const [editNickname, setEditNickname] = useState('');
  const [editTeam, setEditTeam] = useState('');
  const [editOperatorRole, setEditOperatorRole] = useState('assault');
  const [roleReason, setRoleReason] = useState('Actualizacion solicitada por admin GOD');

  const [roleEmail, setRoleEmail] = useState('');
  const [roleToGrant, setRoleToGrant] = useState<AppRole>('field_admin');
  const [roleToRevoke, setRoleToRevoke] = useState<AppRole>('field_admin');
  const [deleteCandidate, setDeleteCandidate] = useState<UserMaintainerRow | null>(null);

  const selectedUser = useMemo(
    () => users.find((item) => item.userId === selectedUserId) ?? null,
    [users, selectedUserId]
  );

  const filteredUsers = useMemo(() => {
    const token = search.trim().toLowerCase();
    if (!token) {
      return users;
    }

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

  useEffect(() => {
    if (!enabled) {
      setUsers([]);
      setSelectedUserId('');
      return;
    }

    void loadUsers();
  }, [enabled]);

  useEffect(() => {
    if (!selectedUser) {
      setEditNickname('');
      setEditTeam('');
      setEditOperatorRole('assault');
      return;
    }

    setEditNickname(selectedUser.nickname);
    setEditTeam(selectedUser.team);
    setEditOperatorRole(selectedUser.operatorRole || 'assault');
    setRoleEmail(selectedUser.email);
  }, [selectedUser]);

  async function loadUsers() {
    if (!supabase || !enabled) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: reportError } = await supabase.rpc('god_user_maintainer_report', {
        p_search: search.trim() || null,
        p_limit: 500,
        p_offset: 0
      });

      if (reportError) {
        throw reportError;
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
        createdAt: row.profile_created_at ?? new Date(0).toISOString()
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

  async function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase || !selectedUserId) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const { error: updateError } = await supabase
        .from('operator_profiles')
        .update({
          nickname: editNickname.trim(),
          team: editTeam.trim() || null,
          operator_role: editOperatorRole
        })
        .eq('user_id', selectedUserId);

      if (updateError) {
        throw updateError;
      }

      setStatusMessage('Perfil actualizado correctamente.');
      await loadUsers();
    } catch (updateFailure) {
      setError(mapError(updateFailure));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteProfile() {
    if (!selectedUser) {
      return;
    }

    setDeleteCandidate(selectedUser);
  }

  async function handleConfirmDeleteProfile() {
    if (!supabase || !deleteCandidate) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const { data, error: deleteError } = await supabase.rpc('god_delete_user_totally', {
        p_user_id: deleteCandidate.userId,
        p_reason: roleReason.trim() || 'Eliminacion total desde mantenedor GOD'
      });

      if (deleteError) {
        const lowered = deleteError.message.toLowerCase();
        if (lowered.includes('could not find the function')) {
          throw new Error('Falta la funcion god_delete_user_totally. Ejecuta db/supabase_god_user_delete.sql en Supabase.');
        }
        throw deleteError;
      }

      const deletedEmail = String((data as { email?: string } | null)?.email ?? deleteCandidate.email);
      setStatusMessage(`Usuario eliminado totalmente: ${deletedEmail}.`);

      setSelectedUserId('');
      setDeleteCandidate(null);
      await loadUsers();
    } catch (deleteError) {
      setError(mapError(deleteError));
    } finally {
      setBusy(false);
    }
  }

  async function handleGrantRole() {
    if (!supabase) {
      return;
    }

    const nextEmail = roleEmail.trim().toLowerCase();
    if (!nextEmail) {
      setError('Debes indicar un email para asignar rol.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const { data, error: grantError } = await supabase.rpc('grant_role', {
        p_user_email: nextEmail,
        p_role: roleToGrant,
        p_reason: roleReason.trim() || null
      });

      if (grantError) {
        throw grantError;
      }

      const status = String((data as { status?: string } | null)?.status ?? 'granted');
      setStatusMessage(
        status === 'already_exists'
          ? `El rol ${roleToGrant} ya estaba asignado a ${nextEmail}.`
          : `Rol ${roleToGrant} asignado a ${nextEmail}.`
      );

      await loadUsers();
    } catch (grantFailure) {
      setError(mapError(grantFailure));
    } finally {
      setBusy(false);
    }
  }

  async function handleRevokeRole() {
    if (!supabase) {
      return;
    }

    const nextEmail = roleEmail.trim().toLowerCase();
    if (!nextEmail) {
      setError('Debes indicar un email para revocar rol.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const { data, error: revokeError } = await supabase.rpc('revoke_role', {
        p_user_email: nextEmail,
        p_role: roleToRevoke,
        p_reason: roleReason.trim() || null
      });

      if (revokeError) {
        throw revokeError;
      }

      const status = String((data as { status?: string } | null)?.status ?? 'revoked');
      setStatusMessage(
        status === 'not_assigned'
          ? `El rol ${roleToRevoke} no estaba asignado a ${nextEmail}.`
          : `Rol ${roleToRevoke} revocado a ${nextEmail}.`
      );

      await loadUsers();
    } catch (revokeFailure) {
      setError(mapError(revokeFailure));
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) {
    return (
      <section className="god-shell">
        <h3 className="god-title">Admin GOD</h3>
        <p className="god-subtitle">Esta cuenta no tiene permisos para mantenedor global.</p>
      </section>
    );
  }

  return (
    <section className="god-shell" aria-label="Mantenedor de usuarios admin god">
      <header className="god-header">
        <h3 className="god-title">Mantenedor Global de Usuarios</h3>
        <p className="god-subtitle">Busca, edita, elimina y administra tipo de usuario en un flujo unico.</p>
      </header>

      <div className="god-toolbar">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por email, nickname, nombre, rol, equipo o ID"
        />
        <button type="button" onClick={() => void loadUsers()} disabled={loading || busy}>
          {loading ? 'Cargando...' : 'Recargar'}
        </button>
      </div>

      <div className="god-grid">
        <article className="god-card">
          <h4>Usuarios registrados</h4>
          <p className="god-muted">Resultado: {filteredUsers.length}</p>
          <ul className="god-list">
            {filteredUsers.length === 0 ? <li>Sin usuarios para mostrar.</li> : null}
            {filteredUsers.map((item) => (
              <li key={item.userId}>
                <button
                  type="button"
                  className={`god-user-btn ${selectedUserId === item.userId ? 'is-active' : ''}`}
                  onClick={() => setSelectedUserId(item.userId)}
                >
                  <strong>{item.nickname}</strong>
                  <span>{item.email}</span>
                  <small>{item.roles.length ? item.roles.join(', ') : 'sin roles visibles'}</small>
                </button>
              </li>
            ))}
          </ul>
        </article>

        <article className="god-card">
          <h4>Editar usuario</h4>
          {selectedUser ? (
            <form className="god-form" onSubmit={handleSaveProfile}>
              <label>
                User ID
                <input value={selectedUser.userId} readOnly />
              </label>
              <label>
                Email
                <input value={roleEmail} onChange={(event) => setRoleEmail(event.target.value)} />
              </label>
              <label>
                Nickname
                <input value={editNickname} onChange={(event) => setEditNickname(event.target.value)} required />
              </label>
              <label>
                Equipo
                <input value={editTeam} onChange={(event) => setEditTeam(event.target.value)} />
              </label>
              <label>
                Rol operador
                <select value={editOperatorRole} onChange={(event) => setEditOperatorRole(event.target.value)}>
                  <option value="assault">assault</option>
                  <option value="sniper">sniper</option>
                  <option value="medic">medic</option>
                  <option value="support">support</option>
                  <option value="dmr">dmr</option>
                  <option value="breacher">breacher</option>
                  <option value="recon">recon</option>
                  <option value="commander">commander</option>
                  <option value="other">other</option>
                </select>
              </label>
              <div className="god-inline-actions">
                <button type="submit" disabled={busy}>Guardar perfil</button>
                <button type="button" onClick={() => void handleDeleteProfile()} disabled={busy}>Eliminar total</button>
              </div>
            </form>
          ) : (
            <p className="god-muted">Selecciona un usuario del listado.</p>
          )}
        </article>

        <article className="god-card">
          <h4>Administrar tipo de usuario</h4>
          <p className="god-muted">Usa email + rol para asignar o revocar permisos de plataforma.</p>
          <label>
            Email objetivo
            <input
              type="email"
              value={roleEmail}
              onChange={(event) => setRoleEmail(event.target.value)}
              placeholder="usuario@correo.cl"
            />
          </label>
          <label>
            Motivo
            <input value={roleReason} onChange={(event) => setRoleReason(event.target.value)} />
          </label>

          <div className="god-inline-actions">
            <select value={roleToGrant} onChange={(event) => setRoleToGrant(event.target.value as AppRole)}>
              <option value="player">player</option>
              <option value="field_admin">field_admin</option>
              <option value="organizer">organizer</option>
              <option value="super_admin">super_admin</option>
            </select>
            <button type="button" onClick={() => void handleGrantRole()} disabled={busy}>Asignar rol</button>
          </div>

          <div className="god-inline-actions">
            <select value={roleToRevoke} onChange={(event) => setRoleToRevoke(event.target.value as AppRole)}>
              <option value="player">player</option>
              <option value="field_admin">field_admin</option>
              <option value="organizer">organizer</option>
              <option value="super_admin">super_admin</option>
            </select>
            <button type="button" onClick={() => void handleRevokeRole()} disabled={busy}>Revocar rol</button>
          </div>
        </article>
      </div>

      {error ? <p className="god-error">{error}</p> : null}
      <p className="god-status" aria-live="polite">{statusMessage}</p>

      {deleteCandidate ? (
        <div className="god-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="god-delete-title">
          <section className="god-modal-card">
            <h4 id="god-delete-title">Confirmar eliminacion total</h4>
            <p>
              Vas a eliminar completamente al usuario <strong>{deleteCandidate.nickname}</strong> ({deleteCandidate.email}).
            </p>
            <p>Esta accion borra perfil, roles y cuenta de autenticacion.</p>

            <div className="god-inline-actions">
              <button type="button" disabled={busy} onClick={() => setDeleteCandidate(null)}>
                Cancelar
              </button>
              <button type="button" disabled={busy} onClick={() => void handleConfirmDeleteProfile()}>
                {busy ? 'Eliminando...' : 'Confirmar eliminacion total'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
