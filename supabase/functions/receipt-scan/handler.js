// Ablauf des Bon-Scans, unabhängig von Deno: index.ts reicht den Anthropic-
// Client und den Supabase-Client des Aufrufers hinein (in Tests Attrappen).
//
// Reihenfolge: Eingabe prüfen → Tageslimit (claim_receipt_scan) → Produkte des
// Haushalts lesen (RLS mit dem Token des Aufrufers) → Claude → Antwort prüfen.

import { DEFAULT_MODEL, SYSTEM_PROMPT, RESULT_SCHEMA, checkRequest, productsText, cleanResult } from './receipt.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

/**
 * @param {object} deps
 * @param {() => object|null} deps.anthropic  Anthropic-Client oder null (kein API-Schlüssel)
 * @param {(authHeader: string) => object} deps.userClient  Supabase-Client mit dem Token des Aufrufers
 * @param {string} [deps.model]
 * @param {(msg: string, err?: unknown) => void} [deps.log]
 */
export function createHandler({ anthropic, userClient, model = DEFAULT_MODEL, log = () => {} }) {
  return async function handle(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'POST') return json(405, { error: 'method' });

    const auth = req.headers.get('Authorization');
    if (!auth) return json(401, { error: 'auth' });

    const client = anthropic();
    if (!client) return json(503, { error: 'not_configured' });

    let body;
    try {
      body = await req.json();
    } catch {
      return json(400, { error: 'body' });
    }
    const bad = checkRequest(body);
    if (bad) return json(400, { error: bad });

    const supabase = userClient(auth);
    const claim = await supabase.rpc('claim_receipt_scan');
    if (claim.error) {
      log('claim_receipt_scan', claim.error);
      // ungültiges Token, anonym oder ohne Haushalt: kein Zugriff
      const denied = ['PGRST301', 'PGRST302', '42501', 'P0001'].includes(claim.error.code);
      return json(denied ? 401 : 500, { error: 'claim' });
    }
    if (claim.data !== true) return json(429, { error: 'limit' });

    const products = await supabase.from('products').select('id,name,category,receipt_names').order('name').limit(1000);
    if (products.error) {
      log('products', products.error);
      return json(500, { error: 'products' });
    }

    const request = {
      model,
      max_tokens: 16000,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: RESULT_SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: body.media_type, data: body.image } },
            { type: 'text', text: productsText(products.data) },
          ],
        },
      ],
    };
    // Lehnt ein Sicherheitsfilter fälschlich ab, übernimmt serverseitig ein
    // anderes Modell (Haiku kennt diesen Rückfall nicht).
    if (!/haiku/.test(model)) {
      request.betas = ['server-side-fallback-2026-07-01'];
      request.fallbacks = 'default';
    }

    let response;
    try {
      response = await client.beta.messages.create(request);
    } catch (e) {
      log('anthropic', e);
      return json(502, { error: 'upstream' });
    }
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
      log(`stop_reason ${response.stop_reason}`);
      return json(422, { error: 'unreadable' });
    }
    const text = response.content.find((b) => b.type === 'text')?.text;
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      log('json', e);
      return json(422, { error: 'unreadable' });
    }
    return json(200, cleanResult(parsed, products.data.map((p) => p.id)));
  };
}
