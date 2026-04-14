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
  const [reason, setReason] = useState('Gestion operativa desde Admin GOD');

  const selectedEvent = useMemo(
    () => events.find((item) => item.eventId === selectedEventId) ?? null,
    [events, selectedEventId]
  );

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
        <p className="god-subtitle">Visualiza todos los eventos, aplica filtros y ejecuta cierre o eliminacion permanente.</p>
      </header>

      <form className="god-events-filter-grid" onSubmit={handleSearchSubmit}>
        <label>
          Creador (email)
          <input
            value={creatorEmail}
            onChange={(event) => setCreatorEmail(event.target.value)}
            placeholder="admin@cancha.cl"
          />
        </label>
        <label>
          Creador (User ID)
          <input
            value={creatorUserId}
            onChange={(event) => setCreatorUserId(event.target.value)}
            placeholder="UUID"
          />
        </label>
        <label>
          Nombre del evento
          <input
            value={eventTitle}
            onChange={(event) => setEventTitle(event.target.value)}
            placeholder="Operacion Norte"
          />
        </label>
        <label>
          Creado desde
          <input type="date" value={createdFrom} onChange={(event) => setCreatedFrom(event.target.value)} />
        </label>
        <label>
          Creado hasta
          <input type="date" value={createdTo} onChange={(event) => setCreatedTo(event.target.value)} />
        </label>
        <label>
          Fecha evento desde
          <input type="date" value={eventDateFrom} onChange={(event) => setEventDateFrom(event.target.value)} />
        </label>
        <label>
          Fecha evento hasta
          <input type="date" value={eventDateTo} onChange={(event) => setEventDateTo(event.target.value)} />
        </label>

        <div className="god-inline-actions">
          <button type="submit" disabled={loading || busy}>{loading ? 'Buscando...' : 'Filtrar eventos'}</button>
          <button
            type="button"
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

      <div className="god-grid god-events-grid">
        <article className="god-card">
          <h4>Eventos</h4>
          <p className="god-muted">Mostrando: {events.length} | Total reporte: {totalRows}</p>
          <ul className="god-list">
            {events.length === 0 ? <li>Sin eventos para mostrar.</li> : null}
            {events.map((item) => (
              <li key={item.eventId}>
                <button
                  type="button"
                  className={`god-user-btn ${selectedEventId === item.eventId ? 'is-active' : ''}`}
                  onClick={() => setSelectedEventId(item.eventId)}
                >
                  <strong>{item.title}</strong>
                  <span>{item.fieldName}</span>
                  <small>{item.creatorEmail}</small>
                  <small>Creado: {item.createdAt ? formatDateTime(item.createdAt) : 'N/D'}</small>
                </button>
              </li>
            ))}
          </ul>
        </article>

        <article className="god-card">
          <h4>Detalle y acciones</h4>
          {selectedEvent ? (
            <div className="god-events-detail">
              <p><strong>ID:</strong> {selectedEvent.eventId}</p>
              <p><strong>Cancha:</strong> {selectedEvent.fieldName}</p>
              <p><strong>Creador:</strong> {selectedEvent.creatorEmail}</p>
              <p><strong>Fecha evento:</strong> {selectedEvent.eventDate || 'N/D'}</p>
              <p><strong>Fecha creacion:</strong> {selectedEvent.createdAt ? formatDateTime(selectedEvent.createdAt) : 'N/D'}</p>
              <p><strong>Programado:</strong> {selectedEvent.scheduledAt ? formatDateTime(selectedEvent.scheduledAt) : 'N/D'}</p>
              <p><strong>Inicio:</strong> {selectedEvent.startsAt ? formatDateTime(selectedEvent.startsAt) : 'N/D'}</p>
              <p><strong>Cierre evento:</strong> {selectedEvent.endsAt ? formatDateTime(selectedEvent.endsAt) : 'Abierto'}</p>
              <p><strong>Inscripciones:</strong> {selectedEvent.registrationClosedAt ? 'Cerradas' : 'Abiertas'}</p>
              <p><strong>Cupo maximo:</strong> {selectedEvent.maxPlayers ?? 'Sin limite'}</p>

              <label>
                Motivo de accion
                <input value={reason} onChange={(event) => setReason(event.target.value)} />
              </label>

              <div className="god-inline-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setCloseRegistrations(true);
                    setCloseEvent(true);
                    setCloseCandidate(selectedEvent);
                  }}
                >
                  Cerrar evento
                </button>
                <button type="button" disabled={busy} onClick={() => setDeleteCandidate(selectedEvent)}>
                  Eliminar permanente
                </button>
              </div>
            </div>
          ) : (
            <p className="god-muted">Selecciona un evento del listado.</p>
          )}
        </article>
      </div>

      {error ? <p className="god-error">{error}</p> : null}
      <p className="god-status" aria-live="polite">{statusMessage}</p>

      {closeCandidate ? (
        <div className="god-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="god-close-event-title">
          <section className="god-modal-card">
            <h4 id="god-close-event-title">Confirmar cierre de evento</h4>
            <p>Evento: <strong>{closeCandidate.title}</strong></p>

            <label>
              <input
                type="checkbox"
                checked={closeRegistrations}
                onChange={(event) => setCloseRegistrations(event.target.checked)}
              />
              Cerrar inscripciones
            </label>

            <label>
              <input type="checkbox" checked={closeEvent} onChange={(event) => setCloseEvent(event.target.checked)} />
              Marcar evento como cerrado
            </label>

            <div className="god-inline-actions">
              <button type="button" disabled={busy} onClick={() => setCloseCandidate(null)}>
                Cancelar
              </button>
              <button type="button" disabled={busy} onClick={() => void handleConfirmCloseEvent()}>
                {busy ? 'Cerrando...' : 'Confirmar cierre'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {deleteCandidate ? (
        <div className="god-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="god-delete-event-title">
          <section className="god-modal-card">
            <h4 id="god-delete-event-title">Confirmar eliminacion permanente</h4>
            <p>
              Vas a eliminar el evento <strong>{deleteCandidate.title}</strong> ({deleteCandidate.eventId}).
            </p>
            <p>Esta accion es permanente y elimina sus dependencias segun la configuracion de base de datos.</p>

            <div className="god-inline-actions">
              <button type="button" disabled={busy} onClick={() => setDeleteCandidate(null)}>
                Cancelar
              </button>
              <button type="button" disabled={busy} onClick={() => void handleConfirmDeleteEvent()}>
                {busy ? 'Eliminando...' : 'Confirmar eliminacion'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
