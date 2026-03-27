import type { OperatorCredentialData } from './OperatorCredentialCard';
import './local-operator-editor.css';

interface LocalOperatorEditorProps {
  value: OperatorCredentialData;
  onChange: (next: OperatorCredentialData) => void;
}

function toNumber(input: string, fallback = 0): number {
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function LocalOperatorEditor({ value, onChange }: LocalOperatorEditorProps) {
  return (
    <section className="loe-shell" aria-label="Editor local de operador">
      <header>
        <p className="loe-eyebrow">MODO LOCAL</p>
        <h3 className="loe-title">Editor en tiempo real</h3>
        <p className="loe-sub">Lo que cambies aqui se refleja al instante en la credencial.</p>
      </header>

      <div className="loe-grid">
        <label>
          Nickname
          <input
            value={value.nickname}
            onChange={(e) => onChange({ ...value, nickname: e.target.value })}
            placeholder="GHOST-CL"
          />
        </label>

        <label>
          Nombre real
          <input
            value={value.realName}
            onChange={(e) => onChange({ ...value, realName: e.target.value })}
            placeholder="Nombre Apellido"
          />
        </label>

        <label>
          Rol
          <input value={value.role} onChange={(e) => onChange({ ...value, role: e.target.value })} placeholder="Assault" />
        </label>

        <label>
          Team
          <input value={value.team ?? ''} onChange={(e) => onChange({ ...value, team: e.target.value })} placeholder="Team" />
        </label>

        <label>
          Sangre
          <input
            value={value.bloodGroup}
            onChange={(e) => onChange({ ...value, bloodGroup: e.target.value })}
            placeholder="O+"
          />
        </label>

        <label>
          ID credencial
          <input
            value={value.credentialId}
            onChange={(e) => onChange({ ...value, credentialId: e.target.value })}
            placeholder="CO-CL-000001"
          />
        </label>

        <label>
          ICE nombre
          <input
            value={value.iceName}
            onChange={(e) => onChange({ ...value, iceName: e.target.value })}
            placeholder="Contacto emergencia"
          />
        </label>

        <label>
          ICE telefono
          <input
            value={value.icePhone}
            onChange={(e) => onChange({ ...value, icePhone: e.target.value })}
            placeholder="+56 9 ..."
          />
        </label>

        <label>
          FairPlay (0-100)
          <input
            type="number"
            min={0}
            max={100}
            value={value.fairPlayScore ?? 0}
            onChange={(e) => onChange({ ...value, fairPlayScore: toNumber(e.target.value, 0) })}
          />
        </label>

        <label>
          Eventos confirmados
          <input
            type="number"
            min={0}
            value={value.confirmedEvents ?? 0}
            onChange={(e) => onChange({ ...value, confirmedEvents: toNumber(e.target.value, 0) })}
          />
        </label>

        <label>
          Logros desbloqueados
          <input
            type="number"
            min={0}
            value={value.achievementsUnlocked ?? 0}
            onChange={(e) => onChange({ ...value, achievementsUnlocked: toNumber(e.target.value, 0) })}
          />
        </label>

        <label className="loe-span-2">
          Medallas (separadas por coma)
          <input
            value={(value.medals ?? []).join(', ')}
            onChange={(e) =>
              onChange({
                ...value,
                medals: e.target.value
                  .split(',')
                  .map((item) => item.trim())
                  .filter(Boolean)
              })
            }
            placeholder="Fair Play Elite, CQB Specialist"
          />
        </label>
      </div>
    </section>
  );
}
