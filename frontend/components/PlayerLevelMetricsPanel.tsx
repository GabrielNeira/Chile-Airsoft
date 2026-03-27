import './player-level-metrics.css';

interface PlayerLevelMetricsPanelProps {
  level: number;
  rankTitle: string;
  xpTotal: number;
  trustedScore: number;
  verifiedMetrics: number;
  pendingMetrics: number;
  attendance30d: number;
  chronoValidated30d: number;
  fairPlayGreen30d: number;
  fairPlayYellow30d: number;
  fairPlayRed30d: number;
}

export default function PlayerLevelMetricsPanel(props: PlayerLevelMetricsPanelProps) {
  const {
    level,
    rankTitle,
    xpTotal,
    trustedScore,
    verifiedMetrics,
    pendingMetrics,
    attendance30d,
    chronoValidated30d,
    fairPlayGreen30d,
    fairPlayYellow30d,
    fairPlayRed30d
  } = props;

  const fairPlayTotal = Math.max(1, fairPlayGreen30d + fairPlayYellow30d + fairPlayRed30d);
  const fairPlayGreenRatio = Math.round((fairPlayGreen30d / fairPlayTotal) * 100);

  return (
    <section className="metrics-shell" aria-label="Metricas para nivel de jugador">
      <header className="metrics-header">
        <div>
          <p className="metrics-eyebrow">INTEL OPERADOR</p>
          <h2 className="metrics-title">Motor de Nivel</h2>
          <p className="metrics-subtitle">Metricas captadas por cancha y jugador para determinar nivel real.</p>
        </div>

        <div className="metrics-kpi-grid">
          <article className="metrics-kpi">
            <p className="metrics-kpi-label">Nivel</p>
            <p className="metrics-kpi-value">{level}</p>
            <p className="metrics-kpi-sub">{rankTitle}</p>
          </article>
          <article className="metrics-kpi">
            <p className="metrics-kpi-label">XP</p>
            <p className="metrics-kpi-value">{xpTotal.toLocaleString('es-CL')}</p>
            <p className="metrics-kpi-sub">Score {trustedScore}</p>
          </article>
          <article className="metrics-kpi">
            <p className="metrics-kpi-label">Verificadas</p>
            <p className="metrics-kpi-value">{verifiedMetrics}</p>
            <p className="metrics-kpi-sub">Pendientes {pendingMetrics}</p>
          </article>
        </div>
      </header>

      <div className="metrics-cards">
        <article className="metrics-card">
          <h3>Cancha</h3>
          <p>Asistencias validadas (30d): {attendance30d}</p>
          <p>Cronos validados (30d): {chronoValidated30d}</p>
        </article>

        <article className="metrics-card">
          <h3>Fair Play</h3>
          <p>Verde: {fairPlayGreen30d}</p>
          <p>Amarillo: {fairPlayYellow30d}</p>
          <p>Rojo: {fairPlayRed30d}</p>
          <p>Ratio verde: {fairPlayGreenRatio}%</p>
        </article>

        <article className="metrics-card">
          <h3>Reglas de Nivel</h3>
          <p>XP = max(0, trusted_score x 10)</p>
          <p>Nivel = min(50, floor(sqrt(XP / 120)) + 1)</p>
          <p>Solo eventos verificados impactan en score.</p>
        </article>
      </div>
    </section>
  );
}
