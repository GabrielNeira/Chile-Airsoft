import { useEffect, useMemo, useRef, useState } from 'react';
import './operator-credential.css';

type Skin = 'multicam' | 'golden' | 'kittens';

export interface OperatorCredentialData {
  nickname: string;
  realName: string;
  bloodGroup: string;
  role: string;
  team?: string;
  operatorScore?: number | string | null;
  avatarUrl: string;
  teamLogoUrl?: string;
  qrImageUrl: string;
  iceName: string;
  icePhone: string;
  iceName2?: string;
  icePhone2?: string;
  allergies?: string;
  credentialId: string;
  medals?: string[];
  fairPlayScore?: number;
  totalFairPlayGreen?: number;
  totalFairPlayYellow?: number;
  totalFairPlayRed?: number;
  confirmedEvents?: number;
  achievementsUnlocked?: number;
}

interface OperatorCredentialCardProps {
  data: OperatorCredentialData;
  defaultSkin?: Skin;
}

const skinLabel: Record<Skin, string> = {
  multicam: 'Camo Militar',
  golden: 'Golden Card',
  kittens: 'Gatitos Pastel'
};

const skinOrder: Skin[] = ['golden', 'kittens', 'multicam'];

function getRoleDisplay(role: string): { label: string; short: string } {
  const normalized = (role || '').trim().toLowerCase();
  const known: Record<string, { label: string; short: string }> = {
    assault: { label: 'Assault', short: 'AS' },
    sniper: { label: 'Sniper', short: 'SN' },
    medic: { label: 'Medic', short: 'MD' },
    support: { label: 'Support', short: 'SP' },
    dmr: { label: 'DMR', short: 'DM' },
    breacher: { label: 'Breacher', short: 'BR' },
    recon: { label: 'Recon', short: 'RC' },
    commander: { label: 'Commander', short: 'CM' },
    other: { label: 'Operador', short: 'OP' }
  };

  return known[normalized] ?? { label: role || 'Operador', short: 'OP' };
}

