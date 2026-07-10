import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabaseClient';

type Step = 'confirm' | 'reset-password' | 'done';

function BrandLogo() {
  return <img src="/logo.png?v=2" alt="Logo Airsoft ID" className="brand-logo" />;
}

export default function AuthConfirmView() {
  const params = new URLSearchParams(window.location.search);
  const tokenHash = params.get('token_hash');
  const otpType = params.get('type');

  const [step, setStep] = useState<Step>('confirm');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const isRecovery = otpType === 'recovery';
  const isValidLink = Boolean(tokenHash && otpType);

  async function handleConfirm() {
    if (!supabase || !tokenHash || !otpType) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: otpType as 'recovery' | 'email' | 'signup' | 'invite' | 'magiclink' | 'email_change'
      });

      if (verifyError) {
        throw verifyError;
      }

      setStep(isRecovery ? 'reset-password' : 'done');
    } catch (err) {
      setError((err as Error).message || 'El enlace es invalido o ha expirado. Solicita uno nuevo.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        throw updateError;
      }
      setStep('done');
    } catch (err) {
      setError((err as Error).message || 'No fue posible actualizar la contraseña.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-shell auth-shell">
      <div className="page-bg" />
      <section className="page-grid page-grid-auth">
        <div className="auth-card">
          <BrandLogo />
          <h1 className="page-title">Airsoft ID</h1>

          {!isValidLink && (
            <p className="page-subtitle">
              Este enlace no es valido. Solicita un nuevo correo de recuperación desde la app.
            </p>
          )}

          {isValidLink && step === 'confirm' && (
            <>
              <p className="page-subtitle">
                {isRecovery
                  ? 'Confirma para continuar con el restablecimiento de tu contraseña.'
                  : 'Confirma para continuar.'}
              </p>
              <button type="button" className="primary-btn" onClick={handleConfirm} disabled={loading}>
                {loading ? 'Confirmando...' : 'Confirmar y continuar'}
              </button>
            </>
          )}

          {step === 'reset-password' && (
            <form onSubmit={handleResetPassword} className="auth-form">
              <p className="page-subtitle">Ingresa tu nueva contraseña.</p>
              <label>
                Nueva contraseña
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={6}
                  required
                  placeholder="Minimo 6 caracteres"
                />
              </label>
              <label>
                Confirmar contraseña
                <input
                  type="password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  minLength={6}
                  required
                  placeholder="Repite la contraseña"
                />
              </label>
              <button type="submit" className="primary-btn" disabled={loading}>
                {loading ? 'Guardando...' : 'Guardar nueva contraseña'}
              </button>
            </form>
          )}

          {step === 'done' && (
            <>
              <p className="page-subtitle">
                {isRecovery
                  ? 'Tu contraseña fue actualizada correctamente.'
                  : 'Confirmación completada.'}
              </p>
              <button type="button" className="primary-btn" onClick={() => { window.location.href = '/'; }}>
                Ir a Airsoft ID
              </button>
            </>
          )}

          {error && <p className="error-text" aria-live="assertive">{error}</p>}
        </div>
      </section>
    </main>
  );
}
