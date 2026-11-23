import { describe, it, expect } from 'vitest';
import {
  emptySnapshot,
  applyOp,
  applyOps,
  applyServerChange,
  cloneSnapshot,
  cleanIngredients,
  cleanUrl,
  validateMeal,
  mealList,
  addDays,
  weekStart,
  isoWeek,
  isoDay,
  weekPlan,
  nextPlanPosition,
  weekIngredients,
  ingredientsToListOps,
} from '../../src/core/model.js';

function snap() {
  const s = emptySnapshot();
  s.products.p1 = { id: 'p1', name: 'Spaghetti', category: 'Vorrat & Konserven' };
  s.products.p2 = { id: 'p2', name: 'Zwiebel', category: 'Obst & Gemüse' };
  s.items.p2 = { id: 'i2', product_id: 'p2', checked: false, position: 1 };
  s.meals.m1 = { id: 'm1', name: 'Bolognese', source_url: null, ingredients: ['Hackfleisch', 'spaghetti', 'Zwiebel'] };
  s.meals.m2 = { id: 'm2', name: 'Curry', source_url: null, ingredients: ['Reis', 'Zwiebel'] };
  return s;
}

describe('Datum', () => {
  it('Woche beginnt am Montag', () => {
    expect(weekStart('2026-11-23')).toBe('2026-11-23'); // Montag
    expect(weekStart('2026-11-29')).toBe('2026-11-23'); // Sonntag
    expect(weekStart('2026-12-02')).toBe('2026-11-30');
  });
  it('Tage addieren über Monats-, Jahres- und Zeitumstellungsgrenzen', () => {
    expect(addDays('2026-12-28', 7)).toBe('2027-01-04');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30'); // Sommerzeit 29.03.2026
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26'); // Winterzeit 25.10.2026
  });
  it('Kalenderwoche nach ISO 8601', () => {
    expect(isoWeek('2026-11-23')).toBe(48);
    expect(isoWeek('2026-01-01')).toBe(1); // Donnerstag
    expect(isoWeek('2027-01-01')).toBe(53); // Freitag gehört zur KW 53 von 2026
    expect(isoWeek('2021-01-03')).toBe(53);
  });
  it('isoDay nutzt die lokale Uhrzeit', () => {
    expect(isoDay(new Date(2026, 10, 23, 23, 59))).toBe('2026-11-23');
  });
});

describe('Gerichte bearbeiten', () => {
  it('Zutaten bereinigen: leer, doppelt, Leerzeichen', () => {
    expect(cleanIngredients([' Mehl ', '', 'mehl', 'Back  pulver', null])).toEqual(['Mehl', 'Back pulver']);
    expect(cleanIngredients(Array.from({ length: 150 }, (_, i) => `Z${i}`))).toHaveLength(100);
  });
  it('nur http(s)-Links', () => {
    expect(cleanUrl('https://example.com/a b')).toBe('https://example.com/a%20b');
    expect(cleanUrl('javascript:alert(1)')).toBeNull();
    expect(cleanUrl('')).toBeNull();
  });
  it('validateMeal', () => {
    const s = snap();
    expect(validateMeal(s, { name: ' ' })).toBe('Bitte einen Namen eingeben.');
    expect(validateMeal(s, { name: 'bolognese' })).toBe('„Bolognese“ gibt es schon.');
    expect(validateMeal(s, { id: 'm1', name: 'Bolognese' })).toBeNull();
    expect(validateMeal(s, { name: 'Neu', sourceUrl: 'ftp://x' })).toBe('Der Link muss mit https:// beginnen.');
  });
  it('Suche nach Name oder Zutat', () => {
    expect(mealList(snap(), 'reis').map((m) => m.name)).toEqual(['Curry']);
    expect(mealList(snap()).map((m) => m.name)).toEqual(['Bolognese', 'Curry']);
  });
});

