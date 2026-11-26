import { t, categoryLabel } from '../i18n.js';
// Reine Datenlogik ohne DOM und ohne Netzwerk, damit sie per Vitest prüfbar ist.
//
// Zustand ("snapshot"): { products: {[id]: Product}, items: {[productId]: ListItem},
//                        meals: {[id]: Meal}, plan: {[id]: PlanEntry},
//                        expenses: {[id]: Expense} }
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
  return { products: {}, items: {}, meals: {}, plan: {}, expenses: {} };
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
  if (!n) return t('product.errNameMissing');
  if (n.length > 80) return t('product.errNameLong');
  const c = cleanName(category);
  if (!c) return t('product.errCategoryMissing');
  if (c.length > 40) return t('product.errCategoryLong');
  const dup = findProductByName(snapshot, n, id);
  if (dup) return t('product.errExists', { name: dup.name });
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
          position: op.position ?? null,
          quantity: 1,
          created_at: op.at,
        };
      }
      return snap;
    }
    case 'moveItem': {
      const it = snap.items[op.productId];
      if (it) snap.items[op.productId] = { ...it, position: op.position };
      return snap;
    }
    case 'renameCategory': {
      // Alle Produkte der Kategorie; der Server macht dasselbe in einer Anweisung
      for (const [id, p] of Object.entries(snap.products)) {
        if (p.category === op.from) snap.products[id] = { ...p, category: op.to };
      }
      return snap;
    }
    case 'setFavorite': {
      const p = snap.products[op.productId];
      if (p) snap.products[op.productId] = { ...p, favorite: op.favorite };
      return snap;
    }
    case 'setPrice': {
      // Stückpreis (null = unbekannt); receiptNames nur, wenn ein Bon-Name gelernt wurde
      const p = snap.products[op.productId];
      if (p) {
        snap.products[op.productId] = {
          ...p,
          price_cents: op.priceCents ?? null,
          ...(op.receiptNames ? { receipt_names: op.receiptNames } : {}),
        };
      }
      return snap;
    }
    case 'upsertMeal': {
      const prev = snap.meals[op.meal.id];
      snap.meals[op.meal.id] = { ...prev, ...op.meal };
      return snap;
    }
    case 'deleteMeal': {
      delete snap.meals[op.id];
      // DB löscht Planeinträge per ON DELETE CASCADE mit
      for (const [id, e] of Object.entries(snap.plan)) if (e.meal_id === op.id) delete snap.plan[id];
      return snap;
    }
    case 'planMeal': {
      if (!snap.meals[op.mealId]) return snap;
      snap.plan[op.id] = { id: op.id, meal_id: op.mealId, day: op.day, position: op.position ?? null, created_at: op.at };
      return snap;
    }
    case 'unplanMeal': {
      delete snap.plan[op.id];
      return snap;
    }
    case 'upsertExpense': {
      const prev = snap.expenses[op.expense.id];
      snap.expenses[op.expense.id] = { created_at: op.at, ...prev, ...op.expense };
      return snap;
    }
    case 'deleteExpense': {
      delete snap.expenses[op.id];
      return snap;
    }
    case 'movePlan': {
      // Gericht auf einen anderen Tag bzw. an eine andere Stelle im Tag
      const e = snap.plan[op.id];
      if (e) snap.plan[op.id] = { ...e, day: op.day, position: op.position };
      return snap;
    }
    case 'removeFromList': {
      delete snap.items[op.productId];
      return snap;
    }
    case 'setQuantity': {
      const it = snap.items[op.productId];
      if (it) snap.items[op.productId] = { ...it, quantity: clampQuantity(op.quantity) };
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
      // Gekaufte Artikel zählen (Grundlage für Vorschläge); der Server
      // zählt ebenso, der lokale Wert gilt nur bis zur Bestätigung.
      for (const pid of op.productIds) {
        if (snap.items[pid]?.checked) {
          delete snap.items[pid];
          const p = snap.products[pid];
          if (p) {
            snap.products[pid] = { ...p, purchase_count: (p.purchase_count ?? 0) + 1, last_purchased_at: op.at };
          }
        }
      }
      return snap;
    }
    default:
      return snap;
  }
}

