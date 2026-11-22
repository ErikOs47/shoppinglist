import { describe, it, expect, afterEach } from 'vitest';
import { DICT, LANGUAGES, CATEGORY_NAMES, t, setLang, getLang, initialLang, categoryLabel } from '../../src/i18n.js';
import { DEFAULT_CATEGORIES } from '../../src/core/model.js';

afterEach(() => setLang('de'));

describe('Wörterbücher', () => {
  it('jede Sprache hat genau dieselben Texte wie Deutsch', () => {
    const keys = Object.keys(DICT.de).sort();
    for (const { code } of LANGUAGES) {
      expect(Object.keys(DICT[code]).sort(), code).toEqual(keys);
      for (const k of keys) expect(typeof DICT[code][k], `${code}:${k}`).toBe(typeof DICT.de[k]);
    }
  });
  it('Platzhalter stimmen in allen Sprachen überein', () => {
    const ph = (s) => (typeof s === 'string' ? (s.match(/\{\w+\}/g) || []).sort() : []);
    for (const { code } of LANGUAGES) {
      for (const k of Object.keys(DICT.de)) expect(ph(DICT[code][k]), `${code}:${k}`).toEqual(ph(DICT.de[k]));
    }
  });
  it('alle vorgegebenen Kategorien sind übersetzt', () => {
    for (const code of Object.keys(CATEGORY_NAMES)) {
      expect(Object.keys(CATEGORY_NAMES[code]).sort()).toEqual([...DEFAULT_CATEGORIES].sort());
    }
  });
});

describe('t()', () => {
  it('ersetzt Platzhalter', () => {
    expect(t('products.deleted', { name: 'Milch' })).toBe('„Milch“ gelöscht');
    setLang('en');
    expect(t('products.deleted', { name: 'Milk' })).toBe('“Milk” deleted');
  });
  it('Mehrzahl', () => {
    expect(t('sync.pending', { n: 1 })).toBe('1 Änderung wartet');
    expect(t('sync.pending', { n: 3 })).toBe('3 Änderungen warten');
    setLang('en');
    expect(t('finish.message', { done: 1, open: 2 })).toBe('1 checked item will be removed from the list. 2 unbought items stay.');
  });
  it('unbekannter Schlüssel liefert den Schlüssel statt abzustürzen', () => {
    expect(t('gibt.es.nicht')).toBe('gibt.es.nicht');
  });
  it('unbekannte Sprache fällt auf Deutsch zurück', () => {
    expect(setLang('xx')).toBe('de');
    expect(getLang()).toBe('de');
  });
});

describe('Startsprache', () => {
  it('gespeicherte Wahl gewinnt', () => {
    expect(initialLang({ stored: 'en', deviceLangs: ['de-DE'] })).toBe('en');
  });
  it('sonst Gerätesprache, erste unterstützte', () => {
    expect(initialLang({ deviceLangs: ['fr-FR', 'de-AT'] })).toBe('de');
  });
  it('sonst Englisch', () => {
    expect(initialLang({ stored: 'xx', deviceLangs: ['ja-JP'] })).toBe('en');
  });
});

describe('Kategorien', () => {
  it('vorgegebene werden übersetzt angezeigt, eigene nicht', () => {
    expect(categoryLabel('Obst & Gemüse')).toBe('Obst & Gemüse');
    setLang('en');
    expect(categoryLabel('Obst & Gemüse')).toBe('Fruit & Vegetables');
    expect(categoryLabel('Haustier')).toBe('Haustier');
  });
});
