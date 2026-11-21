// Reine Datenlogik ohne DOM und ohne Netzwerk, damit sie per Vitest prüfbar ist.
//
// Zustand ("snapshot"): { products: {[id]: Product}, items: {[productId]: ListItem} }
// Listeneinträge sind nach product_id geschlüsselt, weil product_id in der DB
// eindeutig ist. So verschmelzen Einträge, die beide Personen offline mit
// unterschiedlicher id für dasselbe Produkt anlegen.

export const DEFAULT_CATEGORIES = [
  'Obst & Gemüse',
  'Brot & Backwaren',
  'Milchprodukte & Eier',
  'Fleisch & Fisch',
  'Tiefkühl',
  'Vorrat & Konserven',
  'Getränke',
  'Süßes & Snacks',
  'Drogerie & Haushalt',
  'Sonstiges',
];

export const FALLBACK_CATEGORY = 'Sonstiges';

/** Anzeigeform: Leerzeichen am Rand weg, mehrfache Leerzeichen zu einem. */
export function cleanName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Vergleichsschlüssel für Duplikate. Muss zum DB-Index
 * lower(regexp_replace(name, '\s+', ' ', 'g')) passen; Namen werden vor dem
 * Speichern mit cleanName() bereinigt, daher reicht hier cleanName + lower.
 */
export function normalizeName(name) {
  return cleanName(name).toLowerCase();
}

export function emptySnapshot() {
  return { products: {}, items: {} };
}

export function findProductByName(snapshot, name, exceptId = null) {
  const key = normalizeName(name);
  if (!key) return null;
  for (const p of Object.values(snapshot.products)) {
    if (p.id !== exceptId && normalizeName(p.name) === key) return p;
  }
  return null;
}

/**
 * Prüft Eingaben für ein Produkt. Gibt eine deutsche Fehlermeldung zurück
 * oder null, wenn alles passt.
 */
export function validateProduct(snapshot, { id = null, name, category }) {
  const n = cleanName(name);
  if (!n) return 'Bitte einen Namen eingeben.';
  if (n.length > 80) return 'Der Name ist zu lang (max. 80 Zeichen).';
  const c = cleanName(category);
  if (!c) return 'Bitte eine Kategorie wählen.';
  if (c.length > 40) return 'Die Kategorie ist zu lang (max. 40 Zeichen).';
  const dup = findProductByName(snapshot, n, id);
  if (dup) return `„${dup.name}“ gibt es schon.`;
  return null;
}

// ---------------------------------------------------------------------------
// Operationen
//
// Jede Nutzeraktion wird zu einer Operation. Die Anzeige ergibt sich aus
// Server-Snapshot + noch nicht bestätigten Operationen. Damit sieht man die
// eigene Änderung sofort, auch offline, und Server-Ereignisse überschreiben
// sie nicht, solange sie noch unterwegs ist.
// ---------------------------------------------------------------------------

export function applyOp(snap, op) {
  switch (op.type) {
    case 'upsertProduct': {
      const prev = snap.products[op.product.id];
      snap.products[op.product.id] = { ...prev, ...op.product };
      return snap;
    }
    case 'deleteProduct': {
      delete snap.products[op.id];
      delete snap.items[op.id]; // DB löscht per ON DELETE CASCADE mit
      return snap;
    }
    case 'addToList': {
      if (!snap.products[op.productId]) return snap;
      if (!snap.items[op.productId]) {
        snap.items[op.productId] = {
          id: op.id,
          product_id: op.productId,
          checked: false,
          created_at: op.at,
        };
      }
      return snap;
    }
    case 'removeFromList': {
      delete snap.items[op.productId];
      return snap;
    }
    case 'setChecked': {
      const it = snap.items[op.productId];
      if (it) snap.items[op.productId] = { ...it, checked: op.checked };
      return snap;
    }
    case 'finishShopping': {
      // Nur Einträge entfernen, die (noch) abgehakt sind. Hat die andere
      // Person einen Haken inzwischen entfernt, bleibt der Eintrag stehen.
      for (const pid of op.productIds) {
        if (snap.items[pid]?.checked) delete snap.items[pid];
      }
      return snap;
    }
    default:
      return snap;
  }
}

export function cloneSnapshot(s) {
  return { products: { ...s.products }, items: { ...s.items } };
}

export function applyOps(server, ops) {
  const view = cloneSnapshot(server);
  // Lokale Produkt-id → vorhandene id. Gibt es den Namen schon (z. B. weil die
  // andere Person ihn zeitgleich angelegt hat), führt die Anzeige sofort
  // zusammen, so wie es der Server beim Senden ohnehin tun wird.
  const alias = new Map();
  for (let op of ops) {
    for (const [from, to] of alias) [op] = remapProductId([op], from, to);
    if (op.type === 'upsertProduct' && op.isNew) {
      const dup = findProductByName(view, op.product.name, op.product.id);
      if (dup) {
        alias.set(op.product.id, dup.id);
        continue;
      }
    }
    applyOp(view, op);
  }
  return view;
}

