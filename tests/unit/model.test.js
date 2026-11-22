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
  nextPosition,
  positionAt,
  suggestions,
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

  it('offene Neuanlage mit Namen eines vorhandenen Produkts zeigt kein Duplikat', () => {
    // Partner-Produkt „Milch“ kam per Realtime, eigene Offline-Anlage „milch“ ist noch unterwegs.
    const v = applyOps(snap(), [
      { type: 'upsertProduct', isNew: true, product: { id: 'lokal', name: 'milch', category: 'Sonstiges' } },
      { type: 'addToList', id: 'x', productId: 'lokal' },
      { type: 'setChecked', productId: 'lokal', checked: true },
    ]);
    expect(Object.values(v.products).filter((p) => p.name.toLowerCase() === 'milch')).toHaveLength(1);
    expect(v.products.lokal).toBeUndefined();
    expect(v.items.p1.checked).toBe(true); // Folge-Ops wirken auf das vorhandene Produkt
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


describe('Reihenfolge auf dem Zettel', () => {
  function zettel() {
    const s = emptySnapshot();
    for (const [id, name] of [['a', 'Äpfel'], ['b', 'Brot'], ['c', 'Cola'], ['d', 'Dill']]) {
      s.products[id] = { id, name, category: 'Sonstiges' };
    }
    s.items.a = { id: 'ia', product_id: 'a', checked: false, position: 1 };
    s.items.b = { id: 'ib', product_id: 'b', checked: false, position: 2 };
    s.items.c = { id: 'ic', product_id: 'c', checked: true, position: 3 };
    s.items.d = { id: 'id', product_id: 'd', checked: false, position: 4 };
    return s;
  }

  it('ohne Kategorien, offen nach position, Abgehakte am Ende', () => {
    const v = shoppingView(zettel());
    expect(v.open.map((r) => r.name)).toEqual(['Äpfel', 'Brot', 'Dill']);
    expect(v.done.map((r) => r.name)).toEqual(['Cola']);
  });

  it('Verschieben: Dill an den Anfang, dann zwischen Äpfel und Brot', () => {
    const s = zettel();
    let open = shoppingView(s).open.filter((r) => r.productId !== 'd');
    let v = applyOps(s, [{ type: 'moveItem', productId: 'd', position: positionAt(open, 0) }]);
    expect(v.items.d.position).toBe(0);
    expect(shoppingView(v).open.map((r) => r.name)).toEqual(['Dill', 'Äpfel', 'Brot']);

    open = shoppingView(s).open.filter((r) => r.productId !== 'd');
    v = applyOps(s, [{ type: 'moveItem', productId: 'd', position: positionAt(open, 1) }]);
    expect(v.items.d.position).toBe(1.5);
    expect(shoppingView(v).open.map((r) => r.name)).toEqual(['Äpfel', 'Dill', 'Brot']);
  });

  it('positionAt am Ende und bei leerer Liste', () => {
    expect(positionAt([{ position: 1 }, { position: 2 }], 2)).toBe(3);
    expect(positionAt([], 0)).toBe(1);
  });

  it('Einträge ohne position (ältere App-Version) stehen hinten, nach Anlagezeit', () => {
    const s = zettel();
    s.products.e = { id: 'e', name: 'Eis', category: 'Sonstiges' };
    s.products.f = { id: 'f', name: 'Feta', category: 'Sonstiges' };
    s.items.f = { id: 'if', product_id: 'f', checked: false, position: null, created_at: '2026-01-02' };
    s.items.e = { id: 'ie', product_id: 'e', checked: false, position: null, created_at: '2026-01-01' };
    expect(shoppingView(s).open.map((r) => r.name)).toEqual(['Äpfel', 'Brot', 'Dill', 'Eis', 'Feta']);
  });

  it('gleiche position bei beiden Geräten: gleiche Reihenfolge (nach id)', () => {
    const s = emptySnapshot();
    s.products.x = { id: 'x', name: 'X', category: 'S' };
    s.products.y = { id: 'y', name: 'Y', category: 'S' };
    s.items.y = { id: 'i2', product_id: 'y', checked: false, position: 5, created_at: 't' };
    s.items.x = { id: 'i1', product_id: 'x', checked: false, position: 5, created_at: 't' };
    expect(shoppingView(s).open.map((r) => r.name)).toEqual(['X', 'Y']);
  });

  it('nextPosition hängt hinten an', () => {
    expect(nextPosition(zettel())).toBe(5);
    expect(nextPosition(emptySnapshot())).toBe(1);
    const v = applyOps(zettel(), [{ type: 'addToList', id: 'n', productId: 'a', position: 99 }]);
    expect(v.items.a.position).toBe(1); // schon auf dem Zettel: unverändert
  });
});

describe('Favoriten', () => {
  it('setzen und filtern', () => {
    const v = applyOps(snap(), [{ type: 'setFavorite', productId: 'p2', favorite: true }]);
    expect(v.products.p2.favorite).toBe(true);
    const names = productGroups(v, '', { favoritesOnly: true }).flatMap((g) => g.products.map((p) => p.name));
    expect(names).toEqual(['Brot']);
    expect(productGroups(snap(), '', { favoritesOnly: true })).toEqual([]);
  });
});

describe('Kaufhistorie und Vorschläge', () => {
  it('Abschluss zählt nur abgehakte Artikel', () => {
    const v = applyOps(snap(), [{ type: 'finishShopping', productIds: ['p1', 'p2'], at: '2026-11-22T10:00:00Z' }]);
    expect(v.products.p2.purchase_count).toBe(1); // war abgehakt
    expect(v.products.p1.purchase_count ?? 0).toBe(0); // war offen
    expect(v.products.p2.last_purchased_at).toBe('2026-11-22T10:00:00Z');
  });

  it('Vorschläge: häufigste zuerst, nichts was schon auf dem Zettel steht', () => {
    const s = snap();
    s.products.p1.purchase_count = 9; // steht auf dem Zettel → kein Vorschlag
    s.products.p3.purchase_count = 2;
    s.products.p4 = { id: 'p4', name: 'Kaffee', category: 'Getränke', purchase_count: 5 };
    s.products.p5 = { id: 'p5', name: 'Tee', category: 'Getränke', purchase_count: 0 };
    s.products.p6 = { id: 'p6', name: 'Saft', category: 'Getränke', purchase_count: 2, last_purchased_at: '2026-11-20' };
    s.products.p3.last_purchased_at = '2026-11-01';
    delete s.items.p2;
    expect(suggestions(s).map((p) => p.name)).toEqual(['Kaffee', 'Saft', 'Äpfel']);
    expect(suggestions(s, 1).map((p) => p.name)).toEqual(['Kaffee']);
  });
});
