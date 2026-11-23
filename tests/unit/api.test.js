import { describe, it, expect } from 'vitest';
import { classifyError, humanMessage, fetchRecipeBlocks, createBackend } from '../../src/api.js';

describe('Fehlermeldungen', () => {
  it('fehlende Tabelle: Hinweis auf das SQL-Skript statt „Keine Verbindung“', () => {
    const err = { code: 'PGRST205', message: "Could not find the table 'public.households' in the schema cache" };
    expect(classifyError(err, 404)).toBe('permanent');
    expect(humanMessage(err)).toMatch(/Datenbank ist nicht eingerichtet/);
    expect(humanMessage(err)).toMatch(/SQL/);
  });
  it('fehlende Tabelle direkt aus Postgres (42P01) ebenso', () => {
    expect(humanMessage({ code: '42P01', message: 'relation "public.households" does not exist' })).toMatch(
      /Datenbank ist nicht eingerichtet/,
    );
  });
  it('Netzwerkfehler bleiben „vorübergehend“', () => {
    expect(classifyError({ code: '', message: 'TypeError: Load failed' }, 0)).toBe('transient');
    expect(humanMessage({ message: 'TypeError: Load failed' })).toBe('Keine Verbindung zum Server.');
  });
});

describe('Meldungen der Datenbank-Funktionen', () => {
  it('werden in die gewählte Sprache übersetzt', async () => {
    const { setLang } = await import('../../src/i18n.js');
    const full = { code: 'P0001', message: 'Haushalt hat bereits zwei Mitglieder' };
    expect(humanMessage(full)).toBe('Haushalt hat bereits zwei Mitglieder');
    setLang('en');
    expect(humanMessage(full)).toBe('This household already has two members');
    expect(humanMessage({ code: 'P0001', message: 'Einladungscode ungültig' })).toBe('Invalid invite code');
    setLang('pt');
    expect(humanMessage({ code: 'P0001', message: 'Du bist bereits in diesem Haushalt' })).toBe('Já estás nesta casa');
    setLang('de');
  });
});

describe('fetchRecipeBlocks', () => {
  const fakeSupabase = (result) => ({ functions: { invoke: async () => result } });
  const httpError = (status, body) => ({
    name: 'FunctionsHttpError',
    message: 'Edge Function returned a non-2xx status code',
    context: new Response(JSON.stringify(body), { status }),
  });

  it('liefert die Blöcke', async () => {
    expect(await fetchRecipeBlocks(fakeSupabase({ data: { blocks: ['{}'] }, error: null }), 'https://x.example')).toEqual(['{}']);
  });
  it('404: Funktion nicht eingerichtet', async () => {
    await expect(
      fetchRecipeBlocks(fakeSupabase({ data: null, error: httpError(404, { code: 'NOT_FOUND', message: 'Requested function was not found' }) }), 'https://x'),
    ).rejects.toThrow('Der Import ist noch nicht eingerichtet');
  });
  it('Fehlertext der Funktion wird angezeigt', async () => {
    await expect(fetchRecipeBlocks(fakeSupabase({ data: null, error: httpError(502, { error: 'HTTP 403' }) }), 'https://x')).rejects.toThrow(
      'Rezept konnte nicht geladen werden: HTTP 403',
    );
    await expect(fetchRecipeBlocks(fakeSupabase({ data: null, error: httpError(503, { message: 'name resolution failed' }) }), 'https://x')).rejects.toThrow(
      'Rezept konnte nicht geladen werden: name resolution failed',
    );
  });
  it('kein Netz', async () => {
    await expect(fetchRecipeBlocks(fakeSupabase({ data: null, error: { name: 'FunctionsFetchError', message: 'Failed to send a request' } }), 'https://x')).rejects.toThrow(
      'Für den Import wird eine Internetverbindung gebraucht.',
    );
  });
});

describe('fetchAll vor dem SQL-Update für Gerichte', () => {
  // Nachbildung des Supabase-Abfrage-Builders: from().select().eq().order().range()
  function fakeSupabase(missing) {
    const rows = { products: [{ id: 'p1', name: 'Milch', category: 'Sonstiges' }], list_items: [] };
    return {
      from(table) {
        const result = missing.includes(table)
          ? { data: null, status: 404, error: { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` } }
          : { data: rows[table] ?? [], status: 200, error: null };
        const q = { select: () => q, eq: () => q, order: () => q, range: () => Promise.resolve(result) };
        return q;
      },
    };
  }

  it('fehlende Tabellen meals/meal_plan: Produkte laden trotzdem, Gerichte leer', async () => {
    const snap = await createBackend(fakeSupabase(['meals', 'meal_plan']), 'h1').fetchAll();
    expect(Object.keys(snap.products)).toEqual(['p1']);
    expect(snap.meals).toEqual({});
  });

  it('fehlende Produkt-Tabelle bleibt ein Fehler mit Hinweis', async () => {
    await expect(createBackend(fakeSupabase(['products']), 'h1').fetchAll()).rejects.toThrow('Datenbank');
  });
});
