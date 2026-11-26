import { describe, it, expect } from 'vitest';
import { emptySnapshot, applyOp, applyServerChange, clampQuantity, listEstimate, shoppingView } from '../../src/core/model.js';
import { createBackend } from '../../src/api.js';

function snap() {
  const s = emptySnapshot();
  s.products.p1 = { id: 'p1', name: 'Eier', category: 'x', price_cents: 30 };
  s.products.p2 = { id: 'p2', name: 'Milch', category: 'x', price_cents: null };
  return s;
}

describe('Menge begrenzen', () => {
  it('1–99, Unsinn und Fehlendes = 1', () => {
    expect(clampQuantity(5)).toBe(5);
    expect(clampQuantity(0)).toBe(1);
    expect(clampQuantity(-3)).toBe(1);
    expect(clampQuantity(100)).toBe(99);
    expect(clampQuantity(2.7)).toBe(2);
    expect(clampQuantity(undefined)).toBe(1);
    expect(clampQuantity('abc')).toBe(1);
  });
});

describe('Operation setQuantity', () => {
  it('neuer Eintrag hat Menge 1; Ändern bleibt in 1–99; unbekannter Eintrag wird ignoriert', () => {
    const s = snap();
    applyOp(s, { type: 'addToList', id: 'i1', productId: 'p1', position: 1, at: 'a' });
    expect(s.items.p1.quantity).toBe(1);
    applyOp(s, { type: 'setQuantity', productId: 'p1', quantity: 6 });
    expect(s.items.p1.quantity).toBe(6);
    applyOp(s, { type: 'setQuantity', productId: 'p1', quantity: 0 });
    expect(s.items.p1.quantity).toBe(1);
    applyOp(s, { type: 'setQuantity', productId: 'p2', quantity: 3 });
    expect(s.items.p2).toBeUndefined();
  });

  it('Realtime ohne Spalte (altes Schema) → 1; Ansicht kennt die Menge', () => {
    let s = applyServerChange(snap(), 'list_items', 'INSERT', { id: 'i1', product_id: 'p1', checked: false, position: 1 });
    expect(s.items.p1.quantity).toBe(1);
    s = applyServerChange(s, 'list_items', 'UPDATE', { id: 'i1', product_id: 'p1', checked: false, position: 1, quantity: 4 });
    expect(shoppingView(s).open[0]).toMatchObject({ name: 'Eier', quantity: 4 });
  });
});

describe('Schätzung mit Mengen', () => {
  it('Preis × Menge; Einträge ohne Preis zählen einmal als fehlend', () => {
    const s = snap();
    s.items.p1 = { id: 'i1', product_id: 'p1', checked: false, quantity: 10 };
    s.items.p2 = { id: 'i2', product_id: 'p2', checked: true, quantity: 3 };
    expect(listEstimate(s)).toEqual({ total: 300, priced: 1, missing: 1 });
  });
});

describe('API vor dem SQL-Update für Mengen', () => {
  function fakeSupabase({ quantityColumn }) {
    const calls = [];
    return {
      calls,
      from(table) {
        let cols = '';
        const q = {
          select: (c) => ((cols = c), calls.push(`${table}:${c}`), q),
          eq: () => q,
          order: () => q,
          range: () =>
            Promise.resolve(
              table === 'list_items' && !quantityColumn && cols.includes('quantity')
                ? { data: null, status: 400, error: { code: '42703', message: 'column list_items.quantity does not exist' } }
                : { data: table === 'list_items' ? [{ id: 'i1', product_id: 'p1', checked: false }] : [{ id: 'p1', name: 'Eier', category: 'x' }], status: 200, error: null },
            ),
          update: (patch) => ({
            eq: () =>
              Promise.resolve(
                quantityColumn
                  ? { data: null, status: 204, error: null, patch }
                  : { data: null, status: 400, error: { code: 'PGRST204', message: "Could not find the 'quantity' column" } },
              ),
          }),
        };
        return q;
      },
    };
  }

  it('Zettel lädt trotzdem, Menge 1', async () => {
    const sb = fakeSupabase({ quantityColumn: false });
    const s = await createBackend(sb, 'h1').fetchAll();
    expect(s.items.p1.quantity).toBe(1);
    expect(sb.calls.filter((c) => c.startsWith('list_items:'))).toHaveLength(2);
  });

  it('Menge ändern: dauerhafter Fehler mit Hinweis auf Schritt 12', async () => {
    await expect(
      createBackend(fakeSupabase({ quantityColumn: false }), 'h1').execute({ type: 'setQuantity', productId: 'p1', quantity: 2 }),
    ).rejects.toMatchObject({ kind: 'permanent', message: expect.stringMatching(/Schritt 12/) });
  });

  it('mit Spalte: ein Abruf, Ändern klappt', async () => {
    const sb = fakeSupabase({ quantityColumn: true });
    await createBackend(sb, 'h1').fetchAll();
    expect(sb.calls.filter((c) => c.startsWith('list_items:'))).toEqual(['list_items:id,product_id,checked,position,created_at,updated_at,quantity']);
    await expect(createBackend(sb, 'h1').execute({ type: 'setQuantity', productId: 'p1', quantity: 2 })).resolves.toBeUndefined();
  });
});
