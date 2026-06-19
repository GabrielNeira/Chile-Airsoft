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
type TeamSlot = 'alpha' | 'bravo' | 'reserve';

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
  onAssignTeam?: (payload: { eventId: string; operatorUserId: string; teamSlot: TeamSlot }) => Promise<void>;
}

const TEAM_LABEL: Record<TeamSlot, string> = {
  alpha: 'Team Alpha',
  bravo: 'Team Bravo',
  reserve: 'Reserva'
};

export function OrganizerScannerView({
  eventId,
  onResolveQr,
  onCheckin,
  onAssignTeam
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
  const [status, setStatus] = useState('Camara apagada. Activa la camara para escanear.');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanTone, setScanTone] = useState<ScanTone>('idle');

  // Check-in & team assignment state
  const [checkinDone, setCheckinDone] = useState(false);
  const [assignedTeam, setAssignedTeam] = useState<TeamSlot | null>(null);
  const [selectedTeamSlot, setSelectedTeamSlot] = useState<TeamSlot>('alpha');
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignStatus, setAssignStatus] = useState<string | null>(null);

  const canSubmit = useMemo(() => Boolean(target?.operatorUserId), [target]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Reset per-player state whenever a new target is resolved
  function resetPlayerState() {
    setCheckinDone(false);
    setAssignedTeam(null);
    setSelectedTeamSlot('alpha');
    setAssignStatus(null);
  }

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
      setStatus('Camara activa. Apunta al QR para validar AirsoftID.');
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
    setScanTone('idle');
    setStatus('Camara apagada. Activa la camara para escanear.');
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
    resetPlayerState();

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
    resetPlayerState();
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
    setCheckinDone(true);
    setStatus(`Asistencia confirmada: ${target.nickname}. Asigna equipo.`);
  }

  async function handleAssignTeam() {
    if (!target || !onAssignTeam) return;
    setAssignLoading(true);
    setAssignStatus(null);
    try {
      // Si todavia no se hizo check-in, lo hacemos automaticamente
      // para que el jugador aparezca en el roster de FieldOperationsConsole.
      if (!checkinDone) {
        await onCheckin({ eventId, operatorUserId: target.operatorUserId });
        setCheckinDone(true);
      }
      await onAssignTeam({ eventId, operatorUserId: target.operatorUserId, teamSlot: selectedTeamSlot });
      setAssignedTeam(selectedTeamSlot);
      setAssignStatus(`${target.nickname} presente y asignado a ${TEAM_LABEL[selectedTeamSlot]}.`);
      setStatus(`Listo: ${target.nickname} → ${TEAM_LABEL[selectedTeamSlot]}`);
    } catch (error) {
      setAssignStatus(`Error al asignar: ${(error as Error).message}`);
    } finally {
      setAssignLoading(false);
    }
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

          {/* Asistencia */}
          <div className="org-target-actions">
            <button
              disabled={!canSubmit || checkinDone}
              onClick={handleCheckin}
            >
              {checkinDone ? '✓ Asistencia Confirmada' : 'Marcar Asistencia'}
            </button>
          </div>

          {/* Asignacion de equipo — siempre visible tras resolver el jugador */}
          {onAssignTeam && (
            <div className="org-scanner-team-assign">
              <h3 className="org-scanner-team-assign-title">Asignar Equipo</h3>
              <div className="org-scanner-team-slots">
                {(['alpha', 'bravo', 'reserve'] as TeamSlot[]).map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    className={`org-scanner-team-btn org-scanner-team-btn--${slot}${selectedTeamSlot === slot ? ' is-selected' : ''}${assignedTeam === slot ? ' is-assigned' : ''}`}
                    onClick={() => setSelectedTeamSlot(slot)}
                    aria-pressed={selectedTeamSlot === slot}
                  >
                    {TEAM_LABEL[slot]}
                    {assignedTeam === slot ? ' \u2713' : ''}
                  </button>
                ))}
              </div>
              <button
                className="org-scanner-team-confirm"
                disabled={assignLoading || !canSubmit}
                onClick={handleAssignTeam}
              >
                {assignLoading
                  ? 'Procesando…'
                  : checkinDone
                    ? `Confirmar → ${TEAM_LABEL[selectedTeamSlot]}`
                    : `Marcar presente + ${TEAM_LABEL[selectedTeamSlot]}`}
              </button>
              {assignStatus && (
                <p className={`org-scanner-assign-status${assignedTeam ? ' is-ok' : ' is-error'}`}>
                  {assignStatus}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default OrganizerScannerView;
