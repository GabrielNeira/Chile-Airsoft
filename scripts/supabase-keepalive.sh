#!/usr/bin/env bash
#
# Consulta la API REST de Supabase para generar actividad real y evitar que
# el plan Free pause el proyecto por inactividad.
#
# La doc de Supabase (guides/platform/free-project-pausing) dice que hacen
# falta "a few user requests to the database each day over the previous week".
# La metrica es actividad DIARIA, no la brecha entre corridas: un cron de dos
# veces por semana no califica aunque nunca supere los 7 dias.
#
# Codigos de salida:
#   0  la base respondio 200
#   1  fallo transitorio tras agotar los reintentos
#   2  proyecto pausado o eliminado (el subdominio no resuelve)
#   3  problema de configuracion (secrets ausentes, key invalida, tabla mala)
#
# Variables requeridas: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY
# Opcionales: KEEPALIVE_TABLE (default: events), INTENTOS (3), ESPERA (15)

set -uo pipefail

TABLA="${KEEPALIVE_TABLE:-events}"
INTENTOS="${INTENTOS:-3}"
ESPERA="${ESPERA:-15}"
CUERPO="$(mktemp)"
trap 'rm -f "${CUERPO}"' EXIT

err() { echo "::error::$*" >&2; }

if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_PUBLISHABLE_KEY:-}" ]; then
  err "Faltan los secrets SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY."
  exit 3
fi

HOST="$(printf '%s' "${SUPABASE_URL}" | sed -E 's#^[a-zA-Z]+://##; s#[/:].*$##')"

# Supabase retira el DNS del subdominio cuando pausa un proyecto del plan Free.
# Si no resuelve, reintentar es tiempo perdido: hay que restaurarlo a mano
# desde el dashboard y ningun ping puede hacerlo.
if ! getent hosts "${HOST}" >/dev/null 2>&1; then
  err "El subdominio ${HOST} no resuelve (NXDOMAIN). En Supabase eso significa proyecto PAUSADO o eliminado, y un keep-alive NO puede despertarlo: hay que restaurarlo a mano desde el dashboard. Recuerda que la ventana para restaurar es de 90 dias."
  exit 2
fi
echo "DNS de ${HOST}: OK."

ultimo_code=""

for intento in $(seq 1 "${INTENTOS}"); do
  code="$(curl -sS -o "${CUERPO}" -w '%{http_code}' -m 20 \
    "${SUPABASE_URL}/rest/v1/${TABLA}?select=*&limit=1" \
    -H "apikey: ${SUPABASE_PUBLISHABLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_PUBLISHABLE_KEY}" \
    -H "Accept: application/json" 2>/dev/null)"
  rc=$?

  echo "Intento ${intento}/${INTENTOS}: curl rc=${rc} HTTP ${code}"

  # 6 = could not resolve host. Puede aparecer aca si el proyecto se pausa
  # justo entre el chequeo de DNS y la consulta.
  if [ "${rc}" -eq 6 ]; then
    err "El subdominio dejo de resolver a mitad de la consulta: proyecto PAUSADO o eliminado. Restauralo a mano desde el dashboard."
    exit 2
  fi

  case "${code}" in
    200)
      echo "Base de datos despierta y respondiendo. Actividad registrada."
      exit 0
      ;;
    401|403)
      head -c 300 "${CUERPO}" || true; echo
      err "HTTP ${code}: la API rechazo la credencial. Reintentar no sirve; rota SUPABASE_PUBLISHABLE_KEY en los secrets del repo."
      exit 3
      ;;
    404)
      # PGRST205: la cache de esquema de PostgREST queda vacia mientras el
      # proyecto sale de pausa y tras cada migracion. Se ve igual que una
      # tabla inexistente, asi que hay que reintentar antes de concluir.
      ultimo_code=404
      head -c 300 "${CUERPO}" || true; echo
      echo "HTTP 404. Puede ser la cache de esquema aun sin cargar. Reintentando en ${ESPERA}s..."
      ;;
    *)
      head -c 300 "${CUERPO}" || true; echo
      echo "Respuesta no concluyente. Reintentando en ${ESPERA}s..."
      ;;
  esac

  [ "${intento}" -lt "${INTENTOS}" ] && sleep "${ESPERA}"
done

if [ "${ultimo_code}" = "404" ]; then
  err "Tras ${INTENTOS} intentos la API sigue devolviendo 404 para la tabla '${TABLA}'. Dos causas posibles: (a) la cache de esquema de PostgREST no termino de cargar, normal si el proyecto acaba de salir de pausa o hubo una migracion, en cuyo caso basta reintentar en unos minutos; (b) la tabla no existe o no esta expuesta en la API, y hay que ajustar KEEPALIVE_TABLE."
  exit 3
fi

err "El keep-alive no obtuvo HTTP 200 tras ${INTENTOS} intentos. El DNS resuelve, asi que el proyecto no esta pausado: revisa el estado del servicio en el dashboard."
exit 1
