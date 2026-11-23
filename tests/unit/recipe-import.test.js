// Tests der Edge Function „recipe-import“ ohne Netz (fetch wird ersetzt).
import { describe, it, expect } from 'vitest';
import { checkUrl, extractJsonLd, handle } from '../../supabase/functions/recipe-import/index.ts';

const post = (body) =>
  new Request('http://fn/recipe-import', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

describe('checkUrl', () => {
  it('erlaubt öffentliche http(s)-Adressen', () => {
    expect(checkUrl('https://www.chefkoch.de/rezepte/1/x.html').hostname).toBe('www.chefkoch.de');
    expect(checkUrl(' http://example.com ').href).toBe('http://example.com/');
  });
  const blocked = [
    'ftp://example.com/x',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'http://localhost:54321/',
    'http://127.0.0.1/',
    'http://10.0.0.5/',
    'http://169.254.169.254/latest/meta-data',
    'http://192.168.1.1/',
    'http://172.20.0.1/',
    'http://[::1]/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://db.supabase.internal/',
    'http://intranet/',
    'https://example.com:8443/',
    'https://user:pw@example.com/',
    42,
  ];
  for (const u of blocked) {
    it(`sperrt ${u}`, () => expect(() => checkUrl(u)).toThrow());
  }
});

describe('extractJsonLd', () => {
  it('findet alle Blöcke, auch mit Attributen und Großschreibung', () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@type":"WebPage"}</script>
      <SCRIPT data-x="1" type='application/ld+json' >
        {"@type":"Recipe","name":"A"}
      </SCRIPT>
      <script type="text/javascript">var x = 1;</script>
      <script type=application/ld+json><![CDATA[{"@type":"Thing"}]]></script>
    </head></html>`;
    expect(extractJsonLd(html)).toEqual(['{"@type":"WebPage"}', '{"@type":"Recipe","name":"A"}', '{"@type":"Thing"}']);
  });
});

describe('handle', () => {
  const page = '<script type="application/ld+json">{"@type":"Recipe","name":"Suppe"}</script>';

  it('liefert die Blöcke der Seite', async () => {
    const res = await handle(post({ url: 'https://example.com/r' }), async () => new Response(page, { status: 200 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ blocks: ['{"@type":"Recipe","name":"Suppe"}'] });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('folgt Weiterleitungen, prüft aber jedes Ziel', async () => {
    const calls = [];
    const fake = async (url) => {
      calls.push(url);
      if (url === 'https://example.com/a') return new Response(null, { status: 301, headers: { location: '/b' } });
      if (url === 'https://example.com/b') return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/' } });
      return new Response(page);
    };
    const res = await handle(post({ url: 'https://example.com/a' }), fake);
    expect(calls).toEqual(['https://example.com/a', 'https://example.com/b']); // interne Adresse nie abgerufen
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('blocked host');
  });

  it('ungültige Adresse → 400 ohne Abruf', async () => {
    let called = false;
    const res = await handle(post({ url: 'http://localhost/' }), async () => {
      called = true;
      return new Response('');
    });
    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });

  it('Fehlerstatus der Seite wird weitergegeben', async () => {
    const res = await handle(post({ url: 'https://example.com/x' }), async () => new Response('no', { status: 403 }));
    expect(await res.json()).toEqual({ error: 'HTTP 403' });
  });

  it('CORS-Vorabanfrage und falsche Methode', async () => {
    expect((await handle(new Request('http://fn', { method: 'OPTIONS' }))).status).toBe(200);
    expect((await handle(new Request('http://fn', { method: 'GET' }))).status).toBe(405);
  });
});
