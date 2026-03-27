import { useMemo, useRef, useState } from 'react';
import './operator-credential.css';

type Skin = 'multicam' | 'woodland' | 'black';

export interface OperatorCredentialData {
  nickname: string;
  realName: string;
  bloodGroup: string;
  role: string;
  team?: string;
  avatarUrl: string;
  qrImageUrl: string;
  iceName: string;
  icePhone: string;
  credentialId: string;
  medals?: string[];
  fairPlayScore?: number;
  confirmedEvents?: number;
  achievementsUnlocked?: number;
}

interface OperatorCredentialCardProps {
  data: OperatorCredentialData;
  defaultSkin?: Skin;
}

const skinLabel: Record<Skin, string> = {
  multicam: 'Multicam',
  woodland: 'Woodland',
  black: 'Black Ops'
};

const skinOrder: Skin[] = ['multicam', 'woodland', 'black'];

export function OperatorCredentialCard({ data, defaultSkin = 'multicam' }: OperatorCredentialCardProps) {
  const [skin, setSkin] = useState<Skin>(defaultSkin);
  const [isFlipped, setIsFlipped] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const statusColorClass = useMemo(() => {
    if (data.bloodGroup.startsWith('O')) {
      return 'oc-tag-danger';
    }
    if (data.bloodGroup.startsWith('AB')) {
      return 'oc-tag-warn';
    }
    return 'oc-tag-safe';
  }, [data.bloodGroup]);

  const operatorScore = useMemo(() => {
    const fairPlay = Math.max(0, Math.min(100, data.fairPlayScore ?? 75));
    const eventsScore = Math.max(0, Math.min(100, (data.confirmedEvents ?? 0) * 4));
    const achievementScore = Math.max(0, Math.min(100, (data.achievementsUnlocked ?? 0) * 8));
    const weighted = fairPlay * 0.5 + eventsScore * 0.3 + achievementScore * 0.2;
    return Math.round(Math.max(1, Math.min(100, weighted)));
  }, [data.achievementsUnlocked, data.confirmedEvents, data.fairPlayScore]);

  const handleTouchStart = (event: React.TouchEvent<HTMLElement>) => {
    touchStartX.current = event.changedTouches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLElement>) => {
    if (touchStartX.current == null) {
      return;
    }

    const endX = event.changedTouches[0]?.clientX ?? touchStartX.current;
    const deltaX = endX - touchStartX.current;
    const threshold = 42;

    if (Math.abs(deltaX) >= threshold) {
      setIsFlipped((prev) => !prev);
    }

    touchStartX.current = null;
  };

  return (
    <section className="oc-shell" aria-label="Credencial de Operador">
      <div className="oc-flip-wrap">
        <article
          className={`oc-card oc-skin-${skin} ${isFlipped ? 'is-flipped' : ''}`}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div className="oc-card-inner">
            <section className="oc-face oc-face-front" aria-hidden={isFlipped}>
              <header className="oc-header">
                <div>
                  <p className="oc-eyebrow">CHILE AIRSOFT</p>
                  <h2 className="oc-title">Credencial de Operador</h2>
                </div>
                <span className="oc-chip">CO</span>
              </header>

              <div className="oc-body">
                <div className="oc-avatar-wrap">
                  <img src={data.avatarUrl} alt={`Foto de ${data.nickname}`} className="oc-avatar" />
                  <span className="oc-role">{data.role}</span>
                </div>

                <div className="oc-info">
                  <p className="oc-nickname">{data.nickname}</p>
                  <p className="oc-realname">{data.realName}</p>
                  <p className="oc-team">{data.team ? `TEAM ${data.team}` : 'SIN TEAM'}</p>
                  <p className={`oc-tag ${statusColorClass}`}>SANGRE {data.bloodGroup}</p>
                </div>
              </div>

              <div className="oc-critical-grid">
                <div className="oc-critical-card">
                  <p className="oc-critical-label">ID OPERADOR</p>
                  <p className="oc-critical-value">{data.credentialId}</p>
                  <p className="oc-critical-sub">Validacion por QR</p>
                </div>

                <div className="oc-critical-card">
                  <p className="oc-critical-label">TEAM</p>
                  <p className="oc-critical-value">{data.team || 'Sin team'}</p>
                  <p className="oc-critical-sub">Rol {data.role}</p>
                </div>
              </div>

              <footer className="oc-footer oc-footer-front">
                <div>
                  <p className="oc-footer-title">Frente de Identificacion</p>
                  <p className="oc-footer-sub">El QR solo esta en el reverso. Voltea para validar.</p>
                </div>
              </footer>
            </section>

            <section className="oc-face oc-face-back" aria-hidden={!isFlipped}>
              <header className="oc-header">
                <div>
                  <p className="oc-eyebrow">CHILE AIRSOFT</p>
                  <h2 className="oc-title">Lado Tactico</h2>
                </div>
                <span className="oc-chip">BACK</span>
              </header>

              <div className="oc-operator-score-wrap">
                <p className="oc-critical-label">METRICA OPERADOR</p>
                <div className="oc-operator-score-main">
                  <span className="oc-operator-score-value">{operatorScore}</span>
                  <span className="oc-operator-score-max">/100</span>
                </div>
                <div className="oc-operator-score-breakdown">
                  <span>Fair Play {data.fairPlayScore ?? 75}</span>
                  <span>Eventos {data.confirmedEvents ?? 0}</span>
                  <span>Logros {data.achievementsUnlocked ?? 0}</span>
                </div>
              </div>

              <div className="oc-back-grid">
                <div className="oc-critical-card">
                  <p className="oc-critical-label">ICE</p>
                  <p className="oc-critical-value">{data.iceName}</p>
                  <p className="oc-critical-sub">{data.icePhone}</p>
                  <p className="oc-critical-sub">Sangre {data.bloodGroup}</p>
                </div>

                <div className="oc-back-qr-wrap">
                  <img src={data.qrImageUrl} alt="QR de operador" className="oc-back-qr" />
                  <p className="oc-footer-title">QR de Validacion</p>
                  <p className="oc-critical-sub">CO {data.credentialId}</p>
                </div>
              </div>

              <div className="oc-medals">
                <p className="oc-critical-label">MEDALLAS</p>
                <div className="oc-medals-list">
                  {(data.medals && data.medals.length > 0 ? data.medals : ['Sin medallas']).map((medal) => (
                    <span key={medal} className="oc-medal-pill">
                      {medal}
                    </span>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </article>

        <button
          type="button"
          className="oc-flip-btn"
          onClick={() => setIsFlipped((prev) => !prev)}
          aria-label={isFlipped ? 'Mostrar frente de la credencial' : 'Mostrar reverso de la credencial'}
        >
          {isFlipped ? 'Ver Frente' : 'Voltear ID'}
        </button>
        <p className="oc-flip-hint">Tip: desliza horizontalmente la tarjeta para voltearla.</p>
      </div>

      <div className="oc-skins" role="group" aria-label="Selector de skin">
        {skinOrder.map((item) => (
          <button
            key={item}
            type="button"
            className={`oc-skin-btn ${skin === item ? 'is-active' : ''}`}
            onClick={() => setSkin(item)}
            aria-pressed={skin === item}
          >
            {skinLabel[item]}
          </button>
        ))}
      </div>
    </section>
  );
}

export default OperatorCredentialCard;
