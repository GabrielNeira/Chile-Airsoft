import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import { OperatorCredentialCard, OperatorCredentialData } from './OperatorCredentialCard';
import { getOperatorIdMetricsByUserId, OperatorIdMetricsRow } from '../lib/operatorMetricsApi';
import './operator-player-dashboard.css';

interface OperatorPlayerDashboardProps {
  userId: string;
  operatorData: OperatorCredentialData | null;
  equippedSkin: string;
  equippedAnimation: string;
  equippedSound: string;
  onEquipSkin: (skin: string) => Promise<void>;
  onEquipAnimation: (animation: string) => Promise<void>;
  onEquipSound: (sound: string) => Promise<void>;
}

interface ProgressionData {
  xp_total: number;
  level: number;
  rank_title: string;
  soft_tokens: number;
  premium_tokens: number;
}

interface AttendedEvent {
  checked_in_at: string;
  event: {
    id: string;
    title: string;
    event_date: string;
    field: {
      name: string;
    } | null;
  } | null;
}

interface CatalogItem {
  code: string;
  name: string;
  desc: string;
  rarity: 'común' | 'raro' | 'legendario';
  cost: number;
}

// 20 Skins in total (10 real military camos + 10 special/fantasy skins)
const SKINS_CATALOG: CatalogItem[] = [
  // Camuflajes reales
  { code: 'multicam', name: 'Multicam Classic', desc: 'Diseño militar clásico de camuflaje de transición.', rarity: 'común', cost: 0 },
  { code: 'woodland', name: 'Woodland M81', desc: 'Camuflaje forestal clásico estadounidense de cuatro colores.', rarity: 'común', cost: 0 },
  { code: 'marpat', name: 'MARPAT Digital', desc: 'Camuflaje pixelado digital de los Marines (USMC).', rarity: 'raro', cost: 0 },
  { code: 'flecktarn', name: 'Flecktarn Alemán', desc: 'Patrón de manchas característico del ejército alemán.', rarity: 'raro', cost: 0 },
  { code: 'blackmulticam', name: 'Black Multicam', desc: 'Variante oscura táctica ideal para operaciones nocturnas.', rarity: 'raro', cost: 0 },
  { code: 'tigerstripe', name: 'Tiger Stripe', desc: 'Patrón a rayas horizontales de la era de Vietnam.', rarity: 'común', cost: 0 },
  { code: 'desertdigital', name: 'Desert Digital', desc: 'Camuflaje pixelado de desierto de alta visibilidad táctica.', rarity: 'común', cost: 0 },
  { code: 'kryptek', name: 'Kryptek Typhon', desc: 'Escamas tácticas tridimensionales de sigilo urbano.', rarity: 'legendario', cost: 0 },
  { code: 'cadpat', name: 'CADPAT Digital', desc: 'Diseño digital canadiense templado de gran contraste.', rarity: 'raro', cost: 0 },
  { code: 'acu', name: 'UCP Digital (ACU)', desc: 'Camuflaje pixelado gris/verde de combate universal.', rarity: 'común', cost: 0 },
  
  // Skins Especiales / Fantasía
  { code: 'golden', name: 'Golden Elite', desc: 'Oro brillante pulido y carbón premium.', rarity: 'raro', cost: 0 },
  { code: 'kittens', name: 'Gatitos Tácticos', desc: 'Tierno estilo pastel y mininos de combate.', rarity: 'común', cost: 0 },
  { code: 'cyberpunk', name: 'Cyberpunk Neon', desc: 'Líneas neón fucsia/cyan brillantes con rejilla ciber.', rarity: 'raro', cost: 350 },
  { code: 'zombie', name: 'Infección Zombie', desc: 'Grunge verde tóxico con logotipo de biopeligro.', rarity: 'común', cost: 400 },
  { code: 'arctic', name: 'Helada Ártica', desc: 'Gris gélido con copos de nieve geométricos.', rarity: 'común', cost: 450 },
  { code: 'magma', name: 'Furia Volcánica', desc: 'Rocas de carbón agrietadas y ríos de lava ardiente.', rarity: 'raro', cost: 500 },
  { code: 'nebula', name: 'Vórtice Estelar', desc: 'Fondo espacial de nebulosa galáctica morada/azul.', rarity: 'raro', cost: 600 },
  { code: 'retro', name: 'Retro 8-Bit', desc: 'Rejilla clásica de arcade e inspiración pixel-art.', rarity: 'común', cost: 650 },
  { code: 'waifu', name: 'Anime Kawaii (Waifu)', desc: 'Flores de cerezo, bordes rosa y estilo otaku.', rarity: 'legendario', cost: 800 },
  { code: 'carbon', name: 'Carbono Táctico', desc: 'Fibra de carbono negra con marcas de peligro naranja.', rarity: 'legendario', cost: 950 }
];

