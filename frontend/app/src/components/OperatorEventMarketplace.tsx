import { FormEvent, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import './operator-event-marketplace.css';

interface OperatorEventMarketplaceProps {
  enabled: boolean;
  onEventReviewed?: (eventId: string) => void;
}

interface ActiveEventRow {
  event_id: string;
  title: string;
  field_id: string;
  field_name: string;
  field_address?: string | null;
  google_maps_url?: string | null;
  event_date: string;
  max_players: number | null;
  registered_count: number;
  slots_available: number | null;
  is_full: boolean;
  my_registration_status: string | null;
  my_payment_order_id: string | null;
  price?: number | null;
  starts_at?: string | null;
  description?: string | null;
}

interface EventCardViewModel {
  eventId: string;
  title: string;
  fieldName: string;
  fieldAddress: string | null;
  googleMapsUrl: string | null;
  eventDate: string;
  maxPlayers: number | null;
  registeredCount: number;
  slotsAvailable: number | null;
  isFull: boolean;
  myRegistrationStatus: string | null;
  myPaymentOrderId: string | null;
  price: number;
  startsAt: string | null;
  description: string;
}

function formatDateLabel(rawDate: string): string {
  const parsed = new Date(`${rawDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return rawDate;
  }

  return parsed.toLocaleDateString('es-CL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

function mapError(error: unknown): string {
  const message = (error as { message?: string })?.message ?? 'Error inesperado.';
  const lowered = message.toLowerCase();

  if (lowered.includes('could not find the function')) {
    return 'Falta el SQL de mercado de eventos para operador. Ejecuta db/supabase_operator_event_checkout.sql.';
  }
  if (lowered.includes('inscripciones cerradas')) {
    return 'Este evento ya no acepta nuevas inscripciones.';
  }
  if (lowered.includes('no quedan cupos')) {
    return 'No quedan cupos disponibles en este evento.';
  }
  if (lowered.includes('cuenta de pago activa')) {
    return 'La cancha aun no tiene una cuenta de pago activa configurada.';
  }

  return message;
}

export default function OperatorEventMarketplace({ enabled, onEventReviewed }: OperatorEventMarketplaceProps) {
  const [events, setEvents] = useState<EventCardViewModel[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyEventId, setBusyEventId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('Explora eventos activos para registrarte y pagar.');
  const [error, setError] = useState<string | null>(null);
  const [reviewedEventIds, setReviewedEventIds] = useState<Set<string>>(new Set());

  function handleReviewEvent(eventId: string) {
    setReviewedEventIds((prev) => {
      if (prev.has(eventId)) {
        return prev;
      }
      setStatusMessage('Paso completado: evento revisado. ✓');
      return new Set(prev).add(eventId);
    });
    onEventReviewed?.(eventId);
  }

  const visibleEvents = useMemo(() => {
    const token = search.trim().toLowerCase();
    if (!token) {
      return events;
    }

    return events.filter((item) => {
      const haystack = `${item.title} | ${item.fieldName} | ${item.eventDate}`.toLowerCase();
      return haystack.includes(token);
    });
  }, [events, search]);

  useEffect(() => {
    if (!enabled) {
      setEvents([]);
      return;
    }

    void loadEvents();
  }, [enabled]);

  async function loadEvents() {
    if (!supabase || !enabled) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc('operator_active_events_catalog', {
        p_search: null,
        p_limit: 150
      });

      if (rpcError) {
        throw rpcError;
      }

      const rows = ((data as ActiveEventRow[] | null) ?? []).map((row) => ({
        eventId: row.event_id,
        title: row.title,
        fieldName: row.field_name,
        fieldAddress: row.field_address ?? null,
        googleMapsUrl: row.google_maps_url ?? null,
        eventDate: row.event_date,
        maxPlayers: row.max_players,
        registeredCount: Number(row.registered_count ?? 0),
        slotsAvailable: row.slots_available,
        isFull: Boolean(row.is_full),
        myRegistrationStatus: row.my_registration_status,
        myPaymentOrderId: row.my_payment_order_id,
        price: typeof row.price === 'number' ? row.price : 25000,
        startsAt: row.starts_at ?? null,
        description: row.description || `Jornada deportiva en ${row.field_name}. Prepárate para simulación militar, juego limpio y misiones tácticas en un gran ambiente deportivo.`
      }));

      setEvents(rows);
      setStatusMessage(`Eventos activos disponibles: ${rows.length}.`);
    } catch (loadFailure) {
      setError(mapError(loadFailure));
    } finally {
      setLoading(false);
    }
  }

  async function handleRegisterAndPay(eventCard: EventCardViewModel) {
    if (!supabase) {
      return;
    }

    setBusyEventId(eventCard.eventId);
    setError(null);
    setStatusMessage('Generando link de pago seguro con Mercado Pago...');

    try {
      const { data, error } = await supabase.functions.invoke('create-payment-intent', {
        body: { event_id: eventCard.eventId }
      });

      if (error) {
        throw error;
      }

      if (data?.status === 'success' && data?.init_point) {
        // Redirigir a MercadoPago
        window.location.href = data.init_point;
      } else {
        throw new Error(data?.message || 'Error al generar la orden de pago');
      }
    } catch (registerFailure) {
      setError(mapError(registerFailure));
      setBusyEventId(null);
      setStatusMessage('Hubo un problema al contactar a la pasarela de pago.');
    }
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  if (!enabled) {
    return null;
  }

  return (
    <section className="operator-events-shell" aria-label="Cartelera de eventos para operadores">
      <header className="operator-events-header">
        <h3>Eventos Activos y Registro</h3>
        <p>Selecciona un evento, revisa cupos y completa tu registro con pago.</p>
      </header>

      <form className="operator-events-toolbar" onSubmit={handleSearch}>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por evento o cancha"
        />
        <button type="button" onClick={() => void loadEvents()} disabled={loading || busyEventId !== null}>
          {loading ? 'Cargando...' : 'Recargar'}
        </button>
      </form>

      <div className="operator-events-grid">
        {visibleEvents.length === 0 ? <p className="operator-events-muted">No hay eventos activos para mostrar.</p> : null}

        {visibleEvents.map((eventCard) => {
          const alreadyRegistered = Boolean(eventCard.myRegistrationStatus);
          const isBusy = busyEventId === eventCard.eventId;
          const slotsLabel = eventCard.maxPlayers === null
            ? 'Cupo abierto'
            : `${Math.max(0, eventCard.slotsAvailable ?? 0)} de ${eventCard.maxPlayers} disponibles`;

          // Resolved status label and CSS class for badges
          const statusMap: Record<string, { label: string; cls: string }> = {
            pending: { label: 'Pago Pendiente', cls: 'status-pending' },
            pending_payment: { label: 'Pago Pendiente', cls: 'status-pending' },
            confirmed: { label: 'Inscrito', cls: 'status-confirmed' },
            paid: { label: 'Pagado ✓', cls: 'status-paid' },
            rejected: { label: 'Rechazado', cls: 'status-rejected' },
            waitlist: { label: 'Lista de Espera', cls: 'status-waitlist' },
          };
          const rawStatus = eventCard.myRegistrationStatus ?? '';
          const resolvedStatus = statusMap[rawStatus.toLowerCase()] ?? { label: rawStatus.toUpperCase(), cls: 'status-default' };

          const isReviewed = reviewedEventIds.has(eventCard.eventId);

          return (
            <article
              key={eventCard.eventId}
              className="operator-event-card"
              style={{ cursor: 'pointer' }}
              onClick={() => handleReviewEvent(eventCard.eventId)}
            >
              <div className="operator-event-header">
                <p className="operator-event-field">📍 {eventCard.fieldName}</p>
                {alreadyRegistered && (
                  <span className={`operator-event-status-badge ${resolvedStatus.cls}`}>
                    {resolvedStatus.label}
                  </span>
                )}
                {!alreadyRegistered && isReviewed && (
                  <span className="operator-event-status-badge status-confirmed">✓ Revisado</span>
                )}
              </div>

              <h4 className="operator-event-title">{eventCard.title}</h4>
              <p className="operator-event-description" style={{ fontSize: '13px', color: '#bdcbc4', margin: '0 0 14px', lineHeight: '1.4' }}>{eventCard.description}</p>

              <div className="operator-event-details">
                <p className="operator-event-meta">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="event-detail-icon"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                  Fecha: {formatDateLabel(eventCard.eventDate)}
                  {eventCard.startsAt && ` — ${new Date(eventCard.startsAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })} hrs`}
                </p>
                <p className="operator-event-meta">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="event-detail-icon"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                  Cupos: {slotsLabel}
                </p>
                <p className="operator-event-meta">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="event-detail-icon"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                  Valor: {eventCard.price ? `CLP ${eventCard.price.toLocaleString('es-CL')}` : 'Gratis / Liberado'}
                </p>
              </div>

              {(eventCard.fieldAddress || eventCard.googleMapsUrl) && (
                <div className="operator-event-location">
                  {eventCard.fieldAddress && (
                    <p className="operator-event-address">{eventCard.fieldAddress}</p>
                  )}
                  {eventCard.googleMapsUrl && (
                    <a
                      href={eventCard.googleMapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="operator-event-map-btn"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="map-btn-icon"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                      Ver ubicación / Cómo llegar
                    </a>
                  )}
                </div>
              )}

              <div className="operator-event-footer">
                {eventCard.isFull && !alreadyRegistered && (
                  <p className="operator-event-full-badge">Sin cupos disponibles</p>
                )}

                <button
                  type="button"
                  className={`operator-event-cta ${alreadyRegistered ? 'is-registered' : ''}`}
                  disabled={isBusy || eventCard.isFull || alreadyRegistered}
                  onClick={() => void handleRegisterAndPay(eventCard)}
                >
                  {isBusy
                    ? 'Procesando...'
                    : alreadyRegistered
                    ? `Registrado — ${resolvedStatus.label}`
                    : eventCard.isFull
                    ? 'Sin cupos'
                    : 'Registrarme y pagar'}
                </button>
              </div>
            </article>
          );
        })}

      </div>

      {error ? <p className="operator-events-error">{error}</p> : null}
      <p className="operator-events-status" aria-live="polite">{statusMessage}</p>
    </section>
  );
}
