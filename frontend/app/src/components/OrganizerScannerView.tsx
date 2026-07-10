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

function playRetroSound(toneName: string) {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    if (toneName === 'coin') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(987.77, now);
      osc.frequency.setValueAtTime(1318.51, now + 0.08);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.35);
    } else if (toneName === 'level_up') {
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + index * 0.07);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.1, now + index * 0.07 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.07 + 0.22);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + index * 0.07);
        osc.stop(now + index * 0.07 + 0.22);
      });
    } else if (toneName === 'laser') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(1200, now);
      osc.frequency.exponentialRampToValueAtTime(180, now + 0.22);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.22);
    } else if (toneName === 'error') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.setValueAtTime(150, now + 0.07);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.25);
    } else {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.12);
    }
  } catch (e) {
    console.warn('AudioContext failed:', e);
  }
}

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
  const [showManualInput, setShowManualInput] = useState(false);
  const [target, setTarget] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('Escáner listo');
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

      let soundCode = 'classic';
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object' && parsed.sound) {
          soundCode = parsed.sound;
        }
      } catch {}

      playRetroSound(soundCode);

      if (navigator.vibrate) {
        navigator.vibrate(80);
      }
    } catch (error) {
      setTarget(null);
      setStatus(`AirsoftID no registrado: ${(error as Error).message}`);
      setScanTone('error');
      playRetroSound('error');
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

      let soundCode = 'classic';
      try {
        const parsed = JSON.parse(rawQr.trim());
        if (parsed && typeof parsed === 'object' && parsed.sound) {
          soundCode = parsed.sound;
        }
      } catch {}

      playRetroSound(soundCode);
    } catch (error) {
      setStatus(`AirsoftID no registrado: ${(error as Error).message}`);
      setScanTone('error');
      playRetroSound('error');
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
      <div className="org-scanner-camera-card">
        <div className={`org-scanner-camera-wrap tone-${scanTone}`} style={{ display: cameraActive ? 'flex' : 'none' }}>
          <video ref={videoRef} className="org-scanner-video" playsInline muted autoPlay />
          <div className="org-scanner-reticle">
            <div className="reticle-corner top-left"></div>
            <div className="reticle-corner top-right"></div>
            <div className="reticle-corner bottom-left"></div>
            <div className="reticle-corner bottom-right"></div>
          </div>
          <button className="org-scanner-stop-btn" onClick={stopCamera}>
            ✕ Detener Lente
          </button>
        </div>

        <div className="org-scanner-camera-idle" style={{ display: !cameraActive ? 'flex' : 'none' }}>
          <div className="idle-icon-wrap">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 8V6a2 2 0 0 1 2-2h2M21 8V6a2 2 0 0 0-2-2h-2M3 16v2a2 2 0 0 0 2 2h2M21 16v2a2 2 0 0 1-2 2h-2"/>
              <path d="M8 12h8M12 8v8"/>
            </svg>
          </div>
          <p>Escaneo rápido de credencial AirsoftID.</p>
          <button className="org-scanner-start-btn" onClick={() => void startCamera()}>
            Activar Lente
          </button>
        </div>

        {cameraError ? <p className="org-scanner-error">{cameraError}</p> : null}
      </div>

      <div className="org-scanner-controls">
        <button 
          className="org-scanner-toggle-manual" 
          onClick={() => setShowManualInput(!showManualInput)}
        >
          {showManualInput ? 'Ocultar ingreso manual' : 'Ingreso manual de código'}
        </button>

        {showManualInput && (
          <div className="org-scanner-manual-card">
            <input
              type="text"
              placeholder="Ingresa token o código"
              value={rawQr}
              onChange={(e) => setRawQr(e.target.value)}
              className="org-scanner-input"
            />
            <button disabled={loading || !rawQr.trim()} onClick={handleScanResolve} className="org-scanner-manual-submit">
              Validar
            </button>
          </div>
        )}
      </div>

      <div className={`org-scanner-status-toast tone-${scanTone} ${status !== 'Escáner listo' ? 'is-visible' : ''}`}>
        {status}
      </div>

      {target && (
        <div className="org-scanner-bottom-sheet">
          <div className="bottom-sheet-header">
            <h3 className="org-target-name">{target.nickname}</h3>
            <button className="bottom-sheet-close" onClick={() => setTarget(null)}>✕</button>
          </div>
          <p className="org-target-meta">{target.role} | Sangre {target.bloodGroup}</p>
          <p className="org-target-meta">{target.team || 'Sin team registrado'}</p>

          <div className="org-target-actions">
            <button
              className={`checkin-btn ${checkinDone ? 'done' : ''}`}
              disabled={!canSubmit || checkinDone}
              onClick={handleCheckin}
            >
              {checkinDone ? '✓ Asistencia Confirmada' : 'Marcar Asistencia Física'}
            </button>
          </div>

          {onAssignTeam && (
            <div className="org-scanner-team-assign">
              <h4 className="org-scanner-team-assign-title">Asignación Rápida de Equipo</h4>
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
                  ? 'Asignando…'
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
