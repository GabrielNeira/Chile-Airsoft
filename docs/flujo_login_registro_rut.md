# Flujo de navegacion: login y registro con RUT

## Objetivo

Disenar un onboarding seguro y trazable donde el RUT sea llave transversal del usuario,
con controles de privacidad alineados a la Ley N 19.628.

## Propuesta de rutas frontend

1. `/acceso`
   - Formulario: RUT.
   - Boton: "Continuar".
   - Accion: llamar `public.request_rut_login_hint(rut, ip, user_agent)`.
   - Respuesta UX: mostrar siempre mensaje no enumerativo.

2. `/acceso/correo`
   - Formulario: correo + password (Supabase Auth).
   - Accion: `signInWithPassword`.
   - Si no existe cuenta: CTA a registro.

3. `/registro/datos-base`
   - Formulario minimo: RUT, correo, edad.
   - Validaciones cliente:
     - formato y DV de RUT (misma logica modulo 11).
     - correo valido.
     - edad en rango [14, 120].

4. `/registro/autocompletar-nombre`
   - Al ingresar RUT, consumir API de autocompletado de nombres (SII o reemplazo).
   - Campos sugeridos bloqueados por defecto: nombres legales.
   - Permitir correccion manual solo con motivo y auditoria (opcional).

5. `/registro/consentimientos`
   - Checkboxes obligatorios:
     - aviso de privacidad,
     - terminos,
     - autorizacion tratamiento de datos.
   - Si edad < 18: bloque adicional de representante legal.

6. `/registro/confirmacion`
   - Ejecutar RPC `public.register_my_identity_with_rut(...)`.
   - Si ok: navegar a perfil operacional.

7. `/perfil/completar`
   - Completar datos de juego (`operator_profiles`) y vincular `rut_pk`.

## Reglas de validacion clave

- RUT invalido: bloquear avance de flujo.
- Si correo no coincide con `auth.users.email`: bloquear registro.
- Si menor de edad sin representante: bloquear registro.
- Si faltan consentimientos obligatorios: bloquear registro.
- Rate-limit en login por RUT: 5 intentos cada 15 minutos por RUT/IP.

## Mensajes legales recomendados en UI

- "Tus datos personales seran tratados conforme a la Ley N 19.628, solo para autenticacion, operacion y seguridad de la plataforma."
- "Puedes solicitar actualizacion, rectificacion o eliminacion de tus datos en los canales de soporte habilitados."
- "Si eres menor de edad, necesitamos autorizacion de tu representante legal."

## Matriz de campo minimo de registro

- RUT: obligatorio, valido, unico transversal.
- Correo: obligatorio, debe coincidir con cuenta autenticada.
- Edad: obligatoria, control de mayoria/minoria de edad.
- Nombres legales autocompletados: obligatorios, fuente auditada (`names_autocomplete_source`).
- Consentimientos versionados: obligatorios y auditables.

## Integracion backend recomendada

1. Usuario inicia con RUT -> `request_rut_login_hint`.
2. Usuario autentica email/password o magic link con Supabase Auth.
3. Front llama `register_my_identity_with_rut` con datos y consentimientos.
4. Front completa `operator_profiles` y resto de dominio del juego.
