import { FormEvent, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import './operator-event-marketplace.css';

interface OperatorEventMarketplaceProps {
  enabled: boolean;
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

export default function OperatorEventMarketplace({ enabled }: OperatorEventMarketplaceProps) {
  const [events, setEvents] = useState<EventCardViewModel[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyEventId, setBusyEventId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('Explora eventos activos para registrarte y pagar.');
  const [error, setError] = useState<string | null>(null);

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
        myPaymentOrderId: row.my_payment_order_id
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
            : `${Math.max(0, eventCard.slotsAvailable ?? 0)} disponibles de ${eventCard.maxPlayers}`;

          return (
            <article key={eventCard.eventId} className="operator-event-card">
              <p className="operator-event-field">{eventCard.fieldName}</p>
              <h4>{eventCard.title}</h4>
              <p className="operator-event-meta">Fecha: {formatDateLabel(eventCard.eventDate)}</p>
              {eventCard.fieldAddress && (
                <p className="operator-event-meta">
                  📍 {eventCard.fieldAddress}
                  {eventCard.googleMapsUrl && (
                    <> - <a href={eventCard.googleMapsUrl} target="_blank" rel="noreferrer" style={{color: '#96e9bf'}}>Abrir Mapa</a></>
                  )}
                </p>
              )}
              <p className="operator-event-meta">Cupos: {slotsLabel}</p>
              <p className="operator-event-meta">Registrados: {eventCard.registeredCount}</p>
              <p className="operator-event-meta">Valor: CLP 25.000</p>

              {alreadyRegistered ? (
                <p className="operator-event-tag is-registered">
                  Ya registrado ({String(eventCard.myRegistrationStatus).toUpperCase()})
                </p>
              ) : null}

              <button
                type="button"
                disabled={isBusy || eventCard.isFull || alreadyRegistered}
                onClick={() => void handleRegisterAndPay(eventCard)}
              >
                {isBusy ? 'Procesando pago...' : alreadyRegistered ? 'Registrado' : eventCard.isFull ? 'Sin cupos' : 'Registrarme y pagar'}
              </button>
            </article>
          );
        })}
      </div>

      {error ? <p className="operator-events-error">{error}</p> : null}
      <p className="operator-events-status" aria-live="polite">{statusMessage}</p>
    </section>
  );
}
