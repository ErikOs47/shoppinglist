import { describe, it, expect } from 'vitest';
import {
  emptySnapshot,
  applyOp,
  applyOps,
  applyServerChange,
  remapProductId,
  parsePrice,
  listEstimate,
  mealCost,
  normalizeReceiptName,
  addReceiptName,
  matchReceiptLines,
  priceOps,
} from '../../src/core/model.js';
import { createBackend, isMissingColumn } from '../../src/api.js';

function snap() {
  const s = emptySnapshot();
  s.products.p1 = { id: 'p1', name: 'Yogurt', category: 'Milch & Käse', price_cents: 59, receipt_names: ['ZOTT MONTE'] };
  s.products.p2 = { id: 'p2', name: 'Milk', category: 'Milch & Käse', price_cents: null, receipt_names: [] };
  s.products.p3 = { id: 'p3', name: 'Brot', category: 'Brot & Backwaren', price_cents: 250, receipt_names: [] };
  s.items.p1 = { id: 'i1', product_id: 'p1', checked: false, position: 1 };
  s.items.p2 = { id: 'i2', product_id: 'p2', checked: true, position: 2 };
  s.items.p3 = { id: 'i3', product_id: 'p3', checked: true, position: 3 };
  return s;
}

describe('Preis eingeben', () => {
  it('wie Beträge, aber höchstens 10.000 €', () => {
    expect(parsePrice('0,59')).toBe(59);
    expect(parsePrice('2.50 €')).toBe(250);
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('0')).toBeNull();
    expect(parsePrice('10000')).toBe(1_000_000);
    expect(parsePrice('10000,01')).toBeNull();
  });
});

describe('Schätzung für den Zettel', () => {
  it('summiert bekannte Preise, getrennt nach offen und im Wagen; zählt fehlende', () => {
    // p1 Joghurt 0,59 offen, p3 Brot 2,50 im Wagen, p2 Milch ohne Preis
    expect(listEstimate(snap())).toEqual({ total: 309, open: 59, cart: 250, priced: 2, missing: 1 });
  });
  it('leerer Zettel', () => {
    expect(listEstimate(emptySnapshot())).toEqual({ total: 0, open: 0, cart: 0, priced: 0, missing: 0 });
  });
  it('Kosten eines Gerichts: Summe der Zutatenpreise, fehlende gezählt', () => {
    const s = snap();
    expect(mealCost([s.products.p1, s.products.p2, s.products.p3])).toEqual({ total: 309, priced: 2, missing: 1 });
    expect(mealCost([])).toEqual({ total: 0, priced: 0, missing: 0 });
    expect(mealCost(undefined)).toEqual({ total: 0, priced: 0, missing: 0 });
  });
});

describe('Operation setPrice', () => {
  it('setzt Preis, lernt Bon-Namen nur wenn angegeben', () => {
    const s = snap();
    applyOp(s, { type: 'setPrice', productId: 'p2', priceCents: 99 });
    expect(s.products.p2).toMatchObject({ price_cents: 99, receipt_names: [] });
    applyOp(s, { type: 'setPrice', productId: 'p1', priceCents: null, receiptNames: ['X', 'ZOTT MONTE'] });
    expect(s.products.p1).toMatchObject({ price_cents: null, receipt_names: ['X', 'ZOTT MONTE'] });
    applyOp(s, { type: 'setPrice', productId: 'weg', priceCents: 1 });
    expect(s.products.weg).toBeUndefined();
  });
  it('offline doppelt angelegtes Produkt: Preis landet beim vorhandenen', () => {
    const [op] = remapProductId([{ type: 'setPrice', productId: 'lokal', priceCents: 5 }], 'lokal', 'p1');
    expect(op.productId).toBe('p1');
    expect(applyOps(snap(), [op]).products.p1.price_cents).toBe(5);
  });
  it('Realtime liefert Preis und Bon-Namen; alte Zeilen ohne Spalten → leer', () => {
    let s = applyServerChange(snap(), 'products', 'UPDATE', { id: 'p2', name: 'Milk', category: 'x', price_cents: 109, receipt_names: ['H-MILCH'] });
    expect(s.products.p2).toMatchObject({ price_cents: 109, receipt_names: ['H-MILCH'] });
    s = applyServerChange(s, 'products', 'UPDATE', { id: 'p2', name: 'Milk', category: 'x' });
    expect(s.products.p2).toMatchObject({ price_cents: null, receipt_names: [] });
  });
});

describe('Bon-Namen', () => {
  it('vergleichbar: Großbuchstaben, einfache Leerzeichen', () => {
    expect(normalizeReceiptName('  zott   Monte ')).toBe('ZOTT MONTE');
  });
  it('neueste zuerst, ohne Doppelte, höchstens 20', () => {
    expect(addReceiptName(['A', 'B'], 'b')).toEqual(['B', 'A']);
    const many = Array.from({ length: 20 }, (_, i) => `N${i}`);
    const next = addReceiptName(many, 'neu');
    expect(next).toHaveLength(20);
    expect(next[0]).toBe('NEU');
    expect(next).not.toContain('N19');
  });
});

