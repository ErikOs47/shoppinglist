import { describe, it, expect } from 'vitest';
import { createHandler } from '../../supabase/functions/receipt-scan/handler.js';
import { checkRequest, cleanResult, productsText, RESULT_SCHEMA } from '../../supabase/functions/receipt-scan/receipt.js';

const PRODUCTS = [
  { id: 'p1', name: 'Yogurt', category: 'Milch & Käse', receipt_names: ['ZOTT MONTE'] },
  { id: 'p2', name: 'Milk', category: 'Milch & Käse', receipt_names: [] },
];

function fakes({ claim = { data: true, error: null }, reply, throws } = {}) {
  const seen = { requests: [], rpc: 0 };
  const supabase = {
    rpc: async (name) => {
      seen.rpc += 1;
      seen.rpcName = name;
      return claim;
    },
    from: () => {
      const q = { select: () => q, order: () => q, limit: async () => ({ data: PRODUCTS, error: null }) };
      return q;
    },
  };
  const client = {
    beta: {
      messages: {
        create: async (req) => {
          seen.requests.push(req);
          if (throws) throw throws;
          return reply;
        },
      },
    },
  };
  return { seen, supabase, client };
}

const textReply = (obj) => ({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(obj) }] });

function post(body, headers = { Authorization: 'Bearer token' }) {
  return new Request('http://x/receipt-scan', { method: 'POST', headers, body: JSON.stringify(body) });
}

const VALID = { image: 'aGFsbG8=', media_type: 'image/jpeg' };

describe('Edge Function receipt-scan', () => {
  it('ohne API-Schlüssel: 503, kein Scan gezählt', async () => {
    const f = fakes();
    const res = await createHandler({ anthropic: () => null, userClient: () => f.supabase })(post(VALID));
    expect(res.status).toBe(503);
    expect(f.seen.rpc).toBe(0);
  });

  it('ohne Anmeldung 401, falsche Eingabe 400 (zählt nicht)', async () => {
    const f = fakes();
    const h = createHandler({ anthropic: () => f.client, userClient: () => f.supabase });
    expect((await h(post(VALID, {}))).status).toBe(401);
    expect((await h(post({ image: 'kein base64!', media_type: 'image/jpeg' }))).status).toBe(400);
    expect((await h(post({ image: 'aGFsbG8=', media_type: 'text/html' }))).status).toBe(400);
    expect(f.seen.rpc).toBe(0);
  });

  it('Tageslimit erreicht: 429, Claude wird nicht gefragt', async () => {
    const f = fakes({ claim: { data: false, error: null } });
    const res = await createHandler({ anthropic: () => f.client, userClient: () => f.supabase })(post(VALID));
    expect(res.status).toBe(429);
    expect(f.seen.requests).toHaveLength(0);
  });

  it('CORS-Vorabanfrage', async () => {
    const f = fakes();
    const res = await createHandler({ anthropic: () => f.client, userClient: () => f.supabase })(
      new Request('http://x', { method: 'OPTIONS' }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Headers')).toMatch(/authorization/);
  });

  it('Anfrage an Claude: Bild, Produktliste, Schema, Rückfall; Antwort wird geprüft', async () => {
    const f = fakes({
      reply: textReply({
        lines: [
          { text: ' ZOTT  MONTE ', quantity: 2, unit_price_cents: 69, product_id: 'p1', sure: true },
          { text: 'KAFFEE', quantity: 1, unit_price_cents: 499, product_id: 'erfunden', sure: true },
          { text: 'PFAND', quantity: 1, unit_price_cents: 0, product_id: null, sure: false },
        ],
        total_cents: 637,
        date: '2026-11-25',
      }),
    });
    const res = await createHandler({ anthropic: () => f.client, userClient: () => f.supabase })(post(VALID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      lines: [
        { text: 'ZOTT MONTE', quantity: 2, unit_price_cents: 69, product_id: 'p1', sure: true },
        { text: 'KAFFEE', quantity: 1, unit_price_cents: 499, product_id: null, sure: false },
      ],
      total_cents: 637,
      date: '2026-11-25',
    });
    expect(f.seen.rpcName).toBe('claim_receipt_scan');
    const req = f.seen.requests[0];
    expect(req.model).toBe('claude-opus-5-5');
    expect(req.fallbacks).toBe('default');
    expect(req.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(req.output_config.format).toEqual({ type: 'json_schema', schema: RESULT_SCHEMA });
    expect(req.messages[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'aGFsbG8=' } });
    expect(req.messages[0].content[1].text).toContain('p1 | Yogurt | Milch & Käse | Bon: ZOTT MONTE');
    expect(req).not.toHaveProperty('thinking'); // Opus 5.5: Denken lässt sich nicht abschalten
  });

  it('Haiku ohne serverseitigen Rückfall', async () => {
    const f = fakes({ reply: textReply({ lines: [], total_cents: null, date: null }) });
    await createHandler({ anthropic: () => f.client, userClient: () => f.supabase, model: 'claude-haiku-5-5' })(post(VALID));
    expect(f.seen.requests[0]).not.toHaveProperty('fallbacks');
  });

  it('Ablehnung, abgeschnittene oder kaputte Antwort: 422; API-Fehler: 502', async () => {
    for (const reply of [
      { stop_reason: 'refusal', content: [] },
      { stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"lines": [' }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'kein JSON' }] },
    ]) {
      const f = fakes({ reply });
      const res = await createHandler({ anthropic: () => f.client, userClient: () => f.supabase })(post(VALID));
      expect(res.status).toBe(422);
    }
    const f = fakes({ throws: new Error('overloaded') });
    const res = await createHandler({ anthropic: () => f.client, userClient: () => f.supabase })(post(VALID));
    expect(res.status).toBe(502);
  });
});

describe('Bon-Scan Hilfen', () => {
  it('checkRequest', () => {
    expect(checkRequest(VALID)).toBeNull();
    expect(checkRequest(null)).toBe('body');
    expect(checkRequest({ ...VALID, image: 'x'.repeat(8_000_001) })).toBe('image');
  });
  it('productsText ohne Produkte', () => {
    expect(productsText([])).toContain('(leer)');
  });
  it('cleanResult: Unsinn wird leer, Datum/Summe nur gültig', () => {
    expect(cleanResult('quatsch', [])).toEqual({ lines: [], total_cents: null, date: null });
    expect(cleanResult({ lines: [], total_cents: -5, date: '25.11.2026' }, [])).toEqual({ lines: [], total_cents: null, date: null });
  });
});
