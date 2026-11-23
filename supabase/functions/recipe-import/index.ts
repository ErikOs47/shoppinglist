// Edge Function „recipe-import“: holt eine Rezeptseite und gibt die
// eingebetteten Rezeptdaten (<script type="application/ld+json">) zurück.
//
// Warum ein Server-Teil: Browser dürfen fremde Seiten wegen CORS nicht selbst
// auslesen. Ausgewertet werden die Blöcke im Client (src/core/recipe.js), damit
// diese Funktion klein bleibt.
//
// Absicherung:
// - Nur angemeldete Nutzer: Supabase prüft das JWT vor dem Aufruf („Verify JWT“
//   bleibt an, Standard).
// - Nur http(s) auf Port 80/443, keine IP-Adressen aus privaten Netzen und
//   keine internen Namen; Weiterleitungen werden einzeln geprüft.
// - Zeitlimit 10 s, höchstens 3 MB werden gelesen.
//
// Bewusst eine einzige Datei ohne Imports, damit sie sich im Supabase-
// Dashboard per Kopieren/Einfügen anlegen lässt (siehe SETUP.md).

export const MAX_BYTES = 3_000_000;
const MAX_BLOCKS = 20;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 10_000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** IPv4-Adresse aus privaten, lokalen oder reservierten Netzen? */
function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

/**
 * Prüft die Adresse und gibt sie normalisiert zurück; wirft sonst einen
 * Fehler. Hinweis: Ein öffentlicher Name, der per DNS auf eine interne Adresse
 * zeigt, wird hier nicht erkannt (Name wird erst beim Abruf aufgelöst).
 */
export function checkUrl(raw: unknown): URL {
  if (typeof raw !== 'string' || raw.length > 2000) throw new Error('invalid url');
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('invalid url');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('invalid url');
  if (url.username || url.password) throw new Error('invalid url');
  if (url.port && url.port !== '80' && url.port !== '443') throw new Error('blocked host');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    !host.includes('.') ||
    host.startsWith('[') || // IPv6-Literal
    /^\d+$/.test(host) || // Zahl als Adresse (z. B. 2130706433)
    /^0x/i.test(host) ||
    isPrivateIPv4(host) ||
    /(^|\.)(localhost|local|internal|intranet|lan|home|corp|svc|cluster)$/.test(host) ||
    host.endsWith('.supabase.internal')
  ) {
    throw new Error('blocked host');
  }
  return url;
}

/** Inhalte aller <script type="application/ld+json">-Blöcke. */
export function extractJsonLd(html: string): string[] {
  const out: string[] = [];
  const re = /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < MAX_BLOCKS) {
    const text = m[1].trim().replace(/^<!\[CDATA\[|\]\]>$/g, '').trim();
    if (text) out.push(text);
  }
  return out;
}

async function readLimited(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) {
      await reader.cancel();
      break; // JSON-LD steht fast immer im <head>; der Anfang reicht
    }
    chunks.push(value);
  }
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.length;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(all);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

export async function handle(req: Request, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let url: URL;
  try {
    const body = await req.json();
    url = checkUrl(body?.url);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'invalid request' }, 400);
  }

  try {
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      res = await fetchImpl(url.href, {
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Einkauf-App recipe import)',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'de,en;q=0.8,pt;q=0.6',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel();
        url = checkUrl(new URL(location, url).href); // jede Weiterleitung erneut prüfen
        res = null;
        continue;
      }
      break;
    }
    if (!res) return json({ error: 'too many redirects' }, 502);
    if (!res.ok) {
      await res.body?.cancel();
      return json({ error: `HTTP ${res.status}` }, 502);
    }
    const html = await readLimited(res);
    return json({ blocks: extractJsonLd(html) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: /blocked host|invalid url/.test(msg) ? msg : 'fetch failed' }, 502);
  }
}

// In Supabase (Deno) starten; beim Import in Tests (Node) nicht.
// deno-lint-ignore no-explicit-any
const deno = (globalThis as any).Deno;
if (deno?.serve) deno.serve((req: Request) => handle(req));
