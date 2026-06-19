import { FormEvent, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import './god-field-maintainer.css';

interface GodFieldMaintainerProps {
  enabled: boolean;
}

interface FieldRow {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  admin_email: string | null;
  google_maps_url: string | null;
  is_active: boolean;
  created_at: string;
}

export default function GodFieldMaintainer({ enabled }: GodFieldMaintainerProps) {
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('Mantenedor de canchas listo.');
  const [fields, setFields] = useState<FieldRow[]>([]);
  
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    city: '',
    address: '',
    admin_email: '',
    google_maps_url: '',
    is_active: true
  });

  useEffect(() => {
    if (enabled) {
      void loadFields();
    }
  }, [enabled]);

  async function loadFields() {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('fields')
        .select('*')
        .order('created_at', { ascending: false });

      if (err) throw err;
      setFields((data as FieldRow[]) || []);
      setStatusMessage(`Se cargaron ${data?.length || 0} canchas.`);
    } catch (e: any) {
      setError(e.message || 'Error cargando canchas');
    } finally {
      setLoading(false);
    }
  }

  function handleOpenCreate() {
    setEditingId(null);
    setFormData({ name: '', city: '', address: '', admin_email: '', google_maps_url: '', is_active: true });
    setShowForm(true);
  }

  function handleOpenEdit(field: FieldRow) {
    setEditingId(field.id);
    setFormData({
      name: field.name,
      city: field.city || '',
      address: field.address || '',
      admin_email: field.admin_email || '',
      google_maps_url: field.google_maps_url || '',
      is_active: field.is_active
    });
    setShowForm(true);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    if (!formData.name.trim()) {
      setError('El nombre de la cancha es obligatorio.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: formData.name.trim(),
        city: formData.city.trim() || null,
        address: formData.address.trim() || null,
        admin_email: formData.admin_email.trim() || null,
        google_maps_url: formData.google_maps_url.trim() || null,
        is_active: formData.is_active
      };

      if (editingId) {
        const { error: err } = await supabase.from('fields').update(payload).eq('id', editingId);
        if (err) throw err;
        setStatusMessage('Cancha actualizada exitosamente.');
      } else {
        const { error: err } = await supabase.from('fields').insert(payload);
        if (err) throw err;
        setStatusMessage('Cancha creada exitosamente.');
      }

      setShowForm(false);
      await loadFields();
    } catch (e: any) {
      setError(e.message || 'Error guardando la cancha.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!supabase) return;
    if (!confirm('¿Estás seguro de eliminar esta cancha? Esta acción puede afectar eventos asignados a ella.')) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.from('fields').delete().eq('id', id);
      if (err) throw err;
      setStatusMessage('Cancha eliminada.');
      await loadFields();
    } catch (e: any) {
      setError(e.message || 'Error eliminando la cancha. Revisa que no tenga eventos vinculados.');
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) return null;

  return (
    <section className="god-field-maintainer-shell">
      <header className="god-field-header">
        <h3>Administración de Canchas</h3>
        <p>Solo Superadmin: Crear, editar y configurar canchas en todo el sistema.</p>
      </header>

      <div className="god-field-toolbar">
        <button type="button" onClick={handleOpenCreate} disabled={busy || loading} className="god-btn-primary">
          + Nueva Cancha
        </button>
        <button type="button" onClick={() => void loadFields()} disabled={busy || loading}>
          {loading ? 'Cargando...' : 'Recargar'}
        </button>
      </div>

      {showForm && (
        <form className="god-field-form-panel" onSubmit={handleSave}>
          <h4>{editingId ? 'Editar Cancha' : 'Nueva Cancha'}</h4>
          <label>
            <span>Nombre de la Cancha *</span>
            <input 
              value={formData.name} 
              onChange={e => setFormData({...formData, name: e.target.value})} 
              required
            />
          </label>
          <label>
            <span>Ciudad</span>
            <input 
              value={formData.city} 
              onChange={e => setFormData({...formData, city: e.target.value})} 
            />
          </label>
          <label>
            <span>Dirección Completa</span>
            <input 
              value={formData.address} 
              onChange={e => setFormData({...formData, address: e.target.value})} 
            />
          </label>
          <label>
            <span>Correo del Administrador</span>
            <input 
              type="email"
              value={formData.admin_email} 
              onChange={e => setFormData({...formData, admin_email: e.target.value})} 
            />
          </label>
          <label>
            <span>URL de Google Maps</span>
            <input 
              type="url"
              placeholder="https://maps.google.com/..."
              value={formData.google_maps_url} 
              onChange={e => setFormData({...formData, google_maps_url: e.target.value})} 
            />
          </label>
          <label className="checkbox-label">
            <input 
              type="checkbox"
              checked={formData.is_active}
              onChange={e => setFormData({...formData, is_active: e.target.checked})}
            />
            <span>Cancha Activa</span>
          </label>

          <div className="form-actions">
            <button type="submit" disabled={busy} className="god-btn-primary">
              {busy ? 'Guardando...' : 'Guardar'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} disabled={busy}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {error ? <p className="god-field-error">{error}</p> : null}

      <div className="god-field-table-wrapper">
        <table className="god-field-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Ciudad</th>
              <th>Dirección</th>
              <th>Admin Email</th>
              <th>Maps</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {fields.map(field => (
              <tr key={field.id}>
                <td>{field.name}</td>
                <td>{field.city || '-'}</td>
                <td>{field.address || '-'}</td>
                <td>{field.admin_email || '-'}</td>
                <td>{field.google_maps_url ? <a href={field.google_maps_url} target="_blank" rel="noreferrer">Ver Mapa</a> : '-'}</td>
                <td>{field.is_active ? '✅ Activa' : '❌ Inactiva'}</td>
                <td className="god-field-actions">
                  <button type="button" onClick={() => handleOpenEdit(field)} disabled={busy}>Editar</button>
                  <button type="button" onClick={() => handleDelete(field.id)} disabled={busy} className="god-btn-danger">Borrar</button>
                </td>
              </tr>
            ))}
            {fields.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="text-center">No hay canchas registradas.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="god-field-status">{statusMessage}</p>
    </section>
  );
}
