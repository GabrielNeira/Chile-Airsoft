import { useEffect, useMemo, useRef, useState } from 'react';
import './organizer-scanner.css';

type BarcodeLike = {
  rawValue?: string;
};

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => {
  detect: (source: ImageBitmapSource) => Promise<BarcodeLike[]>;
};

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorCtor;
  }
}

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
  type ScanTone = 'idle' | 'working' | 'ok' | 'error';

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scanLoopRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<InstanceType<BarcodeDetectorCtor> | null>(null);
  const lastScannedRef = useRef<{ value: string; ts: number } | null>(null);
  const cameraActiveRef = useRef(false);

  const [rawQr, setRawQr] = useState('');
  const [target, setTarget] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('Esperando escaneo');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanTone, setScanTone] = useState<ScanTone>('idle');

  const [replicaId, setReplicaId] = useState('');
  const [fps, setFps] = useState('');
  const [joules, setJoules] = useState('');
  const [bbWeightG, setBbWeightG] = useState('0.20');
  const [chronoNote, setChronoNote] = useState('');

  const [fairPlayStatus, setFairPlayStatus] = useState<FairPlayStatus>('green');
  const [fairPlayReason, setFairPlayReason] = useState('');

  const canSubmit = useMemo(() => Boolean(target?.operatorUserId), [target]);

  useEffect(() => {
    void startCamera();

    return () => {
      stopCamera();
    };
  }, []);

  async function startCamera() {
    if (cameraActive) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Este navegador no soporta acceso a camara.');
      return;
    }

    setCameraError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      if ('BarcodeDetector' in window) {
        detectorRef.current = new (window.BarcodeDetector as BarcodeDetectorCtor)({ formats: ['qr_code'] });
      } else {
        setCameraError('Escaneo nativo QR no disponible en este navegador. Usa ingreso manual.');
      }

      cameraActiveRef.current = true;
      setCameraActive(true);
      loopScan();
    } catch (error) {
      setCameraError(`No se pudo abrir la camara: ${(error as Error).message}`);
      cameraActiveRef.current = false;
      setCameraActive(false);
    }
  }

  function stopCamera() {
    if (scanLoopRef.current) {
      window.cancelAnimationFrame(scanLoopRef.current);
      scanLoopRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    detectorRef.current = null;
    cameraActiveRef.current = false;
    setCameraActive(false);
  }

  function loopScan() {
    const scanTick = async () => {
      const video = videoRef.current;
      const detector = detectorRef.current;

      if (!video || !cameraActiveRef.current || !detector) {
        scanLoopRef.current = window.requestAnimationFrame(scanTick);
        return;
      }

      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        try {
          const results = await detector.detect(video);
          const value = results[0]?.rawValue?.trim();

          if (value) {
            const now = Date.now();
            const last = lastScannedRef.current;
            if (!last || last.value !== value || now - last.ts > 1300) {
              lastScannedRef.current = { value, ts: now };
              await resolveScannedValue(value);
            }
          }
        } catch {
          // Detector can fail intermittently depending on light/focus; keep scanning.
        }
      }

      scanLoopRef.current = window.requestAnimationFrame(scanTick);
    };

    scanLoopRef.current = window.requestAnimationFrame(scanTick);
  }

  async function resolveScannedValue(value: string) {
    setRawQr(value);
    setScanTone('working');

    try {
      setLoading(true);
      const profile = await onResolveQr(value);
      setTarget(profile);
      setStatus(`AirsoftID valido: ${profile.nickname}`);
      setScanTone('ok');
      if (navigator.vibrate) {
        navigator.vibrate(80);
      }
    } catch (error) {
      setTarget(null);
      setStatus(`AirsoftID no registrado: ${(error as Error).message}`);
      setScanTone('error');
      if (navigator.vibrate) {
        navigator.vibrate([120, 40, 120]);
      }
    } finally {
      setLoading(false);
      window.setTimeout(() => {
        setScanTone((prev) => (prev === 'working' ? 'idle' : prev));
      }, 400);
    }
  }

  async function handleScanResolve() {
    try {
      setLoading(true);
      setScanTone('working');
      const profile = await onResolveQr(rawQr.trim());
      setTarget(profile);
      setStatus(`AirsoftID valido: ${profile.nickname}`);
      setScanTone('ok');
    } catch (error) {
      setStatus(`AirsoftID no registrado: ${(error as Error).message}`);
      setScanTone('error');
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
    <section className="org-scanner-shell">
      <h2 className="org-scanner-title">Validador In-Game</h2>
      <p className="org-scanner-subtitle">Escaneo rapido con camara del telefono + validacion AirsoftID.</p>

      <div className="org-scanner-camera-card">
        <div className={`org-scanner-camera-wrap tone-${scanTone}`}>
          <video ref={videoRef} className="org-scanner-video" playsInline muted autoPlay />
          <div className="org-scanner-reticle" aria-hidden="true" />
          <p className="org-scanner-camera-label">{cameraActive ? 'Camara activa' : 'Camara detenida'}</p>
        </div>

        <div className="org-scanner-camera-actions">
          <button type="button" onClick={() => void startCamera()} disabled={cameraActive}>Abrir camara</button>
          <button type="button" onClick={stopCamera} disabled={!cameraActive}>Detener camara</button>
        </div>

        {cameraError ? <p className="org-scanner-error">{cameraError}</p> : null}
      </div>

      <div className="org-scanner-manual-card">
        <label htmlFor="rawQr">QR Capturado</label>
        <input
          id="rawQr"
          type="text"
          placeholder="pega valor de QR o token"
          value={rawQr}
          onChange={(e) => setRawQr(e.target.value)}
          className="org-scanner-input"
        />
        <button disabled={loading || !rawQr.trim()} onClick={handleScanResolve}>Resolver QR</button>
      </div>

      <p className={`org-scanner-status tone-${scanTone}`}>{status}</p>

      {target && (
        <div className="org-scanner-target-card">
          <p className="org-target-name">{target.nickname}</p>
          <p className="org-target-meta">{target.role} | Sangre {target.bloodGroup}</p>
          <p className="org-target-meta">{target.team || 'Sin team'}</p>

          <div className="org-target-actions">
            <button disabled={!canSubmit} onClick={handleCheckin}>Marcar Asistencia</button>
          </div>

          <hr />

          <h3>Validar Crono</h3>
          <input className="org-scanner-input" placeholder="Replica ID" value={replicaId} onChange={(e) => setReplicaId(e.target.value)} />
          <input className="org-scanner-input" placeholder="FPS" value={fps} onChange={(e) => setFps(e.target.value)} />
          <input className="org-scanner-input" placeholder="Joules" value={joules} onChange={(e) => setJoules(e.target.value)} />
          <input className="org-scanner-input" placeholder="BB Weight (g)" value={bbWeightG} onChange={(e) => setBbWeightG(e.target.value)} />
          <input className="org-scanner-input" placeholder="Nota" value={chronoNote} onChange={(e) => setChronoNote(e.target.value)} />
          <div className="org-target-actions">
            <button disabled={!canSubmit || !replicaId || !fps || !joules || !bbWeightG} onClick={handleChrono}>Guardar Crono</button>
          </div>

          <hr />

          <h3>Reporte Fair Play</h3>
          <select className="org-scanner-input" value={fairPlayStatus} onChange={(e) => setFairPlayStatus(e.target.value as FairPlayStatus)}>
            <option value="green">Verde</option>
            <option value="yellow">Amarillo</option>
            <option value="red">Rojo</option>
          </select>
          <input className="org-scanner-input" placeholder="Motivo" value={fairPlayReason} onChange={(e) => setFairPlayReason(e.target.value)} />
          <div className="org-target-actions">
            <button disabled={!canSubmit} onClick={handleFairPlay}>Emitir Reporte</button>
          </div>
        </div>
      )}
    </section>
  );
}

export default OrganizerScannerView;
