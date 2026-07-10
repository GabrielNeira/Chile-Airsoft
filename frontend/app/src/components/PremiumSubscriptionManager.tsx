import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import './premium-subscription-manager.css';

interface OperatorSubscriptionRow {
  userId: string;
  nickname: string;
  realName: string;
  isPremium: boolean;
  team: string;
}

interface RawSubscriptionRow {
  user_id: string;
  nickname: string;
  real_name: string;
  is_premium: boolean;
  team: string;
}

export default function PremiumSubscriptionManager() {
  const [operators, setOperators] = useState<OperatorSubscriptionRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('Panel de suscripciones premium cargado.');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadOperators();
  }, []);

  async function loadOperators() {
    if (!supabase) return;
    setLoading(true);
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc('get_operators_for_premium_management');
      if (rpcError) {
        throw rpcError;
      }

      const rows = ((data as RawSubscriptionRow[] | null) ?? []).map((row) => ({
        userId: row.user_id,
        nickname: row.nickname,
        realName: row.real_name,
        isPremium: Boolean(row.is_premium),
        team: row.team || 'Sin equipo'
      }));

      setOperators(rows);
      setStatusMessage(`Operadores cargados: ${rows.length}.`);
    } catch (loadFailure: any) {
      console.error('Error al cargar operadores:', loadFailure);
      setError(loadFailure?.message ?? 'No se pudieron cargar los operadores.');
    } finally {
      setLoading(false);
    }
  }

  async function handleTogglePremium(operator: OperatorSubscriptionRow) {
    if (!supabase) return;
    setBusyUserId(operator.userId);
    setError(null);
    const nextPremiumState = !operator.isPremium;
    setStatusMessage(`Actualizando suscripción de ${operator.nickname}...`);

    try {
      const { error: rpcError } = await supabase.rpc('toggle_operator_premium_status', {
        p_operator_user_id: operator.userId,
        p_is_premium: nextPremiumState
      });

      if (rpcError) {
        throw rpcError;
      }

      // Update state locally
      setOperators((prev) =>
        prev.map((op) =>
          op.userId === operator.userId ? { ...op, isPremium: nextPremiumState } : op
        )
      );

      setStatusMessage(`Suscripción premium de ${operator.nickname} ${nextPremiumState ? 'activada' : 'desactivada'} con éxito.`);
    } catch (toggleFailure: any) {
      console.error('Error al cambiar suscripción premium:', toggleFailure);
      setError(toggleFailure?.message ?? 'No se pudo cambiar el estado de la suscripción.');
    } finally {
      setBusyUserId(null);
    }
  }

  const filteredOperators = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return operators;
    return operators.filter(
      (op) =>
        op.nickname.toLowerCase().includes(query) ||
        op.realName.toLowerCase().includes(query) ||
        op.team.toLowerCase().includes(query)
    );
  }, [operators, search]);

  return (
    <section className="premium-manager-shell" aria-label="Gestión de suscripciones premium">
      <header className="premium-manager-header">
        <h3>Gestión de Suscripciones Premium 💎</h3>
        <p>Panel exclusivo para Homura y Administradores. Activa o desactiva la suscripción premium de los operadores de la plataforma.</p>
      </header>

      <div className="premium-manager-toolbar">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por alias, nombre o equipo..."
          className="premium-search-input"
        />
        <button
          type="button"
          onClick={() => void loadOperators()}
          disabled={loading || busyUserId !== null}
          className="premium-reload-btn"
        >
          {loading ? 'Cargando...' : 'Recargar lista'}
        </button>
      </div>

      {error && <p className="premium-manager-error">{error}</p>}
      <p className="premium-manager-status" aria-live="polite">{statusMessage}</p>

      <div className="premium-table-wrap">
        {loading && operators.length === 0 ? (
          <p className="premium-manager-loading">Cargando lista de operadores...</p>
        ) : filteredOperators.length === 0 ? (
          <p className="premium-manager-empty">No se encontraron operadores.</p>
        ) : (
          <table className="premium-manager-table">
            <thead>
              <tr>
                <th>Operador (Alias)</th>
                <th>Nombre Real</th>
                <th>Equipo</th>
                <th>Estado Premium</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {filteredOperators.map((op) => {
                const isBusy = busyUserId === op.userId;
                // Homura cannot deactivate herself
                const isSelfHomura = op.userId === '4acf55e2-8ad8-427f-8adc-be8c94d0718b';
                return (
                  <tr key={op.userId} className={op.isPremium ? 'row-premium' : ''}>
                    <td className="cell-nickname">
                      {op.isPremium && <span className="premium-star">💎</span>}
                      {op.nickname}
                    </td>
                    <td>{op.realName}</td>
                    <td>{op.team}</td>
                    <td>
                      <span className={`premium-status-pill ${op.isPremium ? 'is-active' : 'is-inactive'}`}>
                        {op.isPremium ? 'Premium' : 'Estándar'}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => void handleTogglePremium(op)}
                        disabled={isBusy || isSelfHomura}
                        className={`premium-toggle-btn ${op.isPremium ? 'btn-deactivate' : 'btn-activate'}`}
                      >
                        {isBusy
                          ? 'Procesando...'
                          : isSelfHomura
                          ? 'Homura (Titular)'
                          : op.isPremium
                          ? 'Remover Premium'
                          : 'Hacer Premium'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
