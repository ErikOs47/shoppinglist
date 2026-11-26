import { describe, it, expect } from 'vitest';
import {
  emptySnapshot,
  applyOp,
  applyOps,
  applyServerChange,
  cloneSnapshot,
  cleanProductIds,
  cleanUrl,
  mealIngredients,
  ingredientChoices,
  remapProductId,
  validateMeal,
  mealList,
  addDays,
  weekStart,
  isoWeek,
  isoDay,
  weekPlan,
  nextPlanPosition,
  weekIngredients,
  upcomingDays,
  productsToListOps,
} from '../../src/core/model.js';

function snap() {
  const s = emptySnapshot();
  s.products.p1 = { id: 'p1', name: 'Spaghetti', category: 'Vorrat & Konserven' };
  s.products.p2 = { id: 'p2', name: 'Zwiebel', category: 'Obst & Gemüse' };
  s.products.p3 = { id: 'p3', name: 'Hackfleisch', category: 'Fleisch & Fisch' };
  s.products.p4 = { id: 'p4', name: 'Reis', category: 'Vorrat & Konserven' };
  s.items.p2 = { id: 'i2', product_id: 'p2', checked: false, position: 1 };
  s.meals.m1 = { id: 'm1', name: 'Bolognese', source_url: null, product_ids: ['p3', 'p1', 'p2'] };
  s.meals.m2 = { id: 'm2', name: 'Curry', source_url: null, product_ids: ['p4', 'p2'] };
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
  it('Zutaten-ids bereinigen: leer, doppelt, höchstens 100', () => {
    expect(cleanProductIds(['a', '', 'b', 'a', null])).toEqual(['a', 'b']);
    expect(cleanProductIds(Array.from({ length: 150 }, (_, i) => `id${i}`))).toHaveLength(100);
  });
  it('Zutaten als Produkte: Umbenennen wirkt sofort, gelöschte Produkte fallen weg', () => {
    const s = snap();
    expect(mealIngredients(s, s.meals.m1).map((p) => p.name)).toEqual(['Hackfleisch', 'Spaghetti', 'Zwiebel']);
    applyOp(s, { type: 'upsertProduct', product: { id: 'p1', name: 'Penne', category: 'Vorrat & Konserven' } });
    applyOp(s, { type: 'deleteProduct', id: 'p3' });
    expect(mealIngredients(s, s.meals.m1).map((p) => p.name)).toEqual(['Penne', 'Zwiebel']);
  });
  it('Auswahlliste: alphabetisch, Suche, gewählte markiert', () => {
    const s = snap();
    expect(ingredientChoices(s, ['p2']).map((c) => `${c.name}:${c.selected}`)).toEqual([
      'Hackfleisch:false',
      'Reis:false',
      'Spaghetti:false',
      'Zwiebel:true',
    ]);
    expect(ingredientChoices(s, [], 'ZWI').map((c) => c.name)).toEqual(['Zwiebel']);
  });
  it('offline doppelt angelegtes Produkt: Gericht zeigt danach auf das vorhandene', () => {
    const ops = [{ type: 'upsertMeal', isNew: true, meal: { id: 'm9', name: 'X', source_url: null, product_ids: ['lokal', 'p2', 'vorhanden'] } }];
    const [op] = remapProductId(ops, 'lokal', 'vorhanden');
    expect(op.meal.product_ids).toEqual(['vorhanden', 'p2']);
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
    expect(mealList(snap(), 'reis').map((m) => m.name)).toEqual(['Curry']); // über den Produktnamen
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
    s = applyServerChange(s, 'meals', 'UPDATE', { id: 'm2', name: 'Curry', product_ids: null });
    expect(s.meals.m2.product_ids).toEqual([]);
  });

  it('Zwischenspeicher älterer App-Versionen ohne meals/plan', () => {
    const old = { products: {}, items: {} };
    const s = cloneSnapshot(old);
    expect(s.meals).toEqual({});
    expect(() => applyOp(s, { type: 'upsertMeal', meal: { id: 'm', name: 'X', product_ids: [] } })).not.toThrow();
  });
});

describe('Zutaten auf den Zettel', () => {
  function weekWithBoth() {
    const s = snap();
    applyOp(s, { type: 'planMeal', id: 'e1', mealId: 'm1', day: '2026-11-24', at: 'a' });
    applyOp(s, { type: 'planMeal', id: 'e2', mealId: 'm2', day: '2026-11-25', at: 'b' });
    return s;
  }

  it('fasst Zutaten der Woche zusammen und kennt den Zettel', () => {
    const s = weekWithBoth();
    const rows = weekIngredients(s, weekPlan(s, '2026-11-23'));
    expect(rows.map((r) => [r.name, r.meals.join('+'), r.onList])).toEqual([
      ['Hackfleisch', 'Bolognese', false],
      ['Reis', 'Curry', false],
      ['Spaghetti', 'Bolognese', false],
      ['Zwiebel', 'Bolognese+Curry', true],
    ]);
  });

  it('nur heute und folgende Tage: Zutaten von gestern fallen weg', () => {
    const s = weekWithBoth(); // Bolognese Di 24.11., Curry Mi 25.11.
    const rows = weekIngredients(s, upcomingDays(weekPlan(s, '2026-11-23'), '2026-11-25'));
    expect(rows.map((r) => [r.name, r.meals.join('+')])).toEqual([
      ['Reis', 'Curry'],
      ['Zwiebel', 'Curry'],
    ]);
    expect(upcomingDays(weekPlan(s, '2026-11-23'), '2026-11-30')).toEqual([]); // ganze Woche vorbei
    expect(upcomingDays(weekPlan(s, '2026-11-23'), '2026-11-20')).toHaveLength(7); // Woche liegt in der Zukunft
  });

  it('fügt gewählte Produkte hinten an; was drauf steht oder gelöscht ist, wird übersprungen', () => {
    const s = weekWithBoth();
    let n = 0;
    const ops = productsToListOps(s, ['p3', 'p1', 'p2', 'p3', 'weg'], () => `id${++n}`);
    expect(ops).toEqual([
      { type: 'addToList', id: 'id1', productId: 'p3', position: 2 },
      { type: 'addToList', id: 'id2', productId: 'p1', position: 3 },
    ]);
    expect(Object.keys(applyOps(s, ops).items).sort()).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('Gericht im Wochenplan verschieben', () => {
  it('ändert Tag und Position, unbekannter Eintrag wird ignoriert', () => {
    const s = emptySnapshot();
    s.meals.m1 = { id: 'm1', name: 'Curry', product_ids: [] };
    applyOp(s, { type: 'planMeal', id: 'e1', mealId: 'm1', day: '2026-11-23', position: 1, at: 'a' });
    applyOp(s, { type: 'movePlan', id: 'e1', day: '2026-11-25', position: 0.5 });
    applyOp(s, { type: 'movePlan', id: 'weg', day: '2026-11-25', position: 1 });
    expect(Object.values(s.plan)).toEqual([{ id: 'e1', meal_id: 'm1', day: '2026-11-25', position: 0.5, created_at: 'a' }]);
    expect(weekPlan(s, '2026-11-23')[2].entries.map((e) => e.name)).toEqual(['Curry']);
  });
});
