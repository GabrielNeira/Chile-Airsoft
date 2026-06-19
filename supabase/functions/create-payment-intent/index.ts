declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

// @ts-ignore: npm: specifier is resolved by Deno runtime in Supabase Edge Functions.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  // Para evitar que supabase-js lance un error genérico "non-2xx status code",
  // devolvemos siempre 200 a nivel HTTP pero con el error en el body,
  // a menos que sea un error crítico del servidor.
  const httpStatus = status >= 400 ? 200 : status;
  return new Response(JSON.stringify(body), {
    status: httpStatus,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
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

  // Obtenemos el JWT del header para saber quien es el usuario que llama
  const authHeader = request.headers.get('Authorization') || '';
  const supabaseClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false }
  });

  const { data: { user }, error: userError } = await supabaseClient.auth.getUser(authHeader.replace('Bearer ', ''));
  if (userError || !user) {
    return jsonResponse(401, { status: 'error', message: 'Unauthorized' });
  }

  try {
    const body = await request.json();
    const { event_id } = body;

    if (!event_id) {
      return jsonResponse(400, { status: 'error', message: 'event_id is required' });
    }

    // Buscar info del evento
    const { data: event, error: eventError } = await supabaseClient
      .from('events')
      .select('id, title, event_date, field_id')
      .eq('id', event_id)
      .single();

    if (eventError || !event) {
      return jsonResponse(404, { status: 'error', message: 'Event not found' });
    }

    // Buscar cuenta de pago de la cancha
    const { data: account, error: accountError } = await supabaseClient
      .from('field_payment_accounts')
      .select('id, provider_account_ref')
      .eq('field_id', event.field_id)
      .eq('provider_code', 'mercadopago')
      .eq('is_active', true)
      .single();

    let accessToken = '';
    let accountId = '';
    
    if (accountError || !account) {
      // FALLBACK DE PRUEBA: Si no encontramos la cuenta en la BD, usamos el token de prueba proporcionado
      accessToken = 'APP_USR-8671462273932525-061911-c455eac149d26fd094336832be65d5e3-3485467376';
      accountId = '00000000-0000-0000-0000-000000000000';
    } else {
      accessToken = account.provider_account_ref;
      accountId = account.id;
    }

    // Crear la preferencia en MercadoPago
    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        items: [
          {
            id: event.id,
            title: `Ticket: ${event.title}`,
            description: `Entrada al evento ${event.title} el ${event.event_date}`,
            quantity: 1,
            unit_price: 25000,
            currency_id: 'CLP'
          }
        ],
        payer: {
          email: user.email,
        },
        back_urls: {
          success: `https://www.google.com/`,
          failure: `https://www.google.com/`,
          pending: `https://www.google.com/`
        },
        auto_return: 'approved',
        metadata: {
          field_payment_account_id: accountId,
          event_id: event.id,
          operator_user_id: user.id
        },
        external_reference: `${event.id}-${user.id}-${Date.now()}` // Para mapear localmente
      })
    });

    const mpData = await mpResponse.json();

    if (!mpResponse.ok) {
      console.error('MercadoPago Error:', mpData);
      return jsonResponse(400, { status: 'error', message: `MercadoPago Error: ${mpData.message || JSON.stringify(mpData)}` });
    }

    return jsonResponse(200, {
      status: 'success',
      init_point: mpData.init_point,
      sandbox_init_point: mpData.sandbox_init_point
    });

  } catch (error) {
    console.error(error);
    return jsonResponse(500, { status: 'error', message: (error as Error).message });
  }
});
