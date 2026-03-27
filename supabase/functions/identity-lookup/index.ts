declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

// @ts-ignore: npm: specifier is resolved by Deno runtime in Supabase Edge Functions.
import { createClient } from 'npm:@supabase/supabase-js@2';

type LookupRequest = {
  rut?: string;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });
}

function normalizeRutToken(rawRut: string): string {
  return rawRut.toUpperCase().replace(/[^0-9K]/g, '');
}

function formatRut(rawRut: string): string {
  const token = normalizeRutToken(rawRut);
  if (token.length <= 1) {
    return token;
  }

  const body = token.slice(0, -1);
  const dv = token.slice(-1);
  const bodyWithDots = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${bodyWithDots}-${dv}`;
}

function isValidRutValue(rawRut: string): boolean {
  const token = normalizeRutToken(rawRut);
  if (!/^[0-9]{7,8}[0-9K]$/.test(token)) {
    return false;
  }

  const body = token.slice(0, -1);
  const dv = token.slice(-1);
  let sum = 0;
  let factor = 2;

  for (let i = body.length - 1; i >= 0; i -= 1) {
    sum += Number(body[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }

  const remainder = 11 - (sum % 11);
  const expected = remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);
  return dv === expected;
}

function extractClientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (!forwarded) {
    return null;
  }

  const first = forwarded.split(',')[0]?.trim();
  return first || null;
}

function isMissingRelationError(message: string | undefined): boolean {
  const text = (message ?? '').toLowerCase();
  return text.includes('does not exist') || text.includes('schema cache') || text.includes('could not find the table');
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse(405, { status: 'error', message: 'Method not allowed' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const providerApiUrl = Deno.env.get('IDENTITY_PROVIDER_URL') ?? 'https://api.boostr.cl/rut/name/{rut}.json';
  const providerApiKey = Deno.env.get('IDENTITY_PROVIDER_API_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, { status: 'error', message: 'Server misconfigured' });
  }

  if (!providerApiKey) {
    return jsonResponse(500, { status: 'error', message: 'Identity provider key is missing' });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false }
  });

  const authHeader = request.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse(401, { status: 'error', message: 'Unauthorized' });
  }

  const jwt = authHeader.replace('Bearer ', '').trim();
  const { data: authData, error: authError } = await supabase.auth.getUser(jwt);
  if (authError || !authData.user) {
    return jsonResponse(401, { status: 'error', message: 'Unauthorized' });
  }

  let payload: LookupRequest;
  try {
    payload = await request.json() as LookupRequest;
  } catch {
    return jsonResponse(400, { status: 'error', message: 'Invalid JSON body' });
  }

  const rawRut = payload.rut?.trim() ?? '';
  if (!rawRut) {
    return jsonResponse(400, { status: 'error', message: 'RUT is required' });
  }

  if (!isValidRutValue(rawRut)) {
    return jsonResponse(400, { status: 'error', message: 'RUT invalido' });
  }

  const normalizedRut = normalizeRutToken(rawRut);
  const formattedRut = formatRut(rawRut);
  const userId = authData.user.id;
  const sourceIp = extractClientIp(request);
  const userAgent = request.headers.get('user-agent');

  const maxRequestsPerHour = Number(Deno.env.get('IDENTITY_LOOKUP_LIMIT_PER_HOUR') ?? '30');
  const auditSince = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { count: requestsLastHour, error: rateError } = await supabase
    .from('identity_lookup_audit')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', auditSince);

  if (rateError && !isMissingRelationError(rateError.message)) {
    return jsonResponse(500, { status: 'error', message: 'Rate limit check failed' });
  }

  if (!rateError && (requestsLastHour ?? 0) >= maxRequestsPerHour) {
    return jsonResponse(429, {
      status: 'error',
      message: `Limite excedido. Maximo ${maxRequestsPerHour} consultas por hora.`
    });
  }

  const nowIso = new Date().toISOString();
  const { data: cached, error: cacheError } = await supabase
    .from('identity_lookup_cache')
    .select('rut,full_name,expires_at')
    .eq('rut', normalizedRut)
    .gt('expires_at', nowIso)
    .maybeSingle();

  if (cacheError && !isMissingRelationError(cacheError.message)) {
    return jsonResponse(500, { status: 'error', message: 'Cache lookup failed' });
  }

  if (!cacheError && cached?.full_name) {
    await supabase.from('identity_lookup_audit').insert({
      user_id: userId,
      rut: normalizedRut,
      source_ip: sourceIp,
      user_agent: userAgent,
      provider: 'boostr',
      cache_hit: true,
      success: true,
      failure_reason: null
    }).throwOnError().catch(() => null);

    return jsonResponse(200, {
      status: 'success',
      data: {
        document: normalizedRut.slice(0, -1),
        dv: normalizedRut.slice(-1),
        name: cached.full_name,
        from_cache: true
      }
    });
  }

  const providerUrl = providerApiUrl.includes('{rut}')
    ? providerApiUrl.replace('{rut}', encodeURIComponent(formattedRut))
    : `${providerApiUrl}${providerApiUrl.includes('?') ? '&' : '?'}rut=${encodeURIComponent(formattedRut)}`;

  let providerJson: Record<string, unknown> | null = null;
  let providerStatus = 500;

  try {
    const providerResponse = await fetch(providerUrl, {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'X-API-KEY': providerApiKey
      }
    });

    providerStatus = providerResponse.status;
    const text = await providerResponse.text();
    providerJson = JSON.parse(text) as Record<string, unknown>;
  } catch {
    await supabase.from('identity_lookup_audit').insert({
      user_id: userId,
      rut: normalizedRut,
      source_ip: sourceIp,
      user_agent: userAgent,
      provider: 'boostr',
      cache_hit: false,
      success: false,
      failure_reason: 'provider_unavailable'
    }).throwOnError().catch(() => null);

    return jsonResponse(502, { status: 'error', message: 'Proveedor de identidad no disponible' });
  }

  const providerData = (providerJson?.data && typeof providerJson.data === 'object')
    ? providerJson.data as Record<string, unknown>
    : null;

  const providerName = typeof providerData?.name === 'string'
    ? providerData.name.trim()
    : null;

  if (providerStatus >= 400 || !providerName) {
    await supabase.from('identity_lookup_audit').insert({
      user_id: userId,
      rut: normalizedRut,
      source_ip: sourceIp,
      user_agent: userAgent,
      provider: 'boostr',
      cache_hit: false,
      success: false,
      failure_reason: `provider_status_${providerStatus}`
    }).throwOnError().catch(() => null);

    const providerMessage = typeof providerJson?.message === 'string'
      ? providerJson.message
      : 'No fue posible obtener nombre para el RUT ingresado';

    return jsonResponse(providerStatus === 429 ? 429 : 404, {
      status: 'error',
      message: providerMessage
    });
  }

  const cacheTtlMinutes = Number(Deno.env.get('IDENTITY_LOOKUP_CACHE_TTL_MINUTES') ?? '1440');
  const expiresAt = new Date(Date.now() + cacheTtlMinutes * 60 * 1000).toISOString();

  await supabase.from('identity_lookup_cache').upsert({
    rut: normalizedRut,
    full_name: providerName,
    provider: 'boostr',
    payload: providerJson,
    fetched_at: new Date().toISOString(),
    expires_at: expiresAt
  }).throwOnError().catch(() => null);

  await supabase.from('identity_lookup_audit').insert({
    user_id: userId,
    rut: normalizedRut,
    source_ip: sourceIp,
    user_agent: userAgent,
    provider: 'boostr',
    cache_hit: false,
    success: true,
    failure_reason: null
  }).throwOnError().catch(() => null);

  return jsonResponse(200, {
    status: 'success',
    data: {
      document: normalizedRut.slice(0, -1),
      dv: normalizedRut.slice(-1),
      name: providerName,
      source: 'boostr',
      from_cache: false
    }
  });
});