describe('Wochenplan', () => {
  it('Gericht planen und wieder entfernen', () => {
    let s = snap();
    s = applyOps(s, [
      { type: 'planMeal', id: 'e1', mealId: 'm1', day: '2026-11-24', position: 1, at: '2026-11-23T10:00:00Z' },
      { type: 'planMeal', id: 'e2', mealId: 'm2', day: '2026-11-24', position: 2, at: '2026-11-23T10:00:01Z' },
      { type: 'planMeal', id: 'e3', mealId: 'm2', day: '2026-11-30', position: 1, at: '2026-11-23T10:00:02Z' },
    ]);
    const week = weekPlan(s, '2026-11-23');
    expect(week.map((d) => d.day)).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29']);
    expect(week[1].entries.map((e) => e.name)).toEqual(['Bolognese', 'Curry']);
    expect(week.flatMap((d) => d.entries)).toHaveLength(2); // e3 liegt in der nächsten Woche
    expect(nextPlanPosition(s, '2026-11-24')).toBe(3);
    applyOp(s, { type: 'unplanMeal', id: 'e1' });
    expect(weekPlan(s, '2026-11-23')[1].entries.map((e) => e.name)).toEqual(['Curry']);
  });

  it('Gericht löschen entfernt es aus dem Plan (wie ON DELETE CASCADE)', () => {
    const s = snap();
    applyOp(s, { type: 'planMeal', id: 'e1', mealId: 'm1', day: '2026-11-24', at: 'x' });
    applyOp(s, { type: 'deleteMeal', id: 'm1' });
    expect(s.plan).toEqual({});
  });

  it('Planen eines (inzwischen) gelöschten Gerichts wird ignoriert', () => {
    const s = snap();
    applyOp(s, { type: 'planMeal', id: 'e1', mealId: 'weg', day: '2026-11-24', at: 'x' });
    expect(s.plan).toEqual({});
  });

  it('Realtime: Gericht gelöscht → Planeinträge weg, Planeintrag eingefügt', () => {
    let s = snap();
    s = applyServerChange(s, 'meal_plan', 'INSERT', { id: 'e1', meal_id: 'm1', day: '2026-11-24', position: 1 });
    expect(s.plan.e1.meal_id).toBe('m1');
    s = applyServerChange(s, 'meals', 'DELETE', null, { id: 'm1' });
    expect(s.meals.m1).toBeUndefined();
    expect(s.plan).toEqual({});
    s = applyServerChange(s, 'meals', 'UPDATE', { id: 'm2', name: 'Curry', ingredients: null });
    expect(s.meals.m2.ingredients).toEqual([]);
  });

  it('Zwischenspeicher älterer App-Versionen ohne meals/plan', () => {
    const old = { products: {}, items: {} };
    const s = cloneSnapshot(old);
    expect(s.meals).toEqual({});
    expect(() => applyOp(s, { type: 'upsertMeal', meal: { id: 'm', name: 'X', ingredients: [] } })).not.toThrow();
  });
});

describe('Zutaten auf den Zettel', () => {
  function weekWithBoth() {
    const s = snap();
    applyOp(s, { type: 'planMeal', id: 'e1', mealId: 'm1', day: '2026-11-24', at: 'a' });
    applyOp(s, { type: 'planMeal', id: 'e2', mealId: 'm2', day: '2026-11-25', at: 'b' });
    return s;
  }

  it('fasst Zutaten der Woche zusammen und kennt Produkt und Zettel', () => {
    const s = weekWithBoth();
    const rows = weekIngredients(s, weekPlan(s, '2026-11-23'));
    expect(rows.map((r) => [r.name, r.meals.join('+'), r.productId, r.onList])).toEqual([
      ['Hackfleisch', 'Bolognese', null, false],
      ['Reis', 'Curry', null, false],
      ['Spaghetti', 'Bolognese', 'p1', false], // Schreibweise des Produkts
      ['Zwiebel', 'Bolognese+Curry', 'p2', true],
    ]);
  });

  it('legt fehlende Produkte an und fügt hinten an; vorhandene nicht doppelt', () => {
    const s = weekWithBoth();
    let n = 0;
    const ops = ingredientsToListOps(s, ['Hackfleisch', 'Spaghetti', 'Zwiebel', 'hackfleisch'], () => `id${++n}`);
    expect(ops).toEqual([
      { type: 'upsertProduct', isNew: true, product: { id: 'id1', name: 'Hackfleisch', category: 'Sonstiges' } },
      { type: 'addToList', id: 'id2', productId: 'id1', position: 2 },
      { type: 'addToList', id: 'id3', productId: 'p1', position: 3 },
    ]);
    const after = applyOps(s, ops);
    expect(Object.keys(after.items).sort()).toEqual(['id1', 'p1', 'p2']);
  });

  it('gleichzeitig vom Partner angelegtes Produkt wird zusammengeführt (Alias in applyOps)', () => {
    const s = weekWithBoth();
    let n = 0;
    const ops = ingredientsToListOps(s, ['Reis'], () => `id${++n}`);
    // Inzwischen kommt „Reis“ vom Partner per Realtime
    const server = applyServerChange(s, 'products', 'INSERT', { id: 'pr', name: 'Reis', category: 'Vorrat & Konserven' });
    const view = applyOps(server, ops);
    expect(Object.values(view.products).filter((p) => p.name === 'Reis')).toHaveLength(1);
    expect(view.items.pr).toBeTruthy();
  });
});