export function OperatorCredentialCard({ data, defaultSkin = 'multicam' }: OperatorCredentialCardProps) {
  const [skin, setSkin] = useState<Skin>(defaultSkin);
  const [isFlipped, setIsFlipped] = useState(false);
  const [avatarSrc, setAvatarSrc] = useState(data.avatarUrl);
  const [avatarFallbackTried, setAvatarFallbackTried] = useState(false);
  const [teamLogoVisible, setTeamLogoVisible] = useState(Boolean(data.teamLogoUrl));
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    setAvatarSrc(data.avatarUrl);
    setAvatarFallbackTried(false);
  }, [data.avatarUrl]);

  useEffect(() => {
    setTeamLogoVisible(Boolean(data.teamLogoUrl));
  }, [data.teamLogoUrl]);

  const statusColorClass = useMemo(() => {
    if (data.bloodGroup.startsWith('O')) {
      return 'oc-tag-danger';
    }
    if (data.bloodGroup.startsWith('AB')) {
      return 'oc-tag-warn';
    }
    return 'oc-tag-safe';
  }, [data.bloodGroup]);



  const roleDisplay = useMemo(() => getRoleDisplay(data.role), [data.role]);
  const isLongTeamName = (data.team?.trim().length ?? 0) > 30;

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
            <section className={`oc-face oc-face-front ${isLongTeamName ? 'oc-front-long-team' : ''}`} aria-hidden={isFlipped}>
              <img src="/logo.svg" alt="" aria-hidden="true" className="oc-brand-mark oc-brand-mark-front" />

              <div className="oc-front-layout">
                <div className="oc-front-top">
                  <div className="oc-avatar-wrap">
                    <img
                      src={avatarSrc}
                      alt={`Foto de ${data.nickname}`}
                      className="oc-avatar"
                      onError={() => {
                        if (avatarFallbackTried) {
                          return;
                        }

                        setAvatarFallbackTried(true);
                        setAvatarSrc(
                          `https://api.dicebear.com/9.x/adventurer/png?seed=${encodeURIComponent(data.nickname)}`
                        );
                      }}
                    />
                  </div>
                  <div className="oc-user-core-info">
                    <p className="oc-nickname">{data.nickname}</p>
                    <p className="oc-realname">{data.realName}</p>
                    <p className={`oc-tag ${statusColorClass}`}>SANGRE {data.bloodGroup}</p>
                  </div>
                </div>

                <div className="oc-front-bottom">
                  <div className="oc-team-role-wrap">
                    {data.teamLogoUrl && teamLogoVisible ? (
                      <img
                        src={data.teamLogoUrl}
                        alt={`Logo de ${data.team || 'team'}`}
                        className="oc-team-logo"
                        onError={() => setTeamLogoVisible(false)}
                      />
                    ) : null}
                    <div className="oc-team-role-text">
                      <p className={`oc-team ${isLongTeamName ? 'is-long' : ''}`}>{data.team ? `TEAM ${data.team}` : 'SIN TEAM'}</p>
                      
                      <div className="oc-role-emblem" aria-label={`Rol ${roleDisplay.label}`}>
                        <svg viewBox="0 0 24 24" className="oc-role-emblem-icon" aria-hidden="true">
                          <path d="M12 2l7 3v6c0 5.2-3.3 9.8-7 11-3.7-1.2-7-5.8-7-11V5z" fill="currentColor" />
                        </svg>
                        <div className="oc-role-emblem-text">
                          <span className="oc-role-emblem-short">{roleDisplay.short}</span>
                          <span className="oc-role-emblem-label">{roleDisplay.label}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="oc-qr-id-wrap">
                    <div className="oc-corner-qr-front" aria-label="QR frontal">
                      <img src={data.qrImageUrl} alt="QR frontal de operador" className="oc-corner-qr-image" />
                    </div>
                    <div className="oc-credential-id-minimal">
                      ID: {data.credentialId}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="oc-face oc-face-back" aria-hidden={!isFlipped}>
              <img src="/logo.svg" alt="" aria-hidden="true" className="oc-brand-mark oc-brand-mark-back" />



              <header className="oc-header">
                <div>
                  <p className="oc-eyebrow">CHILE AIRSOFT</p>
                  <h2 className="oc-title">Lado Tactico</h2>
                </div>
                <span className="oc-chip">BACK</span>
              </header>

              <div className="oc-operator-score-wrap">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                  <img src="/logo.png?v=2" alt="ID Airsoft Logo" style={{ width: '42px', height: '42px', objectFit: 'contain', borderRadius: '50%' }} />
                  <div>
                    <h2 style={{ margin: 0, fontFamily: "'Barlow Condensed', sans-serif", fontSize: '24px', letterSpacing: '0.04em', lineHeight: 1 }}>ID AIRSOFT</h2>
                    <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--oc-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Plataforma Oficial</p>
                  </div>
                </div>
                <div className="oc-operator-score-breakdown">
                  <span className="oc-score-pill oc-score-pill-green">
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="oc-score-icon">
                      <path d="M4 3h8l2 3h6v8l-2 3h-6l-2-3H4z" fill="currentColor" />
                    </svg>
                    Verdes {data.totalFairPlayGreen ?? 0}
                  </span>
                  <span className="oc-score-pill oc-score-pill-yellow">
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="oc-score-icon">
                      <path d="M4 3h8l2 3h6v8l-2 3h-6l-2-3H4z" fill="currentColor" />
                    </svg>
                    Amarillas {data.totalFairPlayYellow ?? 0}
                  </span>
                  <span className="oc-score-pill oc-score-pill-red">
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="oc-score-icon">
                      <path d="M4 3h8l2 3h6v8l-2 3h-6l-2-3H4z" fill="currentColor" />
                    </svg>
                    Rojas {data.totalFairPlayRed ?? 0}
                  </span>
                  <span className="oc-score-pill oc-score-pill-fairplay">
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="oc-score-icon">
                      <path d="M12 2l2.7 5.5L21 8.4l-4.5 4.4 1 6.2L12 16.2 6.5 19l1-6.2L3 8.4l6.3-.9z" fill="currentColor" />
                    </svg>
                    Fair Play {data.fairPlayScore ?? 0}
                  </span>
                  <span className="oc-score-pill oc-score-pill-events">
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="oc-score-icon">
                      <path d="M7 2h2v2h6V2h2v2h3v18H4V4h3zm11 6H6v12h12z" fill="currentColor" />
                    </svg>
                    Eventos {data.confirmedEvents ?? 0}
                  </span>
                  <span className="oc-score-pill oc-score-pill-achievements">
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="oc-score-icon">
                      <path d="M12 3l3 6 6 .9-4.3 4.2 1 6-5.7-3-5.7 3 1-6L3 9.9 9 9z" fill="currentColor" />
                    </svg>
                    Logros {data.achievementsUnlocked ?? 0}
                  </span>
                </div>
              </div>

              <div className="oc-back-grid">
                <div className="oc-critical-card oc-ice-card">
                  <p className="oc-critical-label">CONTACTOS DE EMERGENCIA (ICE)</p>

                  <div className="oc-ice-item">
                    <p className="oc-ice-title">Contacto 1</p>
                    <p className="oc-ice-name">{data.iceName || 'Sin dato'}</p>
                    <p className="oc-ice-phone">Tel: {data.icePhone || 'Sin dato'}</p>
                  </div>

                  {(data.iceName2 || data.icePhone2) ? (
                    <div className="oc-ice-item">
                      <p className="oc-ice-title">Contacto 2</p>
                      <p className="oc-ice-name">{data.iceName2 || 'Sin dato'}</p>
                      <p className="oc-ice-phone">Tel: {data.icePhone2 || 'Sin dato'}</p>
                    </div>
                  ) : null}

                  <div className="oc-ice-meta">
                    <span className="oc-ice-chip">Sangre {data.bloodGroup}</span>
                    <span className="oc-ice-chip">
                      Alergias: {data.allergies && data.allergies.trim().length > 0 ? data.allergies : 'Ninguna reportada'}
                    </span>
                  </div>
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
