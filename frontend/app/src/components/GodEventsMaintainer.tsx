import { FormEvent, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import './god-events-maintainer.css';

interface GodEventsMaintainerProps {
  enabled: boolean;
}

interface GodEventReportRow {
  event_id: string;
  field_id: string;
  field_name: string | null;
  title: string;
  event_date: string | null;
  created_at: string | null;
  scheduled_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  registration_closed_at: string | null;
  max_players: number | null;
  created_by: string;
  creator_email: string | null;
  is_registration_closed: boolean;
  is_event_closed: boolean;
  total_rows: number;
}

interface EventMaintainerRow {
  eventId: string;
  fieldId: string;
  fieldName: string;
  title: string;
  eventDate: string;
  createdAt: string;
  scheduledAt: string;
  startsAt: string;
  endsAt: string;
  registrationClosedAt: string;
  maxPlayers: number | null;
  createdBy: string;
  creatorEmail: string;
  isRegistrationClosed: boolean;
  isEventClosed: boolean;
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString('es-CL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDateOnly(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString('es-CL', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function mapError(error: unknown): string {
  const message = (error as { message?: string })?.message ?? 'Error inesperado.';
  const lowered = message.toLowerCase();

  if (lowered.includes('solo admin god')) {
    return 'Tu cuenta no tiene permisos de Admin GOD para esta accion.';
  }
  if (lowered.includes('could not find the function')) {
    return 'Faltan funciones SQL del mantenedor de eventos GOD. Ejecuta db/supabase_god_events_maintainer.sql.';
  }
  if (lowered.includes('permission denied') || lowered.includes('row-level security')) {
    return 'No fue posible completar la operacion por permisos insuficientes.';
  }

  return message;
}

export default function GodEventsMaintainer({ enabled }: GodEventsMaintainerProps) {
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('Mantenedor de eventos listo.');

  // Collapsible Filters State
  const [showFilters, setShowFilters] = useState(false);

  // Filter States
  const [creatorEmail, setCreatorEmail] = useState('');
  const [creatorUserId, setCreatorUserId] = useState('');
  const [eventTitle, setEventTitle] = useState('');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [eventDateFrom, setEventDateFrom] = useState('');
  const [eventDateTo, setEventDateTo] = useState('');

  const [events, setEvents] = useState<EventMaintainerRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);

  const [selectedEventId, setSelectedEventId] = useState('');
  const [closeCandidate, setCloseCandidate] = useState<EventMaintainerRow | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<EventMaintainerRow | null>(null);
  const [closeRegistrations, setCloseRegistrations] = useState(true);
  const [closeEvent, setCloseEvent] = useState(true);
  const [reason, setReason] = useState('Gestión operativa desde Admin GOD');

  const selectedEvent = useMemo(
    () => events.find((item) => item.eventId === selectedEventId) ?? null,
    [events, selectedEventId]
  );

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (creatorEmail.trim()) count++;
    if (creatorUserId.trim()) count++;
    if (eventTitle.trim()) count++;
    if (createdFrom) count++;
    if (createdTo) count++;
    if (eventDateFrom) count++;
    if (eventDateTo) count++;
    return count;
  }, [creatorEmail, creatorUserId, eventTitle, createdFrom, createdTo, eventDateFrom, eventDateTo]);

  useEffect(() => {
    if (!enabled) {
      setEvents([]);
      setSelectedEventId('');
      return;
    }

    void loadEvents();
  }, [enabled]);

  async function loadEvents(overrides?: {
    creatorEmail?: string;
    creatorUserId?: string;
    eventTitle?: string;
    createdFrom?: string;
    createdTo?: string;
    eventDateFrom?: string;
    eventDateTo?: string;
  }) {
    if (!supabase || !enabled) {
      return;
    }

    setLoading(true);
    setError(null);

    const nextCreatorEmail = overrides?.creatorEmail ?? creatorEmail;
    const nextCreatorUserId = overrides?.creatorUserId ?? creatorUserId;
    const nextEventTitle = overrides?.eventTitle ?? eventTitle;
    const nextCreatedFrom = overrides?.createdFrom ?? createdFrom;
    const nextCreatedTo = overrides?.createdTo ?? createdTo;
    const nextEventDateFrom = overrides?.eventDateFrom ?? eventDateFrom;
    const nextEventDateTo = overrides?.eventDateTo ?? eventDateTo;

    try {
      const { data, error: reportError } = await supabase.rpc('god_events_maintainer_report', {
        p_creator_email: nextCreatorEmail.trim() || null,
        p_creator_user_id: nextCreatorUserId.trim() || null,
        p_event_title: nextEventTitle.trim() || null,
        p_created_from: nextCreatedFrom || null,
        p_created_to: nextCreatedTo || null,
        p_event_date_from: nextEventDateFrom || null,
        p_event_date_to: nextEventDateTo || null,
        p_limit: 500,
        p_offset: 0
      });

      if (reportError) {
        throw reportError;
      }

      const rows = ((data as GodEventReportRow[] | null) ?? []).map((row) => ({
        eventId: row.event_id,
        fieldId: row.field_id,
        fieldName: row.field_name ?? 'sin-cancha',
        title: row.title,
        eventDate: row.event_date ?? '',
        createdAt: row.created_at ?? '',
        scheduledAt: row.scheduled_at ?? '',
        startsAt: row.starts_at ?? '',
        endsAt: row.ends_at ?? '',
        registrationClosedAt: row.registration_closed_at ?? '',
        maxPlayers: row.max_players,
        createdBy: row.created_by,
        creatorEmail: row.creator_email ?? 'sin-email',
        isRegistrationClosed: Boolean(row.is_registration_closed),
        isEventClosed: Boolean(row.is_event_closed)
      }));

      setEvents(rows);
      const reportTotal = ((data as GodEventReportRow[] | null)?.[0]?.total_rows as number | undefined) ?? rows.length;
      setTotalRows(reportTotal);

      if (rows.length > 0 && !selectedEventId) {
        setSelectedEventId(rows[0].eventId);
      }

      if (rows.length === 0) {
        setSelectedEventId('');
      } else if (!rows.some((item) => item.eventId === selectedEventId)) {
        setSelectedEventId(rows[0].eventId);
      }

      setStatusMessage(`Eventos cargados: ${rows.length} (total: ${reportTotal}).`);
    } catch (loadFailure) {
      setError(mapError(loadFailure));
    } finally {
      setLoading(false);
    }
  }

  async function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadEvents();
    setShowFilters(false); // Collapsed after submitting search
  }

  async function handleConfirmCloseEvent() {
    if (!supabase || !closeCandidate) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const { data, error: closeError } = await supabase.rpc('god_close_event', {
        p_event_id: closeCandidate.eventId,
        p_close_registrations: closeRegistrations,
        p_close_event: closeEvent,
        p_reason: reason.trim() || null
      });

      if (closeError) {
        throw closeError;
      }

      const title = String((data as { title?: string } | null)?.title ?? closeCandidate.title);
      setStatusMessage(`Evento cerrado correctamente: ${title}.`);
      setCloseCandidate(null);
      await loadEvents();
    } catch (closeFailure) {
      setError(mapError(closeFailure));
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmDeleteEvent() {
    if (!supabase || !deleteCandidate) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const { data, error: deleteError } = await supabase.rpc('god_delete_event_permanent', {
        p_event_id: deleteCandidate.eventId,
        p_reason: reason.trim() || null
      });

      if (deleteError) {
        throw deleteError;
      }

      const title = String((data as { title?: string } | null)?.title ?? deleteCandidate.title);
      setStatusMessage(`Evento eliminado permanentemente: ${title}.`);
      setDeleteCandidate(null);
      await loadEvents();
    } catch (deleteFailure) {
      setError(mapError(deleteFailure));
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) {
    return (
      <section className="god-shell">
        <h3 className="god-title">Admin GOD - Eventos</h3>
        <p className="god-subtitle">Esta cuenta no tiene permisos para mantener eventos globales.</p>
      </section>
    );
  }

  return (
    <section className="god-shell" aria-label="Mantenedor de eventos admin god">
      <header className="god-header">
        <h3 className="god-title">Mantenedor Global de Eventos</h3>
        <p className="god-subtitle">Visualiza todos los eventos, aplica filtros y ejecuta cierre o eliminación permanente.</p>
      </header>

      {/* Collapsible Filters Toggle */}
      <div className="god-filters-toggle-bar">
        <button
          type="button"
          className={`god-filters-toggle-btn ${showFilters ? 'is-active' : ''}`}
          onClick={() => setShowFilters(!showFilters)}
        >
          <span>🔍 Filtros de Búsqueda</span>
          {activeFiltersCount > 0 && (
            <span className="god-filter-count-badge">{activeFiltersCount} activo(s)</span>
          )}
          <span className="arrow">{showFilters ? '▲' : '▼'}</span>
        </button>
        {activeFiltersCount > 0 && (
          <button
            type="button"
            className="god-filters-clear-btn-direct"
            onClick={() => {
              setCreatorEmail('');
              setCreatorUserId('');
              setEventTitle('');
              setCreatedFrom('');
              setCreatedTo('');
              setEventDateFrom('');
              setEventDateTo('');
              void loadEvents({
                creatorEmail: '',
                creatorUserId: '',
                eventTitle: '',
                createdFrom: '',
                createdTo: '',
                eventDateFrom: '',
                eventDateTo: ''
              });
            }}
          >
            Limpiar Filtros
          </button>
        )}
      </div>

      {/* Expandable Search Filters Form */}
      {showFilters && (
        <form className="god-events-filter-card" onSubmit={handleSearchSubmit}>
          <div className="god-events-filter-grid">
            <label>
              <span>Creador (email)</span>
              <input
                value={creatorEmail}
                onChange={(event) => setCreatorEmail(event.target.value)}
                placeholder="admin@cancha.cl"
              />
            </label>
            <label>
              <span>Creador (User ID)</span>
              <input
                value={creatorUserId}
                onChange={(event) => setCreatorUserId(event.target.value)}
                placeholder="UUID de Supabase"
              />
            </label>
            <label className="filter-span-2">
              <span>Nombre del evento</span>
              <input
                value={eventTitle}
                onChange={(event) => setEventTitle(event.target.value)}
                placeholder="Operación o Jornada..."
              />
            </label>
            <label>
              <span>Creado desde</span>
              <input type="date" value={createdFrom} onChange={(event) => setCreatedFrom(event.target.value)} />
            </label>
            <label>
              <span>Creado hasta</span>
              <input type="date" value={createdTo} onChange={(event) => setCreatedTo(event.target.value)} />
            </label>
            <label>
              <span>Fecha evento desde</span>
              <input type="date" value={eventDateFrom} onChange={(event) => setEventDateFrom(event.target.value)} />
            </label>
            <label>
              <span>Fecha evento hasta</span>
              <input type="date" value={eventDateTo} onChange={(event) => setEventDateTo(event.target.value)} />
            </label>
          </div>

          <div className="god-filter-actions">
            <button type="submit" className="god-btn-apply-filters" disabled={loading || busy}>
              {loading ? 'Buscando...' : 'Aplicar Filtros'}
            </button>
            <button
              type="button"
              className="god-btn-clear-filters"
              disabled={loading || busy}
              onClick={() => {
                setCreatorEmail('');
                setCreatorUserId('');
                setEventTitle('');
                setCreatedFrom('');
                setCreatedTo('');
                setEventDateFrom('');
                setEventDateTo('');
                void loadEvents({
                  creatorEmail: '',
                  creatorUserId: '',
                  eventTitle: '',
                  createdFrom: '',
                  createdTo: '',
                  eventDateFrom: '',
                  eventDateTo: ''
                });
              }}
            >
              Limpiar filtros
            </button>
          </div>
        </form>
      )}

      {/* TWO-COLUMN GRID LAYOUT */}
      <div className="god-maintainer-layout">
        {/* LEFT COLUMN: Events list */}
        <aside className="god-sidebar">
          <div className="god-sidebar-header">
            <h4>Eventos Encontrados</h4>
            <span className="god-count-badge">{events.length} de {totalRows}</span>
          </div>

          <div className="god-user-list-container">
            {events.length === 0 ? (
              <p className="god-empty-msg">No se encontraron eventos para mostrar.</p>
            ) : (
              <ul className="god-user-cards-list">
                {events.map((item) => {
                  const isActive = selectedEventId === item.eventId;
                  return (
                    <li key={item.eventId}>
                      <button
                        type="button"
                        className={`god-user-card-btn god-event-card-btn ${isActive ? 'is-active' : ''}`}
                        onClick={() => setSelectedEventId(item.eventId)}
                      >
                        <div className="god-event-card-icon">📅</div>
                        <div className="god-card-info">
                          <span className="god-card-nickname">{item.title}</span>
                          <span className="god-card-email">📍 {item.fieldName}</span>
                          <div className="god-event-meta-row">
                            <small className="date">📅 {item.eventDate || 'N/D'}</small>
                            <small className="creator">{item.creatorEmail}</small>
                          </div>
                          <div className="god-card-role-pills" style={{ marginTop: '6px' }}>
                            <span className={`god-role-pill ${item.isEventClosed ? 'is-none' : 'is-super_admin'}`} style={{ background: item.isEventClosed ? 'rgba(255,255,255,0.05)' : 'rgba(46,117,80,0.15)', borderColor: item.isEventClosed ? 'rgba(255,255,255,0.15)' : 'rgba(142,232,190,0.4)', color: item.isEventClosed ? '#b0b0b0' : '#8ee8be' }}>
                              {item.isEventClosed ? 'Evento Cerrado' : 'Evento Activo'}
                            </span>
                            <span className={`god-role-pill ${item.isRegistrationClosed ? 'is-organizer' : 'is-field_admin'}`}>
                              {item.isRegistrationClosed ? 'Inscripciones Cerradas' : 'Inscripciones Abiertas'}
                            </span>
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

        {/* RIGHT COLUMN: Event details pane */}
        <main className="god-detail-pane">
          {selectedEvent ? (
            <div className="god-detail-wrapper">
              <header className="god-detail-header">
                <div className="god-detail-avatar" style={{ fontSize: '28px', display: 'grid', placeItems: 'center', borderColor: selectedEvent.isEventClosed ? '#8da398' : '#8ee8be' }}>
                  ⚔️
                </div>
                <div className="god-detail-title-block">
                  <h3>{selectedEvent.title}</h3>
                  <p>📍 {selectedEvent.fieldName}</p>
                </div>
              </header>

              <nav className="god-detail-tabs">
                <span className="god-tab-btn is-active">Detalles del Evento</span>
              </nav>

              <div className="god-tab-content">
                <div className="god-metrics-summary-grid">
                  <article className="god-metric-card highlight">
                    <span className="god-metric-icon">📅</span>
                    <div className="god-metric-data">
                      <span className="god-metric-value" style={{ fontSize: '15px' }}>
                        {selectedEvent.eventDate ? formatDateOnly(selectedEvent.eventDate) : 'N/D'}
                      </span>
                      <span className="god-metric-label">Fecha del Evento</span>
                    </div>
                  </article>

                  <article className="god-metric-card highlight">
                    <span className="god-metric-icon">👥</span>
                    <div className="god-metric-data">
                      <span className="god-metric-value">
                        {selectedEvent.maxPlayers ?? 'Sin límite'}
                      </span>
                      <span className="god-metric-label">Cupo Máximo Jugadores</span>
                    </div>
                  </article>
                </div>

                <h4 className="god-section-subtitle">Estado Actual</h4>
                <div className="god-fairplay-cards-row">
                  <div className="god-fp-badge" style={{
                    background: selectedEvent.isEventClosed ? 'rgba(255,255,255,0.03)' : 'rgba(46, 117, 80, 0.12)',
                    borderColor: selectedEvent.isEventClosed ? 'rgba(255,255,255,0.1)' : 'rgba(46, 117, 80, 0.35)',
                    color: selectedEvent.isEventClosed ? '#b0b0b0' : '#8ee8be'
                  }}>
                    <span className="count" style={{ fontSize: '15px' }}>
                      {selectedEvent.isEventClosed ? 'Cerrado' : 'Abierto'}
                    </span>
                    <span className="label">Estado Evento</span>
                  </div>

                  <div className="god-fp-badge" style={{
                    background: selectedEvent.isRegistrationClosed ? 'rgba(255, 99, 132, 0.12)' : 'rgba(54, 162, 235, 0.12)',
                    borderColor: selectedEvent.isRegistrationClosed ? 'rgba(255, 99, 132, 0.35)' : 'rgba(54, 162, 235, 0.35)',
                    color: selectedEvent.isRegistrationClosed ? '#ff6384' : '#36a2eb'
                  }}>
                    <span className="count" style={{ fontSize: '15px' }}>
                      {selectedEvent.isRegistrationClosed ? 'Cerradas' : 'Abiertas'}
                    </span>
                    <span className="label">Inscripciones</span>
                  </div>
                </div>

                <h4 className="god-section-subtitle">Información del Creador y Fechas</h4>
                <table className="god-metrics-table">
                  <tbody>
                    <tr>
                      <th>ID de Evento</th>
                      <td style={{ fontSize: '11px', fontFamily: 'monospace' }}>{selectedEvent.eventId}</td>
                    </tr>
                    <tr>
                      <th>Creador (Email)</th>
                      <td>{selectedEvent.creatorEmail}</td>
                    </tr>
                    <tr>
                      <th>Creador (User ID)</th>
                      <td style={{ fontSize: '11px', fontFamily: 'monospace' }}>{selectedEvent.createdBy}</td>
                    </tr>
                    <tr>
                      <th>Fecha Creación</th>
                      <td>{selectedEvent.createdAt ? formatDateTime(selectedEvent.createdAt) : 'N/D'}</td>
                    </tr>
                    <tr>
                      <th>Fecha Programado</th>
                      <td>{selectedEvent.scheduledAt ? formatDateTime(selectedEvent.scheduledAt) : 'N/D'}</td>
                    </tr>
                    <tr>
                      <th>Fecha Inicio Real</th>
                      <td>{selectedEvent.startsAt ? formatDateTime(selectedEvent.startsAt) : 'No iniciado'}</td>
                    </tr>
                    <tr>
                      <th>Fecha Término Real</th>
                      <td>{selectedEvent.endsAt ? formatDateTime(selectedEvent.endsAt) : 'Abierto'}</td>
                    </tr>
                  </tbody>
                </table>

                {/* Event Actions Form Block */}
                <div className="god-event-actions-form" style={{ marginTop: '24px', background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <h4 className="god-section-subtitle" style={{ marginTop: 0 }}>Acciones Administrativas</h4>
                  
                  <label className="god-form-field" style={{ marginBottom: '16px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#a0bdb0', marginBottom: '6px', display: 'block' }}>
                      Motivo de la acción / Comentarios
                    </span>
                    <input
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Indique la justificación del cambio"
                      style={{
                        width: '100%',
                        borderRadius: '10px',
                        border: '1px solid rgba(190, 232, 209, 0.2)',
                        background: 'rgba(6, 12, 13, 0.85)',
                        color: '#eef8f4',
                        padding: '10px 12px',
                        fontSize: '14px'
                      }}
                    />
                  </label>

                  <div className="god-form-actions">
                    <button
                      type="button"
                      className="god-btn-primary"
                      disabled={busy || selectedEvent.isEventClosed}
                      onClick={() => {
                        setCloseRegistrations(true);
                        setCloseEvent(true);
                        setCloseCandidate(selectedEvent);
                      }}
                    >
                      {selectedEvent.isEventClosed ? 'Evento ya cerrado' : 'Cerrar Evento'}
                    </button>
                    <button
                      type="button"
                      className="god-btn-danger"
                      disabled={busy}
                      onClick={() => setDeleteCandidate(selectedEvent)}
                    >
                      Eliminar Permanente
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="god-detail-empty">
              <span>⚔️</span>
              <p>Selecciona un evento del listado de la izquierda para ver y gestionar sus datos.</p>
            </div>
          )}
        </main>
      </div>

      {error ? <p className="god-error">{error}</p> : null}
      <p className="god-status" aria-live="polite">{statusMessage}</p>

      {/* Close Event Modal */}
      {closeCandidate ? (
        <div className="god-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="god-close-event-title">
          <section className="god-modal-card">
            <h4 id="god-close-event-title" style={{ color: '#ff9f40' }}>Confirmar Cierre de Evento</h4>
            <p>Estás cerrando administrativamente el evento: <strong>{closeCandidate.title}</strong></p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', margin: '8px 0', textAlign: 'left' }}>
              <label style={{ display: 'flex', gap: '8px', cursor: 'pointer', color: '#eef8f4', fontSize: '14px' }}>
                <input
                  type="checkbox"
                  checked={closeRegistrations}
                  onChange={(event) => setCloseRegistrations(event.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: '#8ee8be' }}
                />
                Cerrar inscripciones al público
              </label>

              <label style={{ display: 'flex', gap: '8px', cursor: 'pointer', color: '#eef8f4', fontSize: '14px' }}>
                <input
                  type="checkbox"
                  checked={closeEvent}
                  onChange={(event) => setCloseEvent(event.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: '#8ee8be' }}
                />
                Marcar evento como cerrado/finalizado
              </label>
            </div>

            <div className="god-inline-actions">
              <button type="button" disabled={busy} onClick={() => setCloseCandidate(null)} className="god-btn-cancel">
                Cancelar
              </button>
              <button type="button" disabled={busy} onClick={() => void handleConfirmCloseEvent()} className="god-btn-primary" style={{ flex: 1, background: 'linear-gradient(150deg, rgba(235, 140, 54, 0.95), rgba(99, 50, 15, 0.98))', borderColor: 'rgba(255, 159, 64, 0.4)' }}>
                {busy ? 'Cerrando...' : 'Confirmar Cierre'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {/* Delete Permanent Modal */}
      {deleteCandidate ? (
        <div className="god-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="god-delete-event-title">
          <section className="god-modal-card">
            <h4 id="god-delete-event-title">Confirmar Eliminación Permanente</h4>
            <p>
              Vas a eliminar de forma irreversible el evento <strong>{deleteCandidate.title}</strong> ({deleteCandidate.eventId}).
            </p>
            <p className="warning-text">
              ⚠️ Esta acción borrará todas las inscripciones, cronometrajes, incidentes y dependencias del evento según la configuración de la base de datos. No se puede deshacer.
            </p>

            <div className="god-inline-actions">
              <button type="button" disabled={busy} onClick={() => setDeleteCandidate(null)} className="god-btn-cancel">
                Cancelar
              </button>
              <button type="button" disabled={busy} onClick={() => void handleConfirmDeleteEvent()} className="god-btn-confirm-delete">
                {busy ? 'Eliminando...' : 'Confirmar Eliminación'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