/** Ersetzt in offenen Operationen eine Produkt-id (nach Duplikat-Zusammenführung). */
export function remapProductId(ops, fromId, toId) {
  return ops.map((op) => {
    if (op.productId === fromId) return { ...op, productId: toId };
    if (op.type === 'finishShopping' && op.productIds.includes(fromId)) {
      return { ...op, productIds: op.productIds.map((p) => (p === fromId ? toId : p)) };
    }
    if (op.type === 'deleteProduct' && op.id === fromId) return { ...op, id: toId };
    if (op.type === 'upsertProduct' && op.product.id === fromId) {
      return { ...op, product: { ...op.product, id: toId } };
    }
    return op;
  });
}

// ---------------------------------------------------------------------------
// Server-Ereignisse (Realtime) in den Snapshot übernehmen
// ---------------------------------------------------------------------------

export function applyServerChange(server, table, eventType, row, oldRow) {
  const next = cloneSnapshot(server);
  if (table === 'products') {
    if (eventType === 'DELETE') {
      const id = oldRow?.id;
      delete next.products[id];
      delete next.items[id];
    } else {
      next.products[row.id] = pickProduct(row);
    }
  } else if (table === 'list_items') {
    if (eventType === 'DELETE') {
      // Bei DELETE liefert Realtime unter RLS nur den Primärschlüssel (id).
      const id = oldRow?.id;
      for (const [pid, it] of Object.entries(next.items)) {
        if (it.id === id) delete next.items[pid];
      }
    } else {
      // Ein Eintrag mit anderer id für dasselbe Produkt wird ersetzt.
      next.items[row.product_id] = pickItem(row);
    }
  }
  return next;
}

export function pickProduct(r) {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export function pickItem(r) {
  return {
    id: r.id,
    product_id: r.product_id,
    checked: r.checked,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export function snapshotFromRows(products, items) {
  const s = emptySnapshot();
  for (const p of products) s.products[p.id] = pickProduct(p);
  for (const i of items) s.items[i.product_id] = pickItem(i);
  return s;
}

// ---------------------------------------------------------------------------
// Ansichten
// ---------------------------------------------------------------------------

const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

function categoryRank(cat) {
  const i = DEFAULT_CATEGORIES.indexOf(cat);
  // Eigene Kategorien vor „Sonstiges“, aber nach den Standardkategorien.
  if (i === -1) return DEFAULT_CATEGORIES.length - 1 - 0.5;
  return i;
}

export function compareCategories(a, b) {
  const d = categoryRank(a) - categoryRank(b);
  return d !== 0 ? d : collator.compare(a, b);
}

export function allCategories(snapshot) {
  const set = new Set(DEFAULT_CATEGORIES);
  for (const p of Object.values(snapshot.products)) set.add(p.category);
  return [...set].sort(compareCategories);
}

function groupBy(list, keyFn) {
  const map = new Map();
  for (const x of list) {
    const k = keyFn(x);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(x);
  }
  return [...map.entries()]
    .sort(([a], [b]) => compareCategories(a, b))
    .map(([category, entries]) => ({ category, entries }));
}

/** Produkte nach Kategorie gruppiert, optional nach Suchbegriff gefiltert. */
export function productGroups(snapshot, query = '') {
  const q = normalizeName(query);
  const list = Object.values(snapshot.products)
    .filter((p) => !q || normalizeName(p.name).includes(q) || normalizeName(p.category).includes(q))
    .sort((a, b) => collator.compare(a.name, b.name));
  return groupBy(list, (p) => p.category).map((g) => ({
    category: g.category,
    products: g.entries.map((p) => ({ ...p, onList: Boolean(snapshot.items[p.id]) })),
  }));
}

/**
 * Einkaufszettel: offene Artikel nach Kategorie gruppiert, abgehakte
 * gesammelt am Ende, damit beim Einkaufen oben nur das Offene steht.
 */
export function shoppingView(snapshot) {
  const rows = [];
  for (const it of Object.values(snapshot.items)) {
    const p = snapshot.products[it.product_id];
    if (p) rows.push({ productId: p.id, name: p.name, category: p.category, checked: it.checked });
  }
  rows.sort((a, b) => collator.compare(a.name, b.name));
  const open = rows.filter((r) => !r.checked);
  const done = rows.filter((r) => r.checked);
  return {
    groups: groupBy(open, (r) => r.category).map((g) => ({ category: g.category, items: g.entries })),
    done,
    total: rows.length,
    openCount: open.length,
  };
}
