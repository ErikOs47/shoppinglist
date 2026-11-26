// Supabase Edge Function „receipt-scan“: liest ein Bon-Foto mit Claude und
// ordnet die Positionen den Produkten des Haushalts zu.
//
// Geheimnis (Supabase → Edge Functions → Secrets): ANTHROPIC_API_KEY
// Optional: RECEIPT_MODEL (Standard claude-opus-5-5)
// SUPABASE_URL und SUPABASE_PUBLISHABLE_KEYS (bzw. das ältere SUPABASE_ANON_KEY)
// stellt Supabase selbst bereit.
//
// verify_jwt ist aus (supabase/config.toml): Die Funktion prüft selbst. Ohne
// gültiges Nutzer-Token scheitert claim_receipt_scan(), bevor Claude gefragt wird.

import Anthropic from 'npm:@anthropic-ai/sdk@1.14.0';
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';
import { createHandler } from './handler.js';
import { DEFAULT_MODEL } from './receipt.js';

// Neuer „publishable“-Schlüssel, sonst der alte anon-Schlüssel (gilt laut Supabase bis Ende 2026)
function publicKey(): string {
  const keys = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  if (keys) {
    try {
      const k = JSON.parse(keys).default;
      if (k) return k;
    } catch {
      // ungültiges JSON: auf den alten Schlüssel zurückfallen
    }
  }
  return Deno.env.get('SUPABASE_ANON_KEY')!;
}

const handle = createHandler({
  anthropic: () => {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    return apiKey ? new Anthropic({ apiKey }) : null;
  },
  userClient: (authHeader: string) =>
    createClient(Deno.env.get('SUPABASE_URL')!, publicKey(), {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  model: Deno.env.get('RECEIPT_MODEL') || DEFAULT_MODEL,
  log: (msg: string, err?: unknown) => console.error(`receipt-scan: ${msg}`, err ?? ''),
});

Deno.serve(handle);
