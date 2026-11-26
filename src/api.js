// Supabase-Anbindung: setzt Operationen aus src/core/sync.js in DB-Aufrufe um
// und ordnet Fehler ein (vorübergehend vs. dauerhaft).

import { createClient } from '@supabase/supabase-js';
import { BackendError } from './core/sync.js';
import { snapshotFromRows, pickProduct, clampQuantity } from './core/model.js';
import { t } from './i18n.js';

export function createSupabase(url, key) {
  return createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    realtime: { params: { eventsPerSecond: 20 } },
  });
}

const PAGE = 1000; // Supabase liefert standardmäßig höchstens 1000 Zeilen pro Abfrage
const PRODUCT_COLUMNS_BASE = 'id,name,category,favorite,purchase_count,last_purchased_at,created_at,updated_at';
const PRODUCT_COLUMNS = `${PRODUCT_COLUMNS_BASE},price_cents,receipt_names`;
const ITEM_COLUMNS_BASE = 'id,product_id,checked,position,created_at,updated_at';
const ITEM_COLUMNS = `${ITEM_COLUMNS_BASE},quantity`;
const MEAL_COLUMNS = 'id,name,source_url,product_ids,created_at,updated_at';

/**
 * Ordnet einen Supabase-Fehler ein. Ohne Netz liefert supabase-js einen
 * Fehler ohne Postgres-Code und Status 0; Serverfehler (5xx), abgelaufene
 * Tokens (PGRST3xx) und Rate-Limits sind ebenfalls nur vorübergehend.
 */
export function classifyError(error, status) {
  const code = error?.code ?? '';
  const transient =
    !code ||
    !status ||
    status >= 500 ||
    status === 401 ||
    status === 408 ||
    status === 429 ||
    code.startsWith('PGRST3') ||
    code.startsWith('08') || // Verbindungsfehler
    code === '57014' || // Statement-Timeout
    code === '40001' || // Serialisierungsfehler
    code === '40P01'; // Deadlock
  return transient ? 'transient' : 'permanent';
}

/**
 * Spalte fehlt (Migration 20261126000000_prices.sql noch nicht eingespielt):
 * 42703 beim Lesen, PGRST204 beim Schreiben (Schema-Cache von PostgREST).
 */
export function isMissingColumn(error) {
  return error?.code === '42703' || error?.code === 'PGRST204';
}

function isConstraint(error, name) {
  return error?.code === '23505' && `${error.message} ${error.details}`.includes(name);
}