export function cloneSnapshot(s) {
  // meals/plan fehlen in Zwischenspeichern älterer App-Versionen
  return {
    products: { ...s.products },
    items: { ...s.items },
    meals: { ...s.meals },
    plan: { ...s.plan },
    expenses: { ...s.expenses },
  };
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
    // Gericht mit dem zusammengeführten Produkt als Zutat
    if (op.type === 'upsertMeal' && op.meal.product_ids?.includes(fromId)) {
      const ids = cleanProductIds(op.meal.product_ids.map((p) => (p === fromId ? toId : p)));
      return { ...op, meal: { ...op.meal, product_ids: ids } };
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
  } else if (table === 'meals') {
    if (eventType === 'DELETE') {
      const id = oldRow?.id;
      delete next.meals[id];
      for (const [pid, e] of Object.entries(next.plan)) if (e.meal_id === id) delete next.plan[pid];
    } else {
      next.meals[row.id] = pickMeal(row);
    }
  } else if (table === 'meal_plan') {
    if (eventType === 'DELETE') delete next.plan[oldRow?.id];
    else next.plan[row.id] = pickPlanEntry(row);
  } else if (table === 'expenses') {
    if (eventType === 'DELETE') delete next.expenses[oldRow?.id];
    else next.expenses[row.id] = pickExpense(row);
  }
  return next;
}

export function pickExpense(r) {
  return {
    id: r.id,
    amount_cents: r.amount_cents,
    spent_on: r.spent_on,
    note: r.note ?? null,
    created_at: r.created_at,
  };
}

