import { useMemo, useState } from 'react';
import './organizer-dashboard.css';

interface FieldRow {
  id: string;
  name: string;
  city: string | null;
}

interface EventRow {
  id: string;
  title: string;
  event_date: string;
  starts_at: string | null;
  ends_at: string | null;
  scheduled_at?: string | null;
  max_players?: number | null;
  price?: number | null;
  registration_closed_at?: string | null;
  field_id: string;
  created_at: string;
}

interface OrganizerDashboardProps {
  events: EventRow[];
  fields: FieldRow[];
  onEventSelect: (eventId: string) => void;
  onCreateNewEvent: () => void;
}

export default function OrganizerDashboard({
  events,
  fields,
  onEventSelect,
  onCreateNewEvent
}: OrganizerDashboardProps) {
  const [filter, setFilter] = useState<'all' | 'open' | 'historical'>('open');

  const fieldsMap = useMemo(() => {
    const map = new Map<string, string>();
    fields.forEach((f) => map.set(f.id, f.name));
    return map;
  }, [fields]);

  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (filter === 'open') return !e.ends_at;
      if (filter === 'historical') return Boolean(e.ends_at);
      return true;
    });
  }, [events, filter]);

  return (
    <div className="org-dashboard-container">
      <div className="org-dashboard-header">
        <div className="org-dashboard-tabs">
          <button
            className={`org-dash-tab ${filter === 'open' ? 'is-active' : ''}`}
            onClick={() => setFilter('open')}
          >
            Eventos Abiertos
          </button>
          <button
            className={`org-dash-tab ${filter === 'historical' ? 'is-active' : ''}`}
            onClick={() => setFilter('historical')}
          >
            Historial
          </button>
          <button
            className={`org-dash-tab ${filter === 'all' ? 'is-active' : ''}`}
            onClick={() => setFilter('all')}
          >
            Todos
          </button>
        </div>
        <button className="org-dash-create-btn" onClick={onCreateNewEvent}>
          + Nuevo Evento
        </button>
      </div>

      {filteredEvents.length === 0 ? (
        <div className="org-dash-empty">
          <p>No se encontraron eventos en esta categoría.</p>
        </div>
      ) : (
        <div className="org-dashboard-grid">
          {filteredEvents.map((evt) => {
            const isHistorical = Boolean(evt.ends_at);
            const isRegistrationClosed = Boolean(evt.registration_closed_at);
            const fieldName = fieldsMap.get(evt.field_id) || 'Cancha Desconocida';
            
            // Format date carefully
            const dateObj = new Date(evt.event_date + (evt.event_date.includes('T') ? '' : 'T12:00:00'));
            const displayDate = dateObj.toLocaleDateString('es-CL', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              year: 'numeric'
            });

            return (
              <div 
                key={evt.id} 
                className={`org-event-card ${isHistorical ? 'is-historical' : ''}`}
                onClick={() => onEventSelect(evt.id)}
              >
                <div className="org-event-card-header">
                  <h4>{evt.title}</h4>
                  <span className={`org-event-badge ${isHistorical ? 'badge-historical' : (isRegistrationClosed ? 'badge-closed' : 'badge-open')}`}>
                    {isHistorical ? 'Finalizado' : (isRegistrationClosed ? 'Cerrado' : 'Abierto')}
                  </span>
                </div>
                
                <div className="org-event-card-body">
                  <div className="org-event-info-row">
                    <span className="org-info-icon">📍</span>
                    <span>{fieldName}</span>
                  </div>
                  <div className="org-event-info-row">
                    <span className="org-info-icon">📅</span>
                    <span className="org-info-capitalize">{displayDate}</span>
                  </div>
                  {evt.max_players && (
                    <div className="org-event-info-row">
                      <span className="org-info-icon">👥</span>
                      <span>Capacidad: {evt.max_players} jug.</span>
                    </div>
                  )}
                </div>

                <div className="org-event-card-footer">
                  <span className="org-event-action-text">Gestionar Evento &rarr;</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
