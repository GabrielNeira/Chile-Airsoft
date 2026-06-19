import { useEffect, useState } from 'react';
import './checkout-result.css';

export default function CheckoutResultView() {
  const [status, setStatus] = useState<string>('');

  useEffect(() => {
    // Extract status from URL: /checkout/success, /checkout/failure, /checkout/pending
    const pathParts = window.location.pathname.split('/');
    const resultStatus = pathParts[pathParts.length - 1];
    setStatus(resultStatus);
  }, []);

  function goHome() {
    window.location.href = '/';
  }

  return (
    <div className="checkout-result-overlay">
      <div className="checkout-result-modal">
        {status === 'success' && (
          <>
            <div className="checkout-icon success">✓</div>
            <h2>¡Pago Exitoso!</h2>
            <p>Tu inscripción ha sido confirmada. Ya estás registrado en el evento.</p>
          </>
        )}
        {status === 'pending' && (
          <>
            <div className="checkout-icon pending">⏳</div>
            <h2>Pago Pendiente</h2>
            <p>Estamos esperando la confirmación de la pasarela de pago. Te notificaremos pronto.</p>
          </>
        )}
        {status === 'failure' && (
          <>
            <div className="checkout-icon failure">✕</div>
            <h2>Error en el Pago</h2>
            <p>No pudimos procesar tu pago. Por favor intenta nuevamente.</p>
          </>
        )}
        <button className="checkout-home-btn" onClick={goHome}>Volver al Inicio</button>
      </div>
    </div>
  );
}
