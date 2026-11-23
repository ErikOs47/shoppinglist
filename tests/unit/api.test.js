import { describe, it, expect } from 'vitest';
import { classifyError, humanMessage } from '../../src/api.js';

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
