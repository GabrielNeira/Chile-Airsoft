import { useMemo, useState } from 'react';
import './operator-career-hub.css';

type HubTab = 'missions' | 'idlab' | 'store' | 'achievements';

type MissionStatus = 'active' | 'completed' | 'locked';

interface MissionItem {
  id: string;
  title: string;
  description: string;
  progress: number;
  target: number;
  rewards: string;
  status: MissionStatus;
}

interface StoreItem {
  id: string;
  name: string;
  rarity: string;
  price: string;
  owned?: boolean;
}

interface AchievementItem {
  id: string;
  title: string;
  unlocked: boolean;
  progressLabel: string;
}

interface OperatorCareerHubProps {
  xpTotal: number;
  level: number;
  softTokens: number;
  premiumTokens: number;
  missions: MissionItem[];
  storeItems: StoreItem[];
  achievements: AchievementItem[];
  equippedSkin: string;
  equippedAnimation: string;
  onEquipSkin?: (skinName: string) => void;
  onEquipAnimation?: (animationName: string) => void;
}

const tabs: Array<{ id: HubTab; label: string }> = [
  { id: 'missions', label: 'Misiones' },
  { id: 'idlab', label: 'ID Lab' },
  { id: 'store', label: 'Tienda' },
  { id: 'achievements', label: 'Logros' }
];

export default function OperatorCareerHub(props: OperatorCareerHubProps) {
  const {
    xpTotal,
    level,
    softTokens,
    premiumTokens,
    missions,
    storeItems,
    achievements,
    equippedSkin,
    equippedAnimation,
    onEquipSkin,
    onEquipAnimation
  } = props;

  const [activeTab, setActiveTab] = useState<HubTab>('missions');
  const [skinInput, setSkinInput] = useState(equippedSkin);
  const [animationInput, setAnimationInput] = useState(equippedAnimation);

  const nextLevelXp = useMemo(() => level * 1000, [level]);
  const prevLevelXp = useMemo(() => (level - 1) * 1000, [level]);
  const levelProgress = useMemo(() => {
    const range = Math.max(1, nextLevelXp - prevLevelXp);
    return Math.min(100, Math.max(0, ((xpTotal - prevLevelXp) / range) * 100));
  }, [nextLevelXp, prevLevelXp, xpTotal]);

  return (
    <section className="career-shell" aria-label="Gestion de carrera del operador">
      <header className="career-header">
        <div>
          <p className="career-eyebrow">PROGRESION OPERADOR</p>
          <h2 className="career-title">Centro de Carrera</h2>
          <p className="career-subtitle">Gestiona misiones, personaliza tu ID y administra tu inventario.</p>
        </div>

        <div className="career-balance">
          <p className="career-balance-item">Nivel {level}</p>
          <p className="career-balance-item">XP {xpTotal.toLocaleString('es-CL')}</p>
          <p className="career-balance-item">Soft {softTokens.toLocaleString('es-CL')}</p>
          <p className="career-balance-item">Premium {premiumTokens.toLocaleString('es-CL')}</p>
        </div>
      </header>

      <div className="career-progress-track" aria-label="Progreso de nivel">
        <span style={{ width: `${levelProgress}%` }} />
      </div>

      <nav className="career-tabs" aria-label="Secciones de gestion">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`career-tab ${activeTab === tab.id ? 'is-active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'missions' && (
        <div className="career-panel">
          {missions.map((mission) => {
            const missionProgress = Math.min(100, Math.round((mission.progress / mission.target) * 100));
            return (
              <article key={mission.id} className="career-card">
                <header className="career-card-head">
                  <h3>{mission.title}</h3>
                  <span className={`career-pill is-${mission.status}`}>{mission.status}</span>
                </header>
                <p className="career-card-desc">{mission.description}</p>
                <p className="career-card-meta">
                  {mission.progress}/{mission.target} | Recompensa {mission.rewards}
                </p>
                <div className="career-inline-track">
                  <span style={{ width: `${missionProgress}%` }} />
                </div>
              </article>
            );
          })}
        </div>
      )}

      {activeTab === 'idlab' && (
        <div className="career-panel">
          <article className="career-card">
            <h3>Editor de ID</h3>
            <p className="career-card-desc">Personaliza skin y animacion activa con vista de progreso competitiva.</p>
            <label className="career-field">
              Skin equipada
              <input value={skinInput} onChange={(e) => setSkinInput(e.target.value)} placeholder="Ej: Woodland Ghost" />
            </label>
            <label className="career-field">
              Animacion equipada
              <input
                value={animationInput}
                onChange={(e) => setAnimationInput(e.target.value)}
                placeholder="Ej: Pulse Neon"
              />
            </label>
            <div className="career-actions">
              <button type="button" onClick={() => onEquipSkin?.(skinInput)}>
                Guardar skin
              </button>
              <button type="button" onClick={() => onEquipAnimation?.(animationInput)}>
                Guardar animacion
              </button>
            </div>
          </article>
        </div>
      )}

      {activeTab === 'store' && (
        <div className="career-panel grid-two">
          {storeItems.map((item) => (
            <article key={item.id} className="career-card">
              <header className="career-card-head">
                <h3>{item.name}</h3>
                <span className="career-pill">{item.rarity}</span>
              </header>
              <p className="career-card-meta">Precio: {item.price}</p>
              <button type="button" disabled={item.owned}>
                {item.owned ? 'Comprado' : 'Comprar'}
              </button>
            </article>
          ))}
        </div>
      )}

      {activeTab === 'achievements' && (
        <div className="career-panel grid-two">
          {achievements.map((achievement) => (
            <article key={achievement.id} className="career-card">
              <header className="career-card-head">
                <h3>{achievement.title}</h3>
                <span className={`career-pill ${achievement.unlocked ? 'is-completed' : 'is-locked'}`}>
                  {achievement.unlocked ? 'Desbloqueado' : 'En progreso'}
                </span>
              </header>
              <p className="career-card-meta">{achievement.progressLabel}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