export function pickMeal(r) {
  return {
    id: r.id,
    name: r.name,
    source_url: r.source_url ?? null,
    product_ids: Array.isArray(r.product_ids) ? r.product_ids : [],
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export function pickPlanEntry(r) {
  return { id: r.id, meal_id: r.meal_id, day: r.day, position: r.position ?? null, created_at: r.created_at };
}

export function pickProduct(r) {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    favorite: Boolean(r.favorite),
    purchase_count: r.purchase_count ?? 0,
    last_purchased_at: r.last_purchased_at ?? null,
    price_cents: r.price_cents ?? null,
    receipt_names: Array.isArray(r.receipt_names) ? r.receipt_names : [],
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export function pickItem(r) {
  return {
    id: r.id,
    product_id: r.product_id,
    checked: r.checked,
    position: r.position ?? null,
    quantity: clampQuantity(r.quantity),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export function snapshotFromRows(products, items, meals = [], plan = [], expenses = []) {
  const s = emptySnapshot();
  for (const p of products) s.products[p.id] = pickProduct(p);
  for (const i of items) s.items[i.product_id] = pickItem(i);
  for (const m of meals) s.meals[m.id] = pickMeal(m);
  for (const e of plan) s.plan[e.id] = pickPlanEntry(e);
  for (const x of expenses) s.expenses[x.id] = pickExpense(x);
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

/**
 * Gespeicherter Name für eine eingegebene Kategorie: Entspricht die Eingabe
 * (ohne Groß-/Kleinschreibung) einer vorhandenen oder vorgegebenen Kategorie –
 * auch deren übersetztem Anzeigenamen –, wird deren gespeicherter Name
 * verwendet. So führt „Other“ (englische Anzeige) zu „Sonstiges“ statt zu
 * einer zweiten Kategorie.
 */
export function resolveCategoryName(snapshot, input) {
  const name = cleanName(input);
  const key = normalizeName(name);
  for (const c of allCategories(snapshot)) {
    if (normalizeName(c) === key || normalizeName(categoryLabel(c)) === key) return c;
  }
  return name;
}

/**
 * Prüft das Umbenennen einer Kategorie. Ergebnis: { error } oder
 * { to, merge } – `merge`: Zielkategorie hat schon Produkte.
 */
export function planCategoryRename(snapshot, from, input) {
  const name = cleanName(input);
  if (!name) return { error: t('category.errEmpty') };
  if (name.length > 40) return { error: t('product.errCategoryLong') };
  const to = resolveCategoryName(snapshot, name);
  if (to === from) {
    // nur Groß-/Kleinschreibung geändert: als neue Schreibweise übernehmen
    if (name !== from && name !== categoryLabel(from)) return { to: name, merge: false };
    return { to: from, merge: false, unchanged: true };
  }
  const merge = Object.values(snapshot.products).some((p) => p.category === to);
  return { to, merge };
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

/** Produkte nach Kategorie gruppiert, optional nach Suchbegriff und Favoriten gefiltert. */
export function productGroups(snapshot, query = '', { favoritesOnly = false } = {}) {
  const q = normalizeName(query);
  const list = Object.values(snapshot.products)
    .filter((p) => !favoritesOnly || p.favorite)
    // Kategorie auch über ihren angezeigten (ggf. übersetzten) Namen findbar
    .filter(
      (p) =>
        !q ||
        normalizeName(p.name).includes(q) ||
        normalizeName(p.category).includes(q) ||
        normalizeName(categoryLabel(p.category)).includes(q),
    )
    .sort((a, b) => collator.compare(a.name, b.name));
  return groupBy(list, (p) => p.category).map((g) => ({
    category: g.category,
    count: g.entries.length,
    products: g.entries.map((p) => ({ ...p, onList: Boolean(snapshot.items[p.id]) })),
  }));
}

/**
 * Reihenfolge auf dem Zettel: nach position; Einträge ohne position (aus
 * älteren App-Versionen) nach Anlagezeit dahinter. Bei Gleichstand – beide
 * Personen haben gleichzeitig angefügt – entscheidet die id, damit beide
 * Geräte dieselbe Reihenfolge zeigen.
 */
export function compareItems(a, b) {
  const pa = a.position ?? Infinity;
  const pb = b.position ?? Infinity;
  if (pa !== pb) return pa < pb ? -1 : 1;
  const ca = a.created_at ?? '';
  const cb = b.created_at ?? '';
  if (ca !== cb) return ca < cb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** position für einen neu angefügten Eintrag: hinter dem letzten. */
export function nextPosition(snapshot) {
  let max = 0;
  for (const it of Object.values(snapshot.items)) {
    if (typeof it.position === 'number' && it.position > max) max = it.position;
  }
  return Math.floor(max) + 1;
}

/**
 * Neue position, wenn ein Eintrag in `list` (sortiert, ohne den verschobenen
 * Eintrag) an Index `toIndex` eingefügt wird: Mitte zwischen den Nachbarn.
 * Fehlt bei einem Nachbarn die position, wird sie aus dem Index abgeleitet.
 */
export function positionAt(list, toIndex) {
  const posOf = (i) => (typeof list[i]?.position === 'number' ? list[i].position : i + 1);
  if (list.length === 0) return 1;
  if (toIndex <= 0) return posOf(0) - 1;
  if (toIndex >= list.length) return posOf(list.length - 1) + 1;
  return (posOf(toIndex - 1) + posOf(toIndex)) / 2;
}

/**
 * Einkaufszettel als eine Liste ohne Kategorien in eigener Reihenfolge.
 * Abgehakte stehen gesammelt am Ende, damit oben nur das Offene steht.
 */
export function shoppingView(snapshot) {
  const rows = [];
  for (const it of Object.values(snapshot.items)) {
    const p = snapshot.products[it.product_id];
    if (p) {
      rows.push({
        id: it.id,
        productId: p.id,
        name: p.name,
        category: p.category,
        favorite: Boolean(p.favorite),
        priceCents: p.price_cents ?? null,
        quantity: clampQuantity(it.quantity),
        checked: it.checked,
        position: it.position ?? null,
        created_at: it.created_at,
      });
    }
  }
  rows.sort(compareItems);
  const open = rows.filter((r) => !r.checked);
  const done = rows.filter((r) => r.checked);
  return { open, done, total: rows.length, openCount: open.length };
}

/**
 * Vorschläge: häufig gekaufte Produkte, die gerade nicht auf dem Zettel
 * stehen. Sortiert nach Anzahl Käufen, bei Gleichstand der zuletzt gekaufte zuerst.
 */
export function suggestions(snapshot, limit = 8) {
  return Object.values(snapshot.products)
    .filter((p) => (p.purchase_count ?? 0) > 0 && !snapshot.items[p.id])
    .sort(
      (a, b) =>
        (b.purchase_count ?? 0) - (a.purchase_count ?? 0) ||
        String(b.last_purchased_at ?? '').localeCompare(String(a.last_purchased_at ?? '')) ||
        collator.compare(a.name, b.name),
    )
    .slice(0, limit);
}


// ---------------------------------------------------------------------------
// Gerichte und Wochenplan
// ---------------------------------------------------------------------------

export const MAX_INGREDIENTS = 100;

/** Zutaten-ids bereinigen: leere und doppelte weg, Reihenfolge bleibt, höchstens 100. */
export function cleanProductIds(ids) {
  return [...new Set((ids ?? []).filter(Boolean))].slice(0, MAX_INGREDIENTS);
}

/**
 * Zutaten eines Gerichts als Produkte, in gespeicherter Reihenfolge.
 * Inzwischen gelöschte Produkte werden ausgelassen.
 */
export function mealIngredients(snapshot, meal) {
  return (meal?.product_ids ?? []).map((id) => snapshot.products[id]).filter(Boolean);
}

/**
 * Produktliste für die Zutatenauswahl: alphabetisch, nach Suchbegriff
 * gefiltert, mit Markierung, ob das Produkt schon Zutat ist.
 */
export function ingredientChoices(snapshot, selectedIds, query = '') {
  const q = normalizeName(query);
  const selected = new Set(selectedIds);
  return Object.values(snapshot.products)
    .filter((p) => !q || normalizeName(p.name).includes(q))
    .sort((a, b) => collator.compare(a.name, b.name))
    .map((p) => ({ id: p.id, name: p.name, selected: selected.has(p.id) }));
}

/** Nur http(s)-Links; sonst null. */
export function cleanUrl(url) {
  const u = String(url ?? '').trim();
  if (!u) return null;
  try {
    const parsed = new URL(u);
    return /^https?:$/.test(parsed.protocol) && u.length <= 2000 ? parsed.href : null;
  } catch {
    return null;
  }
}

export function findMealByName(snapshot, name, exceptId = null) {
  const key = normalizeName(name);
  if (!key) return null;
  return Object.values(snapshot.meals).find((m) => m.id !== exceptId && normalizeName(m.name) === key) ?? null;
}

/** Fehlermeldung oder null. */
export function validateMeal(snapshot, { id = null, name, sourceUrl }) {
  const n = cleanName(name);
  if (!n) return t('meal.errNameMissing');
  if (n.length > 80) return t('meal.errNameLong');
  if (String(sourceUrl ?? '').trim() && !cleanUrl(sourceUrl)) return t('meal.errUrl');
  const dup = findMealByName(snapshot, n, id);
  if (dup) return t('meal.errExists', { name: dup.name });
  return null;
}

/** Gerichte alphabetisch, optional gefiltert (Name oder Zutat). */
export function mealList(snapshot, query = '') {
  const q = normalizeName(query);
  return Object.values(snapshot.meals)
    .filter(
      (m) => !q || normalizeName(m.name).includes(q) || mealIngredients(snapshot, m).some((p) => normalizeName(p.name).includes(q)),
    )
    .sort((a, b) => collator.compare(a.name, b.name));
}

// Datumsrechnung auf 'YYYY-MM-DD' in UTC, damit Sommer-/Winterzeit nicht
// stört. Welcher Tag „heute“ ist, bestimmt die lokale Uhr (isoDay).

/** Lokales Datum als 'YYYY-MM-DD'. */
export function isoDay(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** Montag der Woche von `iso` (Wochen beginnen montags). */
export function weekStart(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sonntag
  return addDays(iso, -((dow + 6) % 7));
}

/** Kalenderwoche nach ISO 8601 (Woche mit dem ersten Donnerstag ist KW 1). */
export function isoWeek(iso) {
  const thursday = addDays(weekStart(iso), 3);
  const [y] = thursday.split('-').map(Number);
  const firstThursday = addDays(weekStart(`${y}-01-04`), 3);
  const days = (Date.parse(thursday) - Date.parse(firstThursday)) / 86400000;
  return 1 + Math.round(days / 7);
}

/** Sieben Tage ab `monday` mit den geplanten Gerichten in Reihenfolge. */
export function weekPlan(snapshot, monday) {
  const days = Array.from({ length: 7 }, (_, i) => ({ day: addDays(monday, i), entries: [] }));
  const byDay = new Map(days.map((d) => [d.day, d]));
  for (const e of Object.values(snapshot.plan)) {
    const slot = byDay.get(e.day);
    const meal = snapshot.meals[e.meal_id];
    if (slot && meal) {
      slot.entries.push({
        id: e.id,
        mealId: meal.id,
        name: meal.name,
        ingredients: mealIngredients(snapshot, meal),
        position: e.position,
        created_at: e.created_at,
      });
    }
  }
  for (const d of days) d.entries.sort(compareItems);
  return days;
}

/** position für ein neu geplantes Gericht: hinter dem letzten des Tages. */
export function nextPlanPosition(snapshot, day) {
  let max = 0;
  for (const e of Object.values(snapshot.plan)) {
    if (e.day === day && typeof e.position === 'number' && e.position > max) max = e.position;
  }
  return Math.floor(max) + 1;
}

/**
 * Zutaten aller Gerichte der Woche, jedes Produkt einmal. Zu jeder Zutat: aus
 * welchen Gerichten sie stammt und ob sie schon auf dem Zettel steht.
 */
export function weekIngredients(snapshot, days) {
  const map = new Map();
  for (const d of days) {
    for (const e of d.entries) {
      for (const p of e.ingredients) {
        let row = map.get(p.id);
        if (!row) {
          row = { productId: p.id, name: p.name, meals: [], onList: Boolean(snapshot.items[p.id]) };
          map.set(p.id, row);
        }
        if (!row.meals.includes(e.name)) row.meals.push(e.name);
      }
    }
  }
  return [...map.values()].sort((a, b) => collator.compare(a.name, b.name));
}

/**
 * Operationen, die gewählte Zutaten (Produkt-ids) hinten an den Zettel
 * anfügen. Was schon drauf steht oder gelöscht wurde, wird übersprungen.
 */
export function productsToListOps(snapshot, productIds, newId) {
  const ops = [];
  let pos = nextPosition(snapshot);
  for (const productId of cleanProductIds(productIds)) {
    if (!snapshot.products[productId] || snapshot.items[productId]) continue;
    ops.push({ type: 'addToList', id: newId(), productId, position: pos++ });
  }
  return ops;
}

// ---------------------------------------------------------------------------
// Ausgaben
// ---------------------------------------------------------------------------

export const MAX_AMOUNT_CENTS = 100_000_000; // 1 Mio. €, wie in der Datenbank

/**
 * Betrag aus einer Eingabe in Cent: „23,40“, „23.40“, „23“, „1.234,50 €“.
 * Ergebnis: Cent (ganzzahlig, > 0) oder null bei ungültiger Eingabe.
 */
export function parseAmount(input) {
  let s = String(input ?? '').replace(/[\s€]/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, ''); // „1.234,50“
  s = s.replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return cents > 0 && cents <= MAX_AMOUNT_CENTS ? cents : null;
}

/** 'YYYY-MM' eines Datums 'YYYY-MM-DD'. */
export function monthKey(iso) {
  return iso.slice(0, 7);
}

/** Monat 'YYYY-MM' um n Monate verschieben. */
export function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Neueste zuerst: nach Datum, dann Erfassungszeit, dann id. */
function compareExpenses(a, b) {
  if (a.spent_on !== b.spent_on) return a.spent_on < b.spent_on ? 1 : -1;
  const ca = a.created_at ?? '';
  const cb = b.created_at ?? '';
  if (ca !== cb) return ca < cb ? 1 : -1;
  return a.id < b.id ? 1 : -1;
}

/**
 * Statistik zum Stichtag `today` ('YYYY-MM-DD'):
 * - week/month: aktuelle Woche (Mo–So) bzw. Kalendermonat samt Vorperiode
 * - weeks/months: Verlauf der letzten `weeks` Wochen bzw. `months` Monate (älteste zuerst)
 * - byWeek/byMonth: Einträge je Periode (neueste zuerst)
 */
export function expenseStats(snapshot, today, { weeks = 8, months = 6 } = {}) {
  const list = Object.values(snapshot.expenses ?? {}).sort(compareExpenses);
  const weekTotals = new Map();
  const monthTotals = new Map();
  const byWeek = new Map();
  const byMonth = new Map();
  for (const x of list) {
    const w = weekStart(x.spent_on);
    const m = monthKey(x.spent_on);
    weekTotals.set(w, (weekTotals.get(w) ?? 0) + x.amount_cents);
    monthTotals.set(m, (monthTotals.get(m) ?? 0) + x.amount_cents);
    if (!byWeek.has(w)) byWeek.set(w, []);
    byWeek.get(w).push(x);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(x);
  }
  const thisWeek = weekStart(today);
  const thisMonth = monthKey(today);
  return {
    week: { key: thisWeek, total: weekTotals.get(thisWeek) ?? 0, prev: weekTotals.get(addDays(thisWeek, -7)) ?? 0 },
    month: { key: thisMonth, total: monthTotals.get(thisMonth) ?? 0, prev: monthTotals.get(addMonths(thisMonth, -1)) ?? 0 },
    weeks: Array.from({ length: weeks }, (_, i) => {
      const key = addDays(thisWeek, -7 * (weeks - 1 - i));
      return { key, total: weekTotals.get(key) ?? 0 };
    }),
    months: Array.from({ length: months }, (_, i) => {
      const key = addMonths(thisMonth, -(months - 1 - i));
      return { key, total: monthTotals.get(key) ?? 0 };
    }),
    byWeek,
    byMonth,
    count: list.length,
  };
}

// ---------------------------------------------------------------------------
// Preise und Kassenbon
// ---------------------------------------------------------------------------

export const MAX_PRICE_CENTS = 1_000_000; // 10.000 €, wie in der Datenbank
export const MAX_RECEIPT_NAMES = 20;

/** Stückpreis aus einer Eingabe in Cent; null bei leer oder ungültig. */
export function parsePrice(input) {
  const cents = parseAmount(input);
  return cents !== null && cents <= MAX_PRICE_CENTS ? cents : null;
}

/**
 * Grobe Kosten des Zettels: Summe von Preis × Menge aller Einträge (offen und
 * im Wagen) mit bekanntem Preis; `missing` zählt Einträge ohne Preis.
 */
export function listEstimate(snapshot) {
  let total = 0;
  let priced = 0;
  let missing = 0;
  for (const it of Object.values(snapshot.items)) {
    const p = snapshot.products[it.product_id];
    if (!p) continue;
    if (p.price_cents) {
      total += p.price_cents * clampQuantity(it.quantity);
      priced += 1;
    } else {
      missing += 1;
    }
  }
  return { total, priced, missing };
}

/** Bon-Zeile vergleichbar machen: Großbuchstaben, einfache Leerzeichen. */
export function normalizeReceiptName(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 60);
}

/** Bon-Name vorne anfügen (neueste zuerst), Doppelte weg, höchstens 20. */
export function addReceiptName(names, text) {
  const n = normalizeReceiptName(text);
  const rest = (names ?? []).filter((x) => normalizeReceiptName(x) !== n);
  return (n ? [n, ...rest] : rest).slice(0, MAX_RECEIPT_NAMES);
}

/**
 * Ergebnis des Bon-Scans gegen die Produkte prüfen. Gelernte Bon-Namen gehen
 * vor (sicher), sonst gilt der Vorschlag der KI, aber nur mit einer
 * vorhandenen Produkt-id. Ungültige Preise werden verworfen.
 */
export function matchReceiptLines(snapshot, lines) {
  const learned = new Map();
  for (const p of Object.values(snapshot.products)) {
    for (const n of p.receipt_names ?? []) {
      if (!learned.has(normalizeReceiptName(n))) learned.set(normalizeReceiptName(n), p.id);
    }
  }
  const out = [];
  for (const l of Array.isArray(lines) ? lines : []) {
    const text = String(l?.text ?? '').trim().slice(0, 60);
    const price = Number.isInteger(l?.unit_price_cents) ? l.unit_price_cents : null;
    if (!text || !price || price <= 0 || price > MAX_PRICE_CENTS) continue;
    const quantity = Number.isInteger(l.quantity) && l.quantity > 0 ? l.quantity : 1;
    const byName = learned.get(normalizeReceiptName(text));
    const suggested = snapshot.products[l.product_id] ? l.product_id : null;
    const productId = byName ?? suggested;
    out.push({ text, priceCents: price, quantity, productId, sure: Boolean(byName) || (Boolean(suggested) && l.sure === true) });
  }
  return out;
}

/**
 * Operationen zum Übernehmen von Preisen. `entries`: [{productId, priceCents,
 * receiptName?}]. Je Produkt zählt der letzte Eintrag. Nur was sich ändert,
 * wird gesendet; ein Bon-Name wird gelernt, wenn er neu ist.
 */
export function priceOps(snapshot, entries) {
  const byProduct = new Map();
  for (const e of entries) {
    if (!snapshot.products[e.productId]) continue;
    const prev = byProduct.get(e.productId);
    byProduct.set(e.productId, { ...prev, ...e, receiptName: e.receiptName ?? prev?.receiptName });
  }
  const ops = [];
  for (const [productId, e] of byProduct) {
    const p = snapshot.products[productId];
    const priceCents = e.priceCents ?? null;
    const known = (p.receipt_names ?? []).map(normalizeReceiptName);
    const learn = e.receiptName && !known.includes(normalizeReceiptName(e.receiptName));
    if (priceCents === (p.price_cents ?? null) && !learn) continue;
    const op = { type: 'setPrice', productId, priceCents };
    if (learn) op.receiptNames = addReceiptName(p.receipt_names, e.receiptName);
    ops.push(op);
  }
  return ops;
}

// ---------------------------------------------------------------------------
// Mengen auf dem Zettel
// ---------------------------------------------------------------------------

export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 99; // wie in der Datenbank

/** Menge auf 1–99 begrenzen; fehlende oder ungültige Werte (ältere Daten) = 1. */
export function clampQuantity(q) {
  const n = Math.trunc(Number(q));
  if (!Number.isFinite(n) || n < MIN_QUANTITY) return MIN_QUANTITY;
  return Math.min(n, MAX_QUANTITY);
}