const ANIMATIONS_CATALOG: CatalogItem[] = [
  { code: 'classic', name: 'Giro Clásico', desc: 'Rotación clásica en el eje Y de la tarjeta.', rarity: 'común', cost: 0 },
  { code: 'elastic', name: 'Giro Elástico', desc: 'Volteo con rebote elástico final (overshoot).', rarity: 'raro', cost: 250 },
  { code: 'slow3d', name: 'Giro Cinematográfico', desc: 'Rotación lenta e inmersiva de gran suavidad.', rarity: 'común', cost: 300 },
  { code: 'vertical', name: 'Giro Vertical', desc: 'Rotación vertical en el eje X de 180 grados.', rarity: 'raro', cost: 400 },
  { code: 'vortex', name: 'Vórtice Espacial', desc: 'Combinación de rotación Y/Z con encogimiento.', rarity: 'legendario', cost: 550 },
  { code: 'glitch', name: 'Falla Digital', desc: 'Giro cortado a pasos imitando glitches de datos.', rarity: 'raro', cost: 600 }
];

// Predefined system achievements
interface Achievement {
  code: string;
  title: string;
  description: string;
  rarity: 'común' | 'raro' | 'legendario';
  checkUnlocked: (metrics: OperatorIdMetricsRow | null, dbCodes: string[]) => { unlocked: boolean; date?: string };
}

const SYSTEM_ACHIEVEMENTS: Achievement[] = [
  {
    code: 'first_match',
    title: 'Bautismo de Fuego',
    description: 'Registra tu asistencia en tu primera partida oficial.',
    rarity: 'común',
    checkUnlocked: (metrics, dbCodes) => {
      if (dbCodes.includes('first_match') || dbCodes.includes('baptism')) return { unlocked: true };
      const attended = metrics?.total_confirmed_events ?? 0;
      return { unlocked: attended > 0 };
    }
  },
  {
    code: 'fairplay_honor',
    title: 'Espíritu Deportivo',
    description: 'Mantén un puntaje de Fair Play impecable (90+).',
    rarity: 'raro',
    checkUnlocked: (metrics, dbCodes) => {
      if (dbCodes.includes('fairplay_honor')) return { unlocked: true };
      const score = metrics?.fair_play_score ?? 0;
      return { unlocked: score >= 90 };
    }
  },
  {
    code: 'veteran_5',
    title: 'Vanguardia Veterana',
    description: 'Completa exitosamente 5 eventos en canchas oficiales.',
    rarity: 'raro',
    checkUnlocked: (metrics, dbCodes) => {
      if (dbCodes.includes('veteran_5')) return { unlocked: true };
      const attended = metrics?.total_confirmed_events ?? 0;
      return { unlocked: attended >= 5 };
    }
  },
  {
    code: 'calibrated_gun',
    title: 'Calibración Precisa',
    description: 'Pasa exitosamente la validación de crono para tu réplica principal.',
    rarity: 'común',
    checkUnlocked: (metrics, dbCodes) => {
      if (dbCodes.includes('calibrated_gun') || dbCodes.includes('chrono')) return { unlocked: true };
      const hasScore = (metrics?.operator_score ?? 0) > 0;
      return { unlocked: hasScore };
    }
  },
  {
    code: 'team_operative',
    title: 'Fuerza de Tarea',
    description: 'Pertenece a un equipo activo o club registrado en la plataforma.',
    rarity: 'legendario',
    checkUnlocked: (metrics, dbCodes) => {
      if (dbCodes.includes('team_operative') || dbCodes.includes('team')) return { unlocked: true };
      const hasTeam = Boolean(metrics?.team && metrics.team.trim() !== '' && metrics.team.toLowerCase() !== 'sin equipo');
      return { unlocked: hasTeam };
    }
  }
];