/** % und _ in ilike-Mustern wörtlich nehmen. */
function escapeLike(s) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function createBackend(supabase, householdId) {
  async function run(promise) {
    let res;
    try {
      res = await promise;
    } catch (e) {
      // fetch wirft bei fehlendem Netz direkt
      throw new BackendError('transient', e?.message || t('err.network'));
    }
    return res;
  }

  function fail(res, fallbackMsg) {
    const kind = classifyError(res.error, res.status);
    if (kind === 'transient' && (res.status === 401 || res.error?.code?.startsWith('PGRST3'))) {
      // Token erneuern; der nächste Versuch nutzt dann das neue Token.
      supabase.auth.refreshSession().catch(() => {});
    }
    throw new BackendError(kind, humanMessage(res.error) || fallbackMsg);
  }

  /**
   * Alle Zeilen einer Tabelle des Haushalts. `optional`: Fehlt die Tabelle
   * (Migration noch nicht eingespielt), leer statt Fehler. Sonst würde ein
   * neuer App-Stand vor dem SQL-Update auch Produkte und Zettel lahmlegen.
   */
  async function selectAll(table, columns, { optional = false } = {}) {
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      const res = await run(
        supabase
          .from(table)
          .select(columns)
          .eq('household_id', householdId)
          .order('id')
          .range(from, from + PAGE - 1),
      );
      if (res.error && optional && isMissingTable(res.error)) return [];
      if (res.error && isMissingColumn(res.error)) {
        const e = new BackendError('permanent', t('err.load'));
        e.missingColumn = true;
        throw e;
      }
      if (res.error) fail(res, t('err.load'));
      rows.push(...res.data);
      if (res.data.length < PAGE) return rows;
    }
  }

  // Fehlen neue Spalten (SQL-Update noch nicht eingespielt), mit den
  // bisherigen Spalten laden, damit ein neuer App-Stand vor dem Update nicht
  // Produkte und Zettel lahmlegt.
  let productColumns = PRODUCT_COLUMNS;
  let itemColumns = ITEM_COLUMNS;
  async function selectProducts() {
    try {
      return await selectAll('products', productColumns);
    } catch (e) {
      if (productColumns === PRODUCT_COLUMNS_BASE || !e.missingColumn) throw e;
      productColumns = PRODUCT_COLUMNS_BASE;
      return selectAll('products', productColumns);
    }
  }
  async function selectItems() {
    try {
      return await selectAll('list_items', itemColumns);
    } catch (e) {
      if (itemColumns === ITEM_COLUMNS_BASE || !e.missingColumn) throw e;
      itemColumns = ITEM_COLUMNS_BASE;
      return selectAll('list_items', itemColumns);
    }
  }

  return {
    async fetchAll() {
      const [products, items, meals, plan, expenses] = await Promise.all([
        selectProducts(),
        selectItems(),
        selectAll('meals', MEAL_COLUMNS, { optional: true }),
        selectAll('meal_plan', 'id,meal_id,day,position,created_at', { optional: true }),
        selectAll('expenses', 'id,amount_cents,spent_on,note,created_at', { optional: true }),
      ]);
      return snapshotFromRows(products, items, meals, plan, expenses);
    },

    async execute(op) {
      switch (op.type) {
        case 'upsertProduct': {
          const { id, name, category } = op.product;
          if (op.isNew) {
            const res = await run(
              supabase.from('products').insert({ id, household_id: householdId, name, category }),
            );
            if (!res.error) return;
            // Schon beim letzten Versuch angekommen (Antwort ging verloren): ok.
            if (isConstraint(res.error, 'products_pkey')) return;
            if (isConstraint(res.error, 'products_household_name_uq')) {
              const existing = await this.findByName(name);
              if (existing) {
                throw new BackendError('duplicateName', t('product.errExists', { name }), { existing });
              }
            }
            fail(res, t('err.saveProduct'));
          } else {
            const res = await run(supabase.from('products').update({ name, category }).eq('id', id));
            if (!res.error) return; // 0 Zeilen = inzwischen gelöscht, nichts zu tun
            if (isConstraint(res.error, 'products_household_name_uq')) {
              throw new BackendError('permanent', t('product.errExists', { name }));
            }
            fail(res, t('err.updateProduct'));
          }
          return;
        }
        case 'deleteProduct': {
          const res = await run(supabase.from('products').delete().eq('id', op.id));
          if (res.error) fail(res, t('err.deleteProduct'));
          return;
        }
        case 'addToList': {
          const res = await run(
            supabase
              .from('list_items')
              .upsert(
                { id: op.id, household_id: householdId, product_id: op.productId, position: op.position ?? null },
                { onConflict: 'product_id', ignoreDuplicates: true },
              ),
          );
          if (!res.error) return;
          // Produkt wurde inzwischen von der anderen Person gelöscht: nichts zu tun.
          if (res.error.code === '23503') return;
          // Gleiche id schon vorhanden (Wiederholung): ok.
          if (isConstraint(res.error, 'list_items_pkey')) return;
          fail(res, t('err.addToList'));
          return;
        }
        case 'removeFromList': {
          const res = await run(supabase.from('list_items').delete().eq('product_id', op.productId));
          if (res.error) fail(res, t('err.removeFromList'));
          return;
        }
        case 'setQuantity': {
          const res = await run(
            supabase.from('list_items').update({ quantity: clampQuantity(op.quantity) }).eq('product_id', op.productId),
          );
          if (!res.error) return; // 0 Zeilen = Eintrag inzwischen entfernt
          if (isMissingColumn(res.error)) throw new BackendError('permanent', t('err.quantityNotSetUp'));
          fail(res, t('err.quantity'));
          return;
        }
        case 'setChecked': {
          const res = await run(
            supabase.from('list_items').update({ checked: op.checked }).eq('product_id', op.productId),
          );
          if (res.error) fail(res, t('err.check'));
          return;
        }
        case 'finishShopping': {
          if (op.productIds.length === 0) return;
          // Serverfunktion: entfernt nur, was noch abgehakt ist (hat die andere
          // Person den Haken gerade entfernt, bleibt der Artikel), und zählt
          // genau diese Artikel als gekauft. Wiederholung zählt nicht doppelt.
          const res = await run(supabase.rpc('finish_shopping', { p_product_ids: op.productIds }));
          if (res.error) fail(res, t('err.finish'));
          return;
        }
        case 'moveItem': {
          const res = await run(
            supabase.from('list_items').update({ position: op.position }).eq('product_id', op.productId),
          );
          if (res.error) fail(res, t('err.move'));
          return;
        }
        case 'renameCategory': {
          // Eine Anweisung für alle Produkte der Kategorie. Wiederholung ist
          // harmlos: Danach gibt es keine Produkte mit dem alten Namen mehr.
          const res = await run(
            supabase
              .from('products')
              .update({ category: op.to })
              .eq('household_id', householdId)
              .eq('category', op.from),
          );
          if (res.error) fail(res, t('err.renameCategory'));
          return;
        }
        case 'setFavorite': {
          const res = await run(
            supabase.from('products').update({ favorite: op.favorite }).eq('id', op.productId),
          );
          if (res.error) fail(res, t('err.favorite'));
          return;
        }
        case 'setPrice': {
          const patch = { price_cents: op.priceCents ?? null };
          if (op.receiptNames) patch.receipt_names = op.receiptNames;
          const res = await run(supabase.from('products').update(patch).eq('id', op.productId));
          if (!res.error) return; // 0 Zeilen = Produkt inzwischen gelöscht
          if (isMissingColumn(res.error)) throw new BackendError('permanent', t('err.pricesNotSetUp'));
          fail(res, t('err.price'));
          return;
        }
        case 'upsertMeal': {
          const { id, name, source_url, product_ids } = op.meal;
          if (op.isNew) {
            const res = await run(
              supabase.from('meals').insert({ id, household_id: householdId, name, source_url, product_ids }),
            );
            if (!res.error || isConstraint(res.error, 'meals_pkey')) return; // Wiederholung: schon angekommen
            fail(res, t('err.saveMeal'));
          } else {
            const res = await run(supabase.from('meals').update({ name, source_url, product_ids }).eq('id', id));
            if (res.error) fail(res, t('err.saveMeal')); // 0 Zeilen = inzwischen gelöscht, nichts zu tun
          }
          return;
        }
        case 'deleteMeal': {
          const res = await run(supabase.from('meals').delete().eq('id', op.id));
          if (res.error) fail(res, t('err.deleteMeal'));
          return;
        }
        case 'planMeal': {
          const res = await run(
            supabase
              .from('meal_plan')
              .insert({ id: op.id, household_id: householdId, meal_id: op.mealId, day: op.day, position: op.position ?? null }),
          );
          if (!res.error) return;
          if (isConstraint(res.error, 'meal_plan_pkey')) return; // Wiederholung
          if (res.error.code === '23503') return; // Gericht inzwischen gelöscht
          fail(res, t('err.plan'));
          return;
        }
        case 'unplanMeal': {
          const res = await run(supabase.from('meal_plan').delete().eq('id', op.id));
          if (res.error) fail(res, t('err.plan'));
          return;
        }
        case 'upsertExpense': {
          const { id, amount_cents, spent_on, note } = op.expense;
          if (op.isNew) {
            const res = await run(
              supabase.from('expenses').insert({ id, household_id: householdId, amount_cents, spent_on, note }),
            );
            if (!res.error || isConstraint(res.error, 'expenses_pkey')) return; // Wiederholung
            fail(res, t('err.saveExpense'));
          } else {
            const res = await run(supabase.from('expenses').update({ amount_cents, spent_on, note }).eq('id', id));
            if (res.error) fail(res, t('err.saveExpense')); // 0 Zeilen = inzwischen gelöscht
          }
          return;
        }
        case 'deleteExpense': {
          const res = await run(supabase.from('expenses').delete().eq('id', op.id));
          if (res.error) fail(res, t('err.deleteExpense'));
          return;
        }
        case 'movePlan': {
          // 0 Zeilen = inzwischen entfernt, nichts zu tun
          const res = await run(
            supabase.from('meal_plan').update({ day: op.day, position: op.position }).eq('id', op.id),
          );
          if (res.error) fail(res, t('err.plan'));
          return;
        }
        default:
          throw new BackendError('permanent', t('err.unknownOp', { type: op.type }));
      }
    },

    async findByName(name) {
      const res = await run(
        supabase
          .from('products')
          .select(productColumns)
          .eq('household_id', householdId)
          .ilike('name', escapeLike(name))
          .limit(1),
      );
      if (res.error || !res.data?.length) return null;
      return pickProduct(res.data[0]);
    },

    /**
     * Realtime-Abo. DELETE-Ereignisse lassen sich laut Supabase-Doku nicht
     * filtern und enthalten unter RLS nur den Primärschlüssel; sie werden
     * daher ungefiltert abonniert und unbekannte ids ignoriert.
     */
    subscribe({ onChange, onStatus, onMealsStatus, onExpensesStatus }) {
      const filter = `household_id=eq.${householdId}`;
      const handler = (table) => (payload) => onChange(table, payload.eventType, payload.new, payload.old);
      const channel = supabase
        .channel(`household-${householdId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'products', filter }, handler('products'))
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'products', filter }, handler('products'))
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'products' }, handler('products'))
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'list_items', filter }, handler('list_items'))
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'list_items', filter }, handler('list_items'))
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'list_items' }, handler('list_items'))
        .subscribe((status, err) => onStatus(status, err));
      // Gerichte in einem eigenen Kanal: Fehlt deren Tabelle noch (Migration
      // nicht eingespielt), lehnt der Server das ganze Abo ab. Im selben Kanal
      // wären dann auch Produkte und Zettel ohne Echtzeit.
      const mealsChannel = supabase
        .channel(`household-meals-${householdId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'meals', filter }, handler('meals'))
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'meals', filter }, handler('meals'))
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'meals' }, handler('meals'))
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'meal_plan', filter }, handler('meal_plan'))
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'meal_plan', filter }, handler('meal_plan'))
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'meal_plan' }, handler('meal_plan'))
        .subscribe((status) => onMealsStatus?.(status));
      // Ausgaben ebenfalls eigener Kanal (Grund wie bei den Gerichten)
      const expensesChannel = supabase
        .channel(`household-expenses-${householdId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'expenses', filter }, handler('expenses'))
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'expenses', filter }, handler('expenses'))
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'expenses' }, handler('expenses'))
        .subscribe((status) => onExpensesStatus?.(status));
      return () => {
        supabase.removeChannel(channel);
        supabase.removeChannel(mealsChannel);
        supabase.removeChannel(expensesChannel);
      };
    },
  };
}

function isMissingTable(error) {
  return error?.code === 'PGRST205' || error?.code === '42P01' || /Could not find the table/i.test(error?.message || '');
}

/** Häufige Server-Meldungen auf Deutsch. */
export function humanMessage(error) {
  if (!error) return '';
  const msg = error.message || '';
  // Tabelle fehlt: Das SQL-Skript aus SETUP.md Schritt 3 wurde nicht ausgeführt.
  // Nur die Tabellen für Gerichte fehlen: Update-Schritt 8 statt Neueinrichtung
  if (isMissingTable(error) && /meal/.test(msg)) return t('err.mealsNotSetUp');
  if (isMissingTable(error) && /expenses/.test(msg)) return t('err.expensesNotSetUp');
  if (isMissingTable(error)) {
    return t('err.dbNotSetUp');
  }
  // Bekannte Meldungen aus den Datenbank-Funktionen (raise exception) übersetzen
  const known = {
    'Einladungscode ungültig': 'err.codeInvalid',
    'Haushalt hat bereits zwei Mitglieder': 'err.householdFull',
    'Du bist bereits in diesem Haushalt': 'err.alreadyMember',
    'Du gehörst bereits zu einem Haushalt': 'err.alreadyInHousehold',
  };
  if (known[msg]) return t(known[msg]);
  if (error.code === '42501') return t('err.noPermission');
  if (error.code === '23514') return t('err.invalidInput');
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return t('err.noConnection');
  return msg;
}

// ---------------------------------------------------------------------------
// Bon-Scan (Supabase Edge Function „receipt-scan“, siehe supabase/functions)
// ---------------------------------------------------------------------------

/**
 * Schickt ein Foto des Kassenbons an die Edge Function. Ergebnis:
 * { lines: [{text, quantity, unit_price_cents, product_id, sure}], total_cents, date }.
 * Wirft einen Error mit übersetzter Meldung.
 */
export async function scanReceipt(supabase, { image, mediaType }) {
  let res;
  try {
    res = await supabase.functions.invoke('receipt-scan', { body: { image, media_type: mediaType } });
  } catch (e) {
    throw new Error(t('err.noConnection'));
  }
  const { data, error } = res;
  if (!error) {
    if (!data || !Array.isArray(data.lines)) throw new Error(t('err.scanFailed'));
    return data;
  }
  throw new Error(scanErrorMessage(error, typeof navigator === 'undefined' || navigator.onLine));
}

/** Fehler der Edge Function in eine verständliche Meldung übersetzen. */
export function scanErrorMessage(error, online = true) {
  const status = error?.context?.status;
  if (status === 404 || status === 503) return t('err.scanNotSetUp'); // nicht bereitgestellt bzw. ohne API-Schlüssel
  if (status === 429) return t('err.scanLimit');
  if (status === 401) return t('err.noPermission');
  if (status) return t('err.scanFailed');
  // Kein Status: Netzwerkfehler. Online heißt meist: Funktion fehlt (ohne CORS-Antwort)
  return online ? t('err.scanUnreachable') : t('err.noConnection');
}

// ---------------------------------------------------------------------------
// Konto und Haushalt
// ---------------------------------------------------------------------------

export function authMessage(error) {
  const m = error?.message || '';
  if (/Invalid login credentials/i.test(m)) return t('auth.wrongCredentials');
  if (/already registered|already exists/i.test(m)) return t('auth.exists');
  if (/Email not confirmed/i.test(m)) return t('auth.notConfirmed');
  if (/Password should be at least/i.test(m)) return t('auth.passwordShort');
  if (/rate limit/i.test(m)) return t('auth.rateLimit');
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return t('err.noConnection');
  return m || t('auth.unknown');
}

/** Haushalt des Nutzers samt Mitgliederzahl, oder null. */
export async function loadHousehold(supabase) {
  const res = await supabase.from('households').select('id,name,invite_code,household_members(user_id)').maybeSingle();
  if (res.error) throw new BackendError(classifyError(res.error, res.status), humanMessage(res.error));
  if (!res.data) return null;
  const { household_members: members, ...h } = res.data;
  return { ...h, memberCount: members?.length ?? 0 };
}

export async function createHousehold(supabase, name) {
  const res = await supabase.rpc('create_household', { p_name: name });
  if (res.error) throw new Error(humanMessage(res.error));
  return res.data;
}

export async function joinHousehold(supabase, code) {
  const res = await supabase.rpc('join_household', { p_code: code });
  if (res.error) throw new Error(humanMessage(res.error));
  return res.data;
}

/** Per Code in einen anderen Haushalt wechseln (alter wird verlassen, siehe Migration 20261123000000). */
export async function switchHousehold(supabase, code) {
  const res = await supabase.rpc('switch_household', { p_code: code });
  if (res.error) throw new Error(humanMessage(res.error));
  return res.data;
}

export async function renameHousehold(supabase, id, name) {
  const res = await supabase.from('households').update({ name }).eq('id', id);
  if (res.error) throw new Error(humanMessage(res.error));
}
