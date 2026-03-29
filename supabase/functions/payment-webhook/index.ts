declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

// @ts-ignore: npm: specifier is resolved by Deno runtime in Supabase Edge Functions.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-provider-code, x-event-id, x-idempotency-key, x-signature',
};

type ProviderPayload = Record<string, unknown> & {
  metadata?: {
    field_payment_account_id?: string;
  };
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

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return toHex(new Uint8Array(signature));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return diff === 0;
}

function extractHeader(request: Request, name: string): string {
  return request.headers.get(name)?.trim() ?? '';
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

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, { status: 'error', message: 'Server misconfigured' });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false }
  });

  const providerCode = extractHeader(request, 'x-provider-code').toLowerCase();
  const eventExternalId = extractHeader(request, 'x-event-id');
  const idempotencyKey = extractHeader(request, 'x-idempotency-key');
  const signature = extractHeader(request, 'x-signature').toLowerCase();

  if (!providerCode || !idempotencyKey) {
    return jsonResponse(400, {
      status: 'error',
      message: 'Missing required headers x-provider-code or x-idempotency-key'
    });
  }

  const rawBody = await request.text();
  let payload: ProviderPayload;

  try {
    payload = JSON.parse(rawBody) as ProviderPayload;
  } catch {
    return jsonResponse(400, { status: 'error', message: 'Invalid JSON body' });
  }

  const accountId = String(payload?.metadata?.field_payment_account_id ?? '').trim();
  if (!accountId) {
    return jsonResponse(400, {
      status: 'error',
      message: 'metadata.field_payment_account_id is required in payload'
    });
  }

  const { data: account, error: accountError } = await supabase
    .from('field_payment_accounts')
    .select('id,provider_code,webhook_secret,is_active')
    .eq('id', accountId)
    .eq('provider_code', providerCode)
    .maybeSingle();

  if (accountError || !account || !account.is_active) {
    return jsonResponse(404, {
      status: 'error',
      message: 'Payment account not found or inactive for provider'
    });
  }

  const expected = await hmacHex(account.webhook_secret, rawBody);
  const signatureValid = signature ? safeEqual(signature, expected) : false;

  try {
    const { data: rpcResult, error: rpcError } = await supabase.rpc('process_payment_webhook', {
      p_provider_code: providerCode,
      p_event_external_id: eventExternalId || null,
      p_idempotency_key: idempotencyKey,
      p_signature_valid: signatureValid,
      p_payload: payload,
    });

    if (rpcError) {
      return jsonResponse(500, {
        status: 'error',
        message: rpcError.message,
        signature_valid: signatureValid
      });
    }

    const resultObject = (rpcResult ?? {}) as Record<string, unknown>;
    const resultStatus = String(resultObject.status ?? 'processed').toLowerCase();
    const statusCode = resultStatus === 'failed'
      ? 500
      : resultStatus === 'ignored'
        ? 202
        : 200;

    return jsonResponse(statusCode, {
      status: resultStatus,
      signature_valid: signatureValid,
      provider: providerCode,
      idempotency_key: idempotencyKey,
      result: resultObject
    });
  } catch (error) {
    return jsonResponse(500, {
      status: 'error',
      message: (error as Error).message,
      signature_valid: signatureValid
    });
  }
});