describe('Bon-Zeilen zuordnen', () => {
  it('gelernter Name schlägt KI-Vorschlag; unbekannte id fällt weg; ungültige Preise raus', () => {
    const rows = matchReceiptLines(snap(), [
      { text: 'zott monte', unit_price_cents: 65, quantity: 4, product_id: 'p3', sure: false },
      { text: 'H-MILCH 1,5%', unit_price_cents: 109, quantity: 1, product_id: 'p2', sure: true },
      { text: 'KAFFEE', unit_price_cents: 499, quantity: 1, product_id: 'erfunden', sure: true },
      { text: 'PFAND', unit_price_cents: 0, quantity: 1, product_id: null, sure: false },
      { text: 'X', unit_price_cents: 1.5, quantity: 1, product_id: null, sure: false },
      { text: '', unit_price_cents: 100, quantity: 1, product_id: null, sure: false },
    ]);
    expect(rows).toEqual([
      { text: 'zott monte', priceCents: 65, quantity: 4, productId: 'p1', sure: true },
      { text: 'H-MILCH 1,5%', priceCents: 109, quantity: 1, productId: 'p2', sure: true },
      { text: 'KAFFEE', priceCents: 499, quantity: 1, productId: null, sure: false },
    ]);
  });
  it('unsicherer KI-Vorschlag bleibt unsicher; Unsinn statt Liste → leer', () => {
    expect(matchReceiptLines(snap(), [{ text: 'BROT', unit_price_cents: 199, quantity: 0, product_id: 'p3' }])).toEqual([
      { text: 'BROT', priceCents: 199, quantity: 1, productId: 'p3', sure: false },
    ]);
    expect(matchReceiptLines(snap(), null)).toEqual([]);
  });
});

describe('Preise übernehmen', () => {
  it('nur Änderungen; neuer Bon-Name wird gelernt; letzter Eintrag je Produkt zählt', () => {
    const ops = priceOps(snap(), [
      { productId: 'p1', priceCents: 59, receiptName: 'zott monte' }, // gleich, Name bekannt → nichts
      { productId: 'p2', priceCents: 99 },
      { productId: 'p2', priceCents: 109, receiptName: 'H-Milch' },
      { productId: 'p3', priceCents: null }, // Preis gelöscht
      { productId: 'weg', priceCents: 1 },
    ]);
    expect(ops).toEqual([
      { type: 'setPrice', productId: 'p2', priceCents: 109, receiptNames: ['H-MILCH'] },
      { type: 'setPrice', productId: 'p3', priceCents: null },
    ]);
  });
});

describe('API vor dem SQL-Update für Preise', () => {
  function fakeSupabase({ priceColumns }) {
    const calls = [];
    return {
      calls,
      from(table) {
        let cols = '';
        const result = () => {
          if (table === 'products' && !priceColumns && cols.includes('price_cents')) {
            return { data: null, status: 400, error: { code: '42703', message: 'column products.price_cents does not exist' } };
          }
          return { data: table === 'products' ? [{ id: 'p1', name: 'Milch', category: 'Sonstiges' }] : [], status: 200, error: null };
        };
        const q = {
          select: (c) => ((cols = c), calls.push(`${table}:${c}`), q),
          eq: () => q,
          order: () => q,
          range: () => Promise.resolve(result()),
          update: (patch) => ({
            eq: () =>
              Promise.resolve(
                priceColumns
                  ? { data: null, status: 204, error: null, patch }
                  : { data: null, status: 400, error: { code: 'PGRST204', message: "Could not find the 'price_cents' column" } },
              ),
          }),
        };
        return q;
      },
    };
  }

  it('Produkte laden trotzdem (ohne Preise)', async () => {
    const sb = fakeSupabase({ priceColumns: false });
    const snap = await createBackend(sb, 'h1').fetchAll();
    expect(snap.products.p1).toMatchObject({ name: 'Milch', price_cents: null, receipt_names: [] });
    expect(sb.calls.filter((c) => c.startsWith('products:'))).toHaveLength(2);
  });

  it('Preis speichern: dauerhafter Fehler mit Hinweis auf das Update', async () => {
    const backend = createBackend(fakeSupabase({ priceColumns: false }), 'h1');
    await expect(backend.execute({ type: 'setPrice', productId: 'p1', priceCents: 99 })).rejects.toMatchObject({
      kind: 'permanent',
      message: expect.stringMatching(/Schritt 10/),
    });
  });

  it('mit Spalten: ein Abruf, Preis speichern klappt', async () => {
    const sb = fakeSupabase({ priceColumns: true });
    await createBackend(sb, 'h1').fetchAll();
    expect(sb.calls.filter((c) => c.startsWith('products:'))).toEqual([
      'products:id,name,category,favorite,purchase_count,last_purchased_at,created_at,updated_at,price_cents,receipt_names',
    ]);
    await expect(createBackend(sb, 'h1').execute({ type: 'setPrice', productId: 'p1', priceCents: 99 })).resolves.toBeUndefined();
  });

  it('erkennt fehlende Spalte beim Lesen und Schreiben', () => {
    expect(isMissingColumn({ code: '42703' })).toBe(true);
    expect(isMissingColumn({ code: 'PGRST204' })).toBe(true);
    expect(isMissingColumn({ code: '42P01' })).toBe(false);
  });
});
