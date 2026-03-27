import { useMemo, useState } from 'react';

type FairPlayStatus = 'green' | 'yellow' | 'red';

interface ScanResult {
  operatorUserId: string;
  nickname: string;
  role: string;
  bloodGroup: string;
  team?: string;
}

interface OrganizerScannerViewProps {
  eventId: string;
  onResolveQr: (rawQr: string) => Promise<ScanResult>;
  onCheckin: (payload: { eventId: string; operatorUserId: string }) => Promise<void>;
  onChronoValidate: (payload: {
    eventId: string;
    operatorUserId: string;
    replicaId: string;
    fps: number;
    joules: number;
    bbWeightG: number;
    note?: string;
  }) => Promise<void>;
  onFairPlayReport: (payload: {
    eventId: string;
    operatorUserId: string;
    status: FairPlayStatus;
    reason?: string;
  }) => Promise<void>;
}

export function OrganizerScannerView({
  eventId,
  onResolveQr,
  onCheckin,
  onChronoValidate,
  onFairPlayReport
}: OrganizerScannerViewProps) {
  const [rawQr, setRawQr] = useState('');
  const [target, setTarget] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('Esperando escaneo');

  const [replicaId, setReplicaId] = useState('');
  const [fps, setFps] = useState('');
  const [joules, setJoules] = useState('');
  const [bbWeightG, setBbWeightG] = useState('0.20');
  const [chronoNote, setChronoNote] = useState('');

  const [fairPlayStatus, setFairPlayStatus] = useState<FairPlayStatus>('green');
  const [fairPlayReason, setFairPlayReason] = useState('');

  const canSubmit = useMemo(() => Boolean(target?.operatorUserId), [target]);

  async function handleScanResolve() {
    try {
      setLoading(true);
      const profile = await onResolveQr(rawQr.trim());
      setTarget(profile);
      setStatus(`Operador detectado: ${profile.nickname}`);
    } catch (error) {
      setStatus(`QR invalido o no encontrado: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckin() {
    if (!target) return;
    await onCheckin({ eventId, operatorUserId: target.operatorUserId });
    setStatus('Check-in confirmado');
  }

  async function handleChrono() {
    if (!target) return;
    await onChronoValidate({
      eventId,
      operatorUserId: target.operatorUserId,
      replicaId,
      fps: Number(fps),
      joules: Number(joules),
      bbWeightG: Number(bbWeightG),
      note: chronoNote || undefined
    });
    setStatus('Crono validado');
  }

  async function handleFairPlay() {
    if (!target) return;
    await onFairPlayReport({
      eventId,
      operatorUserId: target.operatorUserId,
      status: fairPlayStatus,
      reason: fairPlayReason || undefined
    });
    setStatus('Fair Play registrado');
  }

  return (
    <section style={{ maxWidth: 560, margin: '0 auto', color: '#e8f1f4', fontFamily: 'Rajdhani, Segoe UI, sans-serif' }}>
      <h2 style={{ marginBottom: 8 }}>Validador In-Game</h2>
      <p style={{ marginTop: 0, color: '#9caab3' }}>Organizador: escanea QR, valida crono y cierra fair play.</p>

      <div style={{ border: '1px solid #2d3a45', borderRadius: 12, padding: 12, background: '#0f171e' }}>
        <label htmlFor="rawQr">QR Capturado</label>
        <input
          id="rawQr"
          type="text"
          placeholder="pega valor de QR o token"
          value={rawQr}
          onChange={(e) => setRawQr(e.target.value)}
          style={{ width: '100%', marginTop: 6, marginBottom: 10, padding: 8, borderRadius: 8, border: '1px solid #364654', background: '#0b1116', color: '#e8f1f4' }}
        />
        <button disabled={loading || !rawQr.trim()} onClick={handleScanResolve}>Resolver QR</button>
      </div>

      <p style={{ color: '#c8ff5c' }}>{status}</p>

      {target && (
        <div style={{ border: '1px solid #2d3a45', borderRadius: 12, padding: 12, background: '#0f171e', marginTop: 12 }}>
          <p style={{ margin: 0, fontWeight: 700 }}>{target.nickname}</p>
          <p style={{ margin: '4px 0', color: '#9caab3' }}>{target.role} | Sangre {target.bloodGroup}</p>
          <p style={{ margin: 0, color: '#9caab3' }}>{target.team || 'Sin team'}</p>

          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button disabled={!canSubmit} onClick={handleCheckin}>Marcar Asistencia</button>
          </div>

          <hr style={{ margin: '14px 0', borderColor: '#2d3a45' }} />

          <h3 style={{ margin: '0 0 8px' }}>Validar Crono</h3>
          <input placeholder="Replica ID" value={replicaId} onChange={(e) => setReplicaId(e.target.value)} />
          <input placeholder="FPS" value={fps} onChange={(e) => setFps(e.target.value)} />
          <input placeholder="Joules" value={joules} onChange={(e) => setJoules(e.target.value)} />
          <input placeholder="BB Weight (g)" value={bbWeightG} onChange={(e) => setBbWeightG(e.target.value)} />
          <input placeholder="Nota" value={chronoNote} onChange={(e) => setChronoNote(e.target.value)} />
          <div style={{ marginTop: 8 }}>
            <button disabled={!canSubmit || !replicaId || !fps || !joules || !bbWeightG} onClick={handleChrono}>Guardar Crono</button>
          </div>

          <hr style={{ margin: '14px 0', borderColor: '#2d3a45' }} />

          <h3 style={{ margin: '0 0 8px' }}>Reporte Fair Play</h3>
          <select value={fairPlayStatus} onChange={(e) => setFairPlayStatus(e.target.value as FairPlayStatus)}>
            <option value="green">Verde</option>
            <option value="yellow">Amarillo</option>
            <option value="red">Rojo</option>
          </select>
          <input placeholder="Motivo" value={fairPlayReason} onChange={(e) => setFairPlayReason(e.target.value)} />
          <div style={{ marginTop: 8 }}>
            <button disabled={!canSubmit} onClick={handleFairPlay}>Emitir Reporte</button>
          </div>
        </div>
      )}
    </section>
  );
}

export default OrganizerScannerView;