export default function OperatorPlayerDashboard({
  userId,
  operatorData,
  equippedSkin,
  equippedAnimation,
  equippedSound,
  onEquipSkin,
  onEquipAnimation,
  onEquipSound
}: OperatorPlayerDashboardProps) {
  const [activeTab, setActiveTab] = useState<'inicio' | 'idlab' | 'eventos' | 'logros'>('inicio');
  const [idlabSubTab, setIdlabSubTab] = useState<'skins' | 'animations'>('skins');
  const [metrics, setMetrics] = useState<OperatorIdMetricsRow | null>(null);
  
  const [progression, setProgression] = useState<ProgressionData>({
    xp_total: 0,
    level: 1,
    rank_title: 'Recluta',
    soft_tokens: 0,
    premium_tokens: 0
  });

  const [attendedEvents, setAttendedEvents] = useState<AttendedEvent[]>([]);
  const [dbAchievementCodes, setDbAchievementCodes] = useState<string[]>([]);
  const [dbAchievementDates, setDbAchievementDates] = useState<Record<string, string>>({});
  
  // All 20 skins and 6 animations are unlocked by default so the user can play with them immediately!
  const [unlockedItems, setUnlockedItems] = useState<string[]>([
    'multicam', 'woodland', 'marpat', 'flecktarn', 'blackmulticam', 'tigerstripe', 'desertdigital', 'kryptek', 'cadpat', 'acu',
    'golden', 'kittens', 'cyberpunk', 'zombie', 'arctic', 'magma', 'nebula', 'retro', 'waifu', 'carbon',
    'classic', 'elastic', 'slow3d', 'vertical', 'vortex', 'glitch'
  ]);
  
  // Loading & Action states
  const [loading, setLoading] = useState(true);
  const [equippingCode, setEquippingCode] = useState<string | null>(null);
  const [buyingCode, setBuyingCode] = useState<string | null>(null);

  // Load Dashboard Data
  useEffect(() => {
    let active = true;
    
    async function loadDashboardData() {
      if (!supabase) return;
      setLoading(true);

      try {
        // 1. Fetch metrics
        const metricsRow = await getOperatorIdMetricsByUserId(userId);
        if (!active) return;
        if (metricsRow) {
          setMetrics(metricsRow);
        }

        // 2. Fetch progression data
        const { data: progData } = await supabase
          .from('operator_progression')
          .select('xp_total, level, rank_title, soft_tokens, premium_tokens')
          .eq('operator_user_id', userId)
          .maybeSingle();
        if (!active) return;
        if (progData) {
          setProgression(progData as ProgressionData);
        }

        // 3. Fetch attended events
        const { data: checkinData } = await supabase
          .from('event_checkins')
          .select(`
            checked_in_at,
            event:events (
              id,
              title,
              event_date,
              field:fields (
                name
              )
            )
          `)
          .eq('operator_user_id', userId)
          .order('checked_in_at', { ascending: false });

        if (!active) return;
        if (checkinData) {
          setAttendedEvents(checkinData as unknown as AttendedEvent[]);
        }

        // 4. Fetch achievements
        const { data: achData } = await supabase
          .from('operator_achievements')
          .select(`
            unlocked_at,
            achievement:achievements (
              code
            )
          `)
          .eq('operator_user_id', userId);
        
        if (!active) return;
        if (achData) {
          const codes: string[] = [];
          const dates: Record<string, string> = {};
          achData.forEach((item: any) => {
            const code = item.achievement?.code;
            if (code) {
              codes.push(code);
              dates[code] = item.unlocked_at;
            }
          });
          setDbAchievementCodes(codes);
          setDbAchievementDates(dates);
        }

        // 5. Load unlocked cosmetics list from localStorage
        const localUnlocks = localStorage.getItem(`unlocked_items_${userId}`);
        if (localUnlocks) {
          try {
            const parsed = JSON.parse(localUnlocks);
            if (Array.isArray(parsed)) {
              setUnlockedItems(prev => Array.from(new Set([...prev, ...parsed])));
            }
          } catch (e) {
            console.error('Error parsing local unlocks:', e);
          }
        }
      } catch (err) {
        console.error('Error al cargar datos del dashboard:', err);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadDashboardData();
    return () => { active = false; };
  }, [userId]);

  // Unlock/Buy item logic
  async function handleUnlockItem(item: CatalogItem) {
    if (progression.soft_tokens < item.cost) {
      alert(`Créditos Soft insuficientes. Necesitas ${item.cost} 🪙 pero tienes ${progression.soft_tokens} 🪙.`);
      return;
    }

    setBuyingCode(item.code);
    try {
      const newBalance = progression.soft_tokens - item.cost;
      
      // Attempt database update
      if (supabase) {
        const { error } = await supabase
          .from('operator_progression')
          .update({ soft_tokens: newBalance })
          .eq('operator_user_id', userId);
        if (error) throw error;
      }

      // Update state balance
      setProgression(prev => ({ ...prev, soft_tokens: newBalance }));

      // Unlock item locally
      const updated = [...unlockedItems, item.code];
      setUnlockedItems(updated);
      localStorage.setItem(`unlocked_items_${userId}`, JSON.stringify(updated));

      // Attempt to save to inventory if required, or keep it in localStorage as fail-safe
      alert(`¡Has desbloqueado "${item.name}" con éxito! 🎉`);
    } catch (err) {
      console.error('Error al desbloquear cosmético:', err);
      alert('Ocurrió un error al procesar el desbloqueo. Por favor, intenta de nuevo.');
    } finally {
      setBuyingCode(null);
    }
  }

  // Equip item logic
  async function handleEquipItem(type: 'skin' | 'animation' | 'sound', code: string) {
    setEquippingCode(code);
    try {
      if (type === 'skin') {
        await onEquipSkin(code);
      } else if (type === 'animation') {
        await onEquipAnimation(code);
      } else if (type === 'sound') {
        await onEquipSound(code);
      }
    } catch (err) {
      console.error(`Error equipping ${type}:`, err);
      alert('Error al equipar el elemento.');
    } finally {
      setEquippingCode(null);
    }
  }



  // Level progression calculations
  const nextLevelXp = progression.level * 1000;
  const prevLevelXp = (progression.level - 1) * 1000;
  const levelProgressPercent = useMemo(() => {
    const range = nextLevelXp - prevLevelXp;
    const progressInCurrentLevel = progression.xp_total - prevLevelXp;
    return Math.min(100, Math.max(0, Math.round((progressInCurrentLevel / range) * 100)));
  }, [progression.level, progression.xp_total, prevLevelXp, nextLevelXp]);

  // Winrate calculation
  const matchesPlayed = metrics?.total_matches_participated ?? 0;
  const matchesWon = metrics?.total_matches_won ?? 0;
  const winRate = matchesPlayed > 0 ? Math.round((matchesWon / matchesPlayed) * 100) : 0;

  // Field Time calculation
  const fieldTimeHours = useMemo(() => {
    const seconds = metrics?.total_field_time_seconds ?? 0;
    return Math.round(seconds / 3600);
  }, [metrics?.total_field_time_seconds]);

  // Evaluate achievements list
  const achievementsList = useMemo(() => {
    return SYSTEM_ACHIEVEMENTS.map(ach => {
      const evaluation = ach.checkUnlocked(metrics, dbAchievementCodes);
      const dbDate = dbAchievementDates[ach.code];
      return {
        ...ach,
        unlocked: evaluation.unlocked,
        unlockedDate: dbDate || evaluation.date
      };
    });
  }, [metrics, dbAchievementCodes, dbAchievementDates]);

  function formatLocalDate(dateStr: string) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  return (
    <div className="player-dashboard-shell">
      {/* ── Left Sidebar (Avatar, Level, Economy) ── */}
      <aside className="dashboard-sidebar">
        <div className="dashboard-side-card">
          <div className="dashboard-avatar-wrap">
            <img
              src={operatorData?.avatarUrl || `https://api.dicebear.com/9.x/adventurer/png?seed=${encodeURIComponent(operatorData?.nickname || 'operador')}`}
              alt="Avatar de Operador"
            />
          </div>
          <div className="dashboard-profile-info">
            <h2 className="dashboard-nickname">{operatorData?.nickname || 'Operador'}</h2>
            <p className="dashboard-realname">{operatorData?.realName || 'Sin Nombre Registrado'}</p>
          </div>

          <div className="dashboard-progression">
            <div className="progression-header">
              <h3 className="progression-level">NIVEL {progression.level}</h3>
              <span className="progression-rank">{progression.rank_title}</span>
            </div>
            <div className="progression-track" aria-label={`Progreso de nivel: ${levelProgressPercent}%`}>
              <span style={{ width: `${levelProgressPercent}%` }} />
            </div>
            <p className="progression-text">
              {progression.xp_total} / {nextLevelXp} XP
            </p>
          </div>
        </div>

        <div className="dashboard-side-card">
          <h3 style={{ margin: '0 0 14px', fontSize: '16px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9caab3' }}>
            Balance del Operador
          </h3>
          <div className="economy-grid">
            <div className="economy-card">
              <span className="economy-label">Créditos Soft</span>
              <span className="economy-value">
                <span className="icon-soft">🪙</span>
                {progression.soft_tokens.toLocaleString('es-CL')}
              </span>
            </div>
            <div className="economy-card">
              <span className="economy-label">Fichas Premium</span>
              <span className="economy-value">
                <span className="icon-premium">💎</span>
                {progression.premium_tokens.toLocaleString('es-CL')}
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main Dashboard Panel ── */}
      <main className="dashboard-main">
        {/* Navigation Tabs */}
        <div className="dashboard-nav-card">
          <nav className="dashboard-tabs" aria-label="Menu del dashboard">
            <button
              type="button"
              className={`dashboard-tab-btn ${activeTab === 'inicio' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('inicio')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="9"></rect>
                <rect x="14" y="3" width="7" height="5"></rect>
                <rect x="14" y="12" width="7" height="9"></rect>
                <rect x="3" y="16" width="7" height="5"></rect>
              </svg>
              Inicio
            </button>
            <button
              type="button"
              className={`dashboard-tab-btn ${activeTab === 'idlab' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('idlab')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"></path>
                <path d="M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"></path>
              </svg>
              ID Lab (Diseño)
            </button>
            <button
              type="button"
              className={`dashboard-tab-btn ${activeTab === 'eventos' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('eventos')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
              Eventos
            </button>
            <button
              type="button"
              className={`dashboard-tab-btn ${activeTab === 'logros' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('logros')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
              </svg>
              Logros
            </button>
          </nav>
        </div>

        {/* Dynamic Panels */}
        <div className="dashboard-panel-card">
          {loading ? (
            <div className="no-data-msg">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                <circle cx="12" cy="12" r="10" strokeDasharray="30" strokeDashoffset="10"></circle>
              </svg>
              <p>Sincronizando información del perfil táctico...</p>
            </div>
          ) : (
            <>
              {/* TAB: INICIO */}
              {activeTab === 'inicio' && (
                <section aria-labelledby="inicio-panel-title">
                  <h2 id="inicio-panel-title" className="panel-title">Resumen de Operador</h2>
                  
                  <div className="stats-grid">
                    {/* Operator Score */}
                    <article className="stat-card accent-green">
                      <header className="stat-header">
                        <span>Puntaje Operador</span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline></svg>
                      </header>
                      <p className="stat-value">{metrics?.operator_score ?? 0}</p>
                      <p className="stat-subtitle">Clasificación de habilidad general</p>
                    </article>

                    {/* Fair Play Score */}
                    <article className="stat-card accent-blue">
                      <header className="stat-header">
                        <span>Fair Play Score</span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                      </header>
                      <p className="stat-value">{metrics?.fair_play_score ?? 100}%</p>
                      <div className="fairplay-detail">
                        <span className="fairplay-pill green" title="Tarjetas verdes">🟢 {metrics?.total_fair_play_green ?? 0}</span>
                        <span className="fairplay-pill yellow" title="Tarjetas amarillas">🟡 {metrics?.total_fair_play_yellow ?? 0}</span>
                        <span className="fairplay-pill red" title="Tarjetas rojas">🔴 {metrics?.total_fair_play_red ?? 0}</span>
                      </div>
                    </article>

                    {/* Matches & Winrate */}
                    <article className="stat-card accent-gold">
                      <header className="stat-header">
                        <span>Ratio de Partidas</span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
                      </header>
                      <p className="stat-value">{winRate}%</p>
                      <div className="winrate-bar-container">
                        <div className="winrate-ratio">
                          <span>W: {matchesWon}</span>
                          <span>L: {matchesPlayed - matchesWon}</span>
                        </div>
                        <div className="winrate-bar">
                          <div className="winrate-bar-fill" style={{ width: `${winRate}%` }} />
                        </div>
                      </div>
                    </article>

                    {/* Field Time & Attendance */}
                    <article className="stat-card accent-red">
                      <header className="stat-header">
                        <span>Tiempo en Cancha</span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                      </header>
                      <p className="stat-value">{fieldTimeHours} hrs</p>
                      <p className="stat-subtitle">{metrics?.total_confirmed_events ?? 0} eventos registrados oficiales</p>
                    </article>
                  </div>

                  {/* ─── ONBOARDING BANNER (solo para nuevos usuarios) ─── */}
                  {progression.level <= 1 && (metrics?.total_confirmed_events ?? 0) === 0 && (
                    <div className="onboarding-banner">
                      <div className="onboarding-banner-header">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="onboarding-icon"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                        <h3 className="onboarding-title">¡Bienvenido a Airsoft ID! — Pasos iniciales</h3>
                      </div>
                      <ol className="onboarding-steps">
                        <li className="onboarding-step is-done">
                          <span className="step-number">1</span>
                          <div>
                            <strong>Crear cuenta y sesión</strong>
                            <p>Tu cuenta ya está activa.</p>
                          </div>
                        </li>
                        <li className={`onboarding-step ${operatorData ? 'is-done' : 'is-pending'}`}>
                          <span className="step-number">2</span>
                          <div>
                            <strong>Completar tu Airsoft ID</strong>
                            <p>Alias, grupo sanguíneo y contactos de emergencia.</p>
                          </div>
                        </li>
                        <li className="onboarding-step is-pending">
                          <span className="step-number">3</span>
                          <div>
                            <strong>Revisar datos de emergencia</strong>
                            <p>Contacto ICE, alergias y medicamentos críticos.</p>
                          </div>
                        </li>
                        <li className="onboarding-step is-pending">
                          <span className="step-number">4</span>
                          <div>
                            <strong>Buscar eventos activos</strong>
                            <p>Revisa la sección “Buscar Eventos” en el menú.</p>
                          </div>
                        </li>
                        <li className="onboarding-step is-pending">
                          <span className="step-number">5</span>
                          <div>
                            <strong>Personalizar tu credencial</strong>
                            <p>Elige un camuflaje en el tab “ID Lab (Diseño)”.</p>
                          </div>
                        </li>
                        <li className="onboarding-step is-pending">
                          <span className="step-number">6</span>
                          <div>
                            <strong>Entender Creditsoft y Premium</strong>
                            <p>Lee la guía más abajo para saber cómo ganar créditos.</p>
                          </div>
                        </li>
                      </ol>
                    </div>
                  )}

                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', marginBottom: '20px' }}>
                    <h3 style={{ margin: '0 0 8px', fontSize: '16px', color: '#fff' }}>Instrucciones de Operador</h3>
                    <p style={{ margin: 0, color: '#9caab3', fontSize: '14px', lineHeight: 1.4 }}>
                      Tu credencial almacena tu historial táctico. Al presentarte en canchas asociadas a <strong>Airsoft ID</strong>,
                      presenta el código QR en la mesa de control. El organizador validará tu asistencia, crono de réplicas,
                      y actualizará tus métricas en tiempo real. ¡El juego limpio y el trabajo en equipo construyen tu reputación!
                    </p>
                  </div>

                  {/* ─── CREDITSOFT & PREMIUM GUIDE ─── */}
                  <div className="economy-guide-card">
                    <div className="economy-guide-header">
                      <span className="economy-guide-icon">🧠</span>
                      <h3 className="economy-guide-title">¿Cómo funcionan Creditsoft y Premium?</h3>
                    </div>

                    <div className="economy-guide-cols">
                      <div className="economy-guide-col">
                        <div className="economy-guide-col-header soft">
                          <span>🪙</span>
                          <strong>Creditsoft (CS)</strong>
                        </div>
                        <p className="economy-guide-desc">Los Creditsoft son la moneda de la plataforma. Se ganan jugando y participando activamente en la comunidad.</p>
                        <ul className="economy-guide-list">
                          <li><span className="earn-badge">+50 CS</span> Check-in en evento oficial</li>
                          <li><span className="earn-badge">+20 CS</span> Perfil completo al 100%</li>
                          <li><span className="earn-badge">+10 CS</span> Por cada Fair Play verde</li>
                          <li><span className="earn-badge">+30 CS</span> Logro desbloqueado</li>
                          <li><span className="earn-badge">+15 CS</span> Primer check-in del mes</li>
                        </ul>
                        <p className="economy-guide-use"><strong>Para qué sirven:</strong> Desbloquear skins de camuflaje y animaciones especiales para tu credencial en el ID Lab.</p>
                      </div>

                      <div className="economy-guide-col">
                        <div className="economy-guide-col-header premium">
                          <span>💎</span>
                          <strong>Fichas Premium</strong>
                        </div>
                        <p className="economy-guide-desc">Las Fichas Premium son exclusivas para usuarios con cuenta Premium. Desbloquean contenido legendario y beneficios especiales.</p>
                        <ul className="economy-guide-list">
                          <li>✅ Skins legendarios exclusivos</li>
                          <li>✅ Animaciones de giro premium</li>
                          <li>✅ Badge Premium visible en credencial</li>
                          <li>✅ Prioridad en eventos con cupo limitado</li>
                          <li>✅ Historial extendido de partidas</li>
                        </ul>
                        <p className="economy-guide-use"><strong>Cómo obtenerlo:</strong> La cuenta Premium se habilita mediante suscripción mensual o como recompensa especial de torneos. Próximamente disponible.</p>
                      </div>
                    </div>

                    <div className="economy-guide-free-vs-premium">
                      <h4 className="fvp-title">Gratis vs Premium</h4>
                      <div className="fvp-grid">
                        <div className="fvp-col fvp-free">
                          <span className="fvp-label">Cuenta Gratuita</span>
                          <ul>
                            <li>✅ Credencial Airsoft ID</li>
                            <li>✅ QR de validación</li>
                            <li>✅ Historial de eventos</li>
                            <li>✅ 10 skins militares base</li>
                            <li>✅ Creditsoft ganados</li>
                            <li>❌ Skins legendarios</li>
                            <li>❌ Badge Premium</li>
                          </ul>
                        </div>
                        <div className="fvp-col fvp-premium">
                          <span className="fvp-label premium-glow">Cuenta Premium 💎</span>
                          <ul>
                            <li>✅ Todo lo de la cuenta gratuita</li>
                            <li>✅ Todos los skins desbloqueados</li>
                            <li>✅ Fichas Premium mensuales</li>
                            <li>✅ Badge dorado en credencial</li>
                            <li>✅ Prioridad en inscripción a eventos</li>
                            <li>✅ Acceso anticipado a funciones nuevas</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* TAB: ID LAB */}
              {activeTab === 'idlab' && (
                <section aria-labelledby="idlab-panel-title">
                  <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                    <h2 id="idlab-panel-title" className="panel-title" style={{ margin: 0 }}>Laboratorio de Identidad (ID Lab)</h2>
                    
                    {/* Sub-navigation inside ID Lab */}
                    <div style={{ display: 'flex', gap: '4px', background: 'rgba(255,255,255,0.04)', padding: '4px', borderRadius: '10px' }}>
                      <button
                        type="button"
                        className={`dashboard-tab-btn ${idlabSubTab === 'skins' ? 'is-active' : ''}`}
                        onClick={() => setIdlabSubTab('skins')}
                        style={{ fontSize: '13px', padding: '6px 12px', borderRadius: '8px' }}
                      >
                        Skins ({SKINS_CATALOG.length})
                      </button>
                      <button
                        type="button"
                        className={`dashboard-tab-btn ${idlabSubTab === 'animations' ? 'is-active' : ''}`}
                        onClick={() => setIdlabSubTab('animations')}
                        style={{ fontSize: '13px', padding: '6px 12px', borderRadius: '8px' }}
                      >
                        Giros ({ANIMATIONS_CATALOG.length})
                      </button>
                    </div>
                  </header>
                  
                  <div className="customization-layout">
                    {/* Item Selector List */}
                    <div className="skin-selector-panel" style={{ maxHeight: '540px', overflowY: 'auto', paddingRight: '8px' }}>
                      
                      {/* SUBTAB: SKINS */}
                      {idlabSubTab === 'skins' && SKINS_CATALOG.map((item) => {
                        const isUnlocked = unlockedItems.includes(item.code);
                        const isEquipped = equippedSkin === item.code;
                        const isBuying = buyingCode === item.code;
                        const isEquipping = equippingCode === item.code;

                        return (
                          <div
                            key={item.code}
                            className={`skin-option-card ${isEquipped ? 'is-active' : ''}`}
                            onClick={() => {
                              if (!isEquipped && isUnlocked && equippingCode === null) {
                                void handleEquipItem('skin', item.code);
                              }
                            }}
                          >
                            {/* Mini Preview Texture Banner */}
                            <div className={`skin-mini-preview oc-skin-${item.code}`} />

                            <div className="skin-option-info">
                              <div className="skin-option-header">
                                <h3 className="skin-option-name" style={{ fontSize: '15px' }}>{item.name}</h3>
                                <span className={`achievement-rarity rarity-${item.rarity.replace('ú', 'u')}`} style={{ fontSize: '9px', marginTop: 0 }}>
                                  {item.rarity}
                                </span>
                              </div>
                              <p className="skin-option-desc" style={{ fontSize: '12px', minHeight: '32px' }}>{item.desc}</p>
                            </div>

                            <div className="skin-option-action">
                              {isEquipped ? (
                                <span style={{ color: '#c8ff5c', fontSize: '13px', fontWeight: 700, padding: '6px 10px', background: 'rgba(200, 255, 92, 0.08)', borderRadius: '8px', border: '1px solid rgba(200, 255, 92, 0.2)' }}>Equipado</span>
                              ) : isUnlocked ? (
                                <button
                                  type="button"
                                  className="primary-btn"
                                  style={{ padding: '6px 12px', fontSize: '13px', background: 'rgba(255,255,255,0.06)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }}
                                  disabled={equippingCode !== null}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleEquipItem('skin', item.code);
                                  }}
                                >
                                  {isEquipping ? 'Equipando...' : 'Equipar'}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="primary-btn"
                                  style={{ padding: '6px 12px', fontSize: '13px', background: '#c8ff5c', color: '#111a24', border: 'none' }}
                                  disabled={buyingCode !== null}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleUnlockItem(item);
                                  }}
                                >
                                  {isBuying ? 'Desbloqueando...' : `Desbloquear (${item.cost} 🪙)`}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {/* SUBTAB: ANIMATIONS */}
                      {idlabSubTab === 'animations' && ANIMATIONS_CATALOG.map((item) => {
                        const isUnlocked = unlockedItems.includes(item.code);
                        const isEquipped = equippedAnimation === item.code;
                        const isBuying = buyingCode === item.code;
                        const isEquipping = equippingCode === item.code;

                        return (
                          <div
                            key={item.code}
                            className={`skin-option-card ${isEquipped ? 'is-active' : ''}`}
                            onClick={() => {
                              if (!isEquipped && isUnlocked && equippingCode === null) {
                                void handleEquipItem('animation', item.code);
                              }
                            }}
                          >
                            {/* Animated 3D Mini Card Preview */}
                            <div className="skin-mini-preview anim-mini-preview">
                              <div className={`mini-card-icon oc-anim-mini-${item.code}`}>
                                <div className="mini-card-face mini-card-front">ID</div>
                                <div className="mini-card-face mini-card-back">ICE</div>
                              </div>
                            </div>

                            <div className="skin-option-info">
                              <div className="skin-option-header">
                                <h3 className="skin-option-name" style={{ fontSize: '15px' }}>{item.name}</h3>
                                <span className={`achievement-rarity rarity-${item.rarity.replace('ú', 'u')}`} style={{ fontSize: '9px', marginTop: 0 }}>
                                  {item.rarity}
                                </span>
                              </div>
                              <p className="skin-option-desc" style={{ fontSize: '12px', minHeight: '32px' }}>{item.desc}</p>
                            </div>

                            <div className="skin-option-action">
                              {isEquipped ? (
                                <span style={{ color: '#c8ff5c', fontSize: '13px', fontWeight: 700, padding: '6px 10px', background: 'rgba(200, 255, 92, 0.08)', borderRadius: '8px', border: '1px solid rgba(200, 255, 92, 0.2)' }}>Equipado</span>
                              ) : isUnlocked ? (
                                <button
                                  type="button"
                                  className="primary-btn"
                                  style={{ padding: '6px 12px', fontSize: '13px', background: 'rgba(255,255,255,0.06)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }}
                                  disabled={equippingCode !== null}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleEquipItem('animation', item.code);
                                  }}
                                >
                                  {isEquipping ? 'Equipando...' : 'Equipar'}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="primary-btn"
                                  style={{ padding: '6px 12px', fontSize: '13px', background: '#c8ff5c', color: '#111a24', border: 'none' }}
                                  disabled={buyingCode !== null}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleUnlockItem(item);
                                  }}
                                >
                                  {isBuying ? 'Desbloqueando...' : `Desbloquear (${item.cost} 🪙)`}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Preview Column */}
                    <div className="skin-preview-wrap">
                      <p style={{ margin: '0 0 12px', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9caab3' }}>
                        Vista Previa Interactiva
                      </p>
                      {operatorData ? (
                        <OperatorCredentialCard
                          data={operatorData}
                          defaultSkin={equippedSkin}
                          equippedAnimation={equippedAnimation}
                          equippedSound={equippedSound}
                        />
                      ) : (
                        <p style={{ color: '#ff7262' }}>Cargando previsualización...</p>
                      )}
                      <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#9caab3', textAlign: 'center' }}>
                        Haz clic o arrastra la credencial para voltearla y ver los detalles ICE. ¡Se reproducirán el sonido y la animación equipados!
                      </p>
                    </div>
                  </div>
                </section>
              )}

              {/* TAB: EVENTOS ASISTIDOS */}
              {activeTab === 'eventos' && (
                <section aria-labelledby="eventos-panel-title">
                  <h2 id="eventos-panel-title" className="panel-title">Eventos Asistidos</h2>
                  {attendedEvents.length === 0 ? (
                    <div className="no-data-msg">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                      <h3>Sin historial de eventos</h3>
                      <p>No se encontraron asistencias registradas a partidas o eventos oficiales para este operador.</p>
                    </div>
                  ) : (
                    <div className="events-list">
                      {attendedEvents.map((item, idx) => (
                        <article key={item.event?.id || idx} className="event-item-card">
                          <div className="event-info-left">
                            <h3 className="event-item-title">{item.event?.title || 'Partida de Airsoft'}</h3>
                            <div className="event-item-field">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                              {item.event?.field?.name || 'Cancha Registrada'}
                            </div>
                          </div>
                          <div className="event-meta-right">
                            <span className="event-item-date">
                              {item.event?.event_date ? formatLocalDate(item.event.event_date) : ''}
                            </span>
                            <span className="event-checkin-badge">
                              Confirmado (Checked-in)
                            </span>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {/* TAB: LOGROS */}
              {activeTab === 'logros' && (
                <section aria-labelledby="logros-panel-title">
                  <h2 id="logros-panel-title" className="panel-title">Medallas y Logros</h2>
                  <p style={{ margin: '0 0 20px', color: '#9caab3' }}>
                    Completa objetivos tácticos y de juego limpio para desbloquear logros y medallas competitivas.
                  </p>
                  
                  <div className="achievements-grid">
                    {achievementsList.map(ach => (
                      <article key={ach.code} className={`achievement-card ${ach.unlocked ? 'is-unlocked' : ''}`}>
                        <div className="achievement-status-icon">
                          {ach.unlocked ? (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                          ) : (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                          )}
                        </div>
                        <div className="achievement-info">
                          <h3 className="achievement-title">{ach.title}</h3>
                          <p className="achievement-desc">{ach.description}</p>
                          <span className={`achievement-rarity rarity-${ach.rarity}`}>
                            {ach.rarity}
                          </span>
                          {ach.unlocked && ach.unlockedDate && (
                            <span className="achievement-date">
                              Desbloqueado el: {formatLocalDate(ach.unlockedDate)}
                            </span>
                          )}
                          {ach.unlocked && !ach.unlockedDate && (
                            <span className="achievement-date">
                              Desbloqueado
                            </span>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
