import { describe, it, expect } from 'vitest';
import { classifyError, humanMessage, createBackend } from '../../src/api.js';

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

describe('Meldung bei fehlender Gerichte-Tabelle', () => {
  it('verweist auf das Update (Schritt 8), nicht auf die Neueinrichtung', () => {
    const msg = humanMessage({ code: 'PGRST205', message: "Could not find the table 'public.meals' in the schema cache" });
    expect(msg).toContain('20261124000000_meals.sql');
    expect(humanMessage({ code: 'PGRST205', message: "Could not find the table 'public.products' in the schema cache" })).toContain('20261121000000_init.sql');
  });
});

describe('Meldung bei fehlender Ausgaben-Tabelle', () => {
  it('verweist auf das Update (Schritt 9)', () => {
    const msg = humanMessage({ code: 'PGRST205', message: "Could not find the table 'public.expenses' in the schema cache" });
    expect(msg).toContain('20261125000000_expenses.sql');
  });
});
