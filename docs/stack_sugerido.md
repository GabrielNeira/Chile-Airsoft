# Stack sugerido para ChileAirsoft.com

- Frontend: Next.js 15 (App Router) + TypeScript + React Server Components.
- UI: Tailwind CSS 4 para utilidades rapidas + CSS modular para superficies tacticas especiales.
- DB/Auth/Storage: Supabase (Postgres + Auth + Storage + Realtime).
- QR: `qrcode` para generar codigo unico por operador y `html5-qrcode` para vista de escaner organizador.
- Validacion: Zod para contratos de datos (perfil, check-in, crono, fair play).
- Roles y seguridad: Row Level Security + policies por `field_admin`, `organizer` y `super_admin`.
- Observabilidad: Sentry + logs de auditoria en tablas de eventos administrativos.

## Flujo recomendado

1. Usuario crea/edita su perfil CO (sin acceso para editar metricas globales).
2. Organizador/Admin escanea QR, registra check-in y valida crono del dia.
3. Al terminar el evento, organizador reporta fair play.
4. Triggers SQL recalculan metricas globales en `operator_global_metrics`.

## Paquetes iniciales

```bash
npm install @supabase/supabase-js zod qrcode html5-qrcode clsx
```
