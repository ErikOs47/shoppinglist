import { describe, it, expect } from 'vitest';
import {
  emptySnapshot,
  applyOp,
  applyOps,
  applyServerChange,
  cloneSnapshot,
  parseAmount,
  addMonths,
  expenseStats,
} from '../../src/core/model.js';

describe('Betrag einlesen', () => {
  const ok = [
    ['23,40', 2340],
    ['23.40', 2340],
    ['23', 2300],
    ['0,5', 50],
    [' 23,4 € ', 2340],
    ['1.234,50', 123450],
    ['1000000', 100000000],
  ];
  for (const [input, cents] of ok) it(`„${input}“ → ${cents} Cent`, () => expect(parseAmount(input)).toBe(cents));
  for (const bad of ['', '  ', 'abc', '0', '0,00', '-5', '23,456', '1,2,3', '1000000,01', null]) {
    it(`„${bad}“ ist ungültig`, () => expect(parseAmount(bad)).toBeNull());
  }
  it('keine Rundungsfehler bei typischen Beträgen', () => {
    expect(parseAmount('19,99')).toBe(1999);
    expect(parseAmount('0,07')).toBe(7);
    expect(parseAmount('4,35')).toBe(435);
  });
});

describe('Monate rechnen', () => {
  it('über Jahresgrenzen', () => {
    expect(addMonths('2026-11', 1)).toBe('2026-12');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-11', -13)).toBe('2025-10');
  });
});

function snapWith(list) {
  const s = emptySnapshot();
  for (const [id, cents, day, created = '2026-11-01T10:00:00Z'] of list) {
    s.expenses[id] = { id, amount_cents: cents, spent_on: day, note: null, created_at: created };
  }
  return s;
}

describe('Statistik', () => {
  // Mittwoch, 25.11.2026 – Woche ab Mo 23.11.
  const today = '2026-11-25';
  const s = snapWith([
    ['a', 2340, '2026-11-23'], // diese Woche (Mo)
    ['b', 510, '2026-11-29'], // diese Woche (So)
    ['c', 1000, '2026-11-22'], // Vorwoche (So), noch November
    ['d', 4000, '2026-10-31'], // Oktober
    ['e', 700, '2026-12-01'], // Zukunft: nächster Monat, nächste Woche
  ]);
  const st = expenseStats(s, today, { weeks: 4, months: 3 });

  it('Woche Mo–So und Vorwoche', () => {
    expect(st.week).toEqual({ key: '2026-11-23', total: 2850, prev: 1000 });
  });
  it('Kalendermonat und Vormonat', () => {
    expect(st.month).toEqual({ key: '2026-11', total: 3850, prev: 4000 });
  });
  it('Verlauf: älteste zuerst, leere Perioden mit 0, Zukunft nicht im Verlauf', () => {
    expect(st.weeks).toEqual([
      { key: '2026-11-02', total: 0 },
      { key: '2026-11-09', total: 0 },
      { key: '2026-11-16', total: 1000 },
      { key: '2026-11-23', total: 2850 },
    ]);
    expect(st.months).toEqual([
      { key: '2026-09', total: 0 },
      { key: '2026-10', total: 4000 },
      { key: '2026-11', total: 3850 },
    ]);
  });
  it('Einträge je Periode, neueste zuerst', () => {
    expect(st.byWeek.get('2026-11-23').map((x) => x.id)).toEqual(['b', 'a']);
    expect(st.byMonth.get('2026-11').map((x) => x.id)).toEqual(['b', 'a', 'c']);
    expect(st.count).toBe(5);
  });
  it('gleicher Tag: zuletzt erfasst zuerst', () => {
    const s2 = snapWith([
      ['x', 100, '2026-11-24', '2026-11-24T08:00:00Z'],
      ['y', 200, '2026-11-24', '2026-11-24T18:00:00Z'],
    ]);
    expect(expenseStats(s2, today).byWeek.get('2026-11-23').map((x) => x.id)).toEqual(['y', 'x']);
  });
  it('ohne Ausgaben alles 0', () => {
    const e = expenseStats(emptySnapshot(), today);
    expect(e.week.total + e.month.total + e.count).toBe(0);
    expect(e.weeks).toHaveLength(8);
    expect(e.months).toHaveLength(6);
  });
});

describe('Ausgaben-Operationen', () => {
  it('anlegen, ändern, löschen', () => {
    let s = applyOps(emptySnapshot(), [
      { type: 'upsertExpense', isNew: true, expense: { id: 'x', amount_cents: 2340, spent_on: '2026-11-25', note: null }, at: 't1' },
      { type: 'upsertExpense', expense: { id: 'x', amount_cents: 2500, spent_on: '2026-11-24', note: 'Markt' }, at: 't2' },
    ]);
    expect(s.expenses.x).toEqual({ id: 'x', amount_cents: 2500, spent_on: '2026-11-24', note: 'Markt', created_at: 't1' });
    applyOp(s, { type: 'deleteExpense', id: 'x' });
    expect(s.expenses).toEqual({});
  });
  it('Realtime: Einfügen und Löschen', () => {
    let s = applyServerChange(emptySnapshot(), 'expenses', 'INSERT', { id: 'r', amount_cents: 999, spent_on: '2026-11-25', note: null });
    expect(s.expenses.r.amount_cents).toBe(999);
    s = applyServerChange(s, 'expenses', 'DELETE', null, { id: 'r' });
    expect(s.expenses).toEqual({});
  });
  it('Zwischenspeicher älterer App-Versionen ohne Ausgaben', () => {
    const s = cloneSnapshot({ products: {}, items: {}, meals: {}, plan: {} });
    expect(s.expenses).toEqual({});
    expect(() => applyOp(s, { type: 'deleteExpense', id: 'x' })).not.toThrow();
  });
});
