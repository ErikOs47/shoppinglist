import { describe, it, expect } from 'vitest';
import {
  applyOps,
  applyServerChange,
  cleanName,
  emptySnapshot,
  normalizeName,
  productGroups,
  shoppingView,
  validateProduct,
  remapProductId,
} from '../../src/core/model.js';

function snap() {
  const s = emptySnapshot();
  s.products.p1 = { id: 'p1', name: 'Milch', category: 'Milchprodukte & Eier' };
  s.products.p2 = { id: 'p2', name: 'Brot', category: 'Brot & Backwaren' };
  s.products.p3 = { id: 'p3', name: 'Äpfel', category: 'Obst & Gemüse' };
  s.items.p1 = { id: 'i1', product_id: 'p1', checked: false };
  s.items.p2 = { id: 'i2', product_id: 'p2', checked: true };
  return s;
}

describe('Namen', () => {
  it('bereinigt Leerzeichen', () => {
    expect(cleanName('  Hafer   milch ')).toBe('Hafer milch');
    expect(cleanName(null)).toBe('');
  });
  it('vergleicht ohne Groß/Klein', () => {
    expect(normalizeName(' MILCH ')).toBe(normalizeName('milch'));
  });
});

describe('validateProduct', () => {
  it('lehnt Duplikate unabhängig von Schreibweise ab', () => {
    expect(validateProduct(snap(), { name: ' milch ', category: 'Sonstiges' })).toMatch(/gibt es schon/);
  });
  it('erlaubt den eigenen Namen beim Bearbeiten', () => {
    expect(validateProduct(snap(), { id: 'p1', name: 'Milch', category: 'Sonstiges' })).toBeNull();
  });
  it('lehnt leere und zu lange Namen ab', () => {
    expect(validateProduct(snap(), { name: '   ', category: 'Sonstiges' })).toMatch(/Namen/);
    expect(validateProduct(snap(), { name: 'x'.repeat(81), category: 'Sonstiges' })).toMatch(/zu lang/);
    expect(validateProduct(snap(), { name: 'Käse', category: '' })).toMatch(/Kategorie/);
  });
});

describe('applyOps', () => {
  it('abhaken und Einkauf abschließen entfernt nur abgehakte Einträge', () => {
    const v = applyOps(snap(), [
      { type: 'setChecked', productId: 'p1', checked: true },
      { type: 'setChecked', productId: 'p1', checked: false },
      { type: 'finishShopping', productIds: ['p1', 'p2'] },
    ]);
    expect(Object.keys(v.items)).toEqual(['p1']);
    expect(Object.keys(v.products)).toHaveLength(3); // Produktdatenbank unverändert
  });

  it('verändert den Server-Snapshot nicht', () => {
    const s = snap();
    applyOps(s, [{ type: 'removeFromList', productId: 'p1' }]);
    expect(s.items.p1).toBeDefined();
  });

  it('setzt ein Produkt nicht doppelt auf den Zettel', () => {
    const v = applyOps(snap(), [{ type: 'addToList', id: 'neu', productId: 'p1' }]);
    expect(v.items.p1.id).toBe('i1');
  });

  it('Produkt löschen entfernt es auch vom Zettel', () => {
    const v = applyOps(snap(), [{ type: 'deleteProduct', id: 'p1' }]);
    expect(v.products.p1).toBeUndefined();
    expect(v.items.p1).toBeUndefined();
  });

  it('ignoriert Zettel-Ops für unbekannte Produkte', () => {
    const v = applyOps(snap(), [{ type: 'addToList', id: 'x', productId: 'gibtsnicht' }]);
    expect(v.items.gibtsnicht).toBeUndefined();
  });
});

describe('applyServerChange', () => {
  it('DELETE eines Listeneintrags über die id (nur PK im Ereignis)', () => {
    const s = applyServerChange(snap(), 'list_items', 'DELETE', {}, { id: 'i2' });
    expect(s.items.p2).toBeUndefined();
    expect(s.items.p1).toBeDefined();
  });
  it('unbekannte id bei DELETE ändert nichts', () => {
    const before = snap();
    const s = applyServerChange(before, 'products', 'DELETE', {}, { id: 'fremd' });
    expect(Object.keys(s.products)).toHaveLength(3);
  });
  it('INSERT eines Listeneintrags', () => {
    const s = applyServerChange(snap(), 'list_items', 'INSERT', { id: 'i3', product_id: 'p3', checked: false });
    expect(s.items.p3.id).toBe('i3');
  });
});

describe('Ansichten', () => {
  it('gruppiert Produkte nach Kategorie in Standardreihenfolge', () => {
    const g = productGroups(snap());
    expect(g.map((x) => x.category)).toEqual(['Obst & Gemüse', 'Brot & Backwaren', 'Milchprodukte & Eier']);
    expect(g[2].products[0].onList).toBe(true);
  });
  it('sucht in Namen und Kategorien', () => {
    expect(productGroups(snap(), 'mil').flatMap((g) => g.products.map((p) => p.name))).toEqual(['Milch']);
    expect(productGroups(snap(), 'obst').flatMap((g) => g.products.map((p) => p.name))).toEqual(['Äpfel']);
    expect(productGroups(snap(), 'xyz')).toEqual([]);
  });
  it('Zettel: offene gruppiert, abgehakte separat', () => {
    const v = shoppingView(snap());
    expect(v.openCount).toBe(1);
    expect(v.done.map((d) => d.name)).toEqual(['Brot']);
    expect(v.total).toBe(2);
  });
  it('eigene Kategorie steht vor „Sonstiges“', () => {
    const s = snap();
    s.products.p4 = { id: 'p4', name: 'Futter', category: 'Haustier' };
    s.products.p5 = { id: 'p5', name: 'Kram', category: 'Sonstiges' };
    const cats = productGroups(s).map((g) => g.category);
    expect(cats.indexOf('Haustier')).toBeLessThan(cats.indexOf('Sonstiges'));
  });
});

describe('remapProductId', () => {
  it('biegt Folge-Operationen auf das vorhandene Produkt um', () => {
    const ops = remapProductId(
      [
        { type: 'addToList', id: 'x', productId: 'lokal' },
        { type: 'finishShopping', productIds: ['lokal', 'p2'] },
        { type: 'deleteProduct', id: 'lokal' },
      ],
      'lokal',
      'server',
    );
    expect(ops[0].productId).toBe('server');
    expect(ops[1].productIds).toEqual(['server', 'p2']);
    expect(ops[2].id).toBe('server');
  });
});
