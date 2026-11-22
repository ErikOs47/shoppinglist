// Supabase-Anbindung: setzt Operationen aus src/core/sync.js in DB-Aufrufe um
// und ordnet Fehler ein (vorübergehend vs. dauerhaft).

import { createClient } from '@supabase/supabase-js';
import { BackendError } from './core/sync.js';
import { snapshotFromRows, pickProduct } from './core/model.js';
import { t } from './i18n.js';

export function createSupabase(url, key) {
  return createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    realtime: { params: { eventsPerSecond: 20 } },
  });
}

const PAGE = 1000; // Supabase liefert standardmäßig höchstens 1000 Zeilen pro Abfrage
const PRODUCT_COLUMNS = 'id,name,category,favorite,purchase_count,last_purchased_at,created_at,updated_at';

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

  async function selectAll(table, columns) {
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
      if (res.error) fail(res, t('err.load'));
      rows.push(...res.data);
      if (res.data.length < PAGE) return rows;
    }
  }

  return {
    async fetchAll() {
      const [products, items] = await Promise.all([
        selectAll('products', PRODUCT_COLUMNS),
        selectAll('list_items', 'id,product_id,checked,position,created_at,updated_at'),
      ]);
      return snapshotFromRows(products, items);
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
        case 'setFavorite': {
          const res = await run(
            supabase.from('products').update({ favorite: op.favorite }).eq('id', op.productId),
          );
          if (res.error) fail(res, t('err.favorite'));
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
          .select(PRODUCT_COLUMNS)
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
    subscribe({ onChange, onStatus }) {
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
      return () => supabase.removeChannel(channel);
    },
  };
}

/** Häufige Server-Meldungen auf Deutsch. */
export function humanMessage(error) {
  if (!error) return '';
  const msg = error.message || '';
  // Tabelle fehlt: Das SQL-Skript aus SETUP.md Schritt 3 wurde nicht ausgeführt.
  if (error.code === 'PGRST205' || error.code === '42P01' || /Could not find the table/i.test(msg)) {
    return t('err.dbNotSetUp');
  }
  if (error.code === '42501') return t('err.noPermission');
  if (error.code === '23514') return t('err.invalidInput');
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return t('err.noConnection');
  return msg;
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

export async function renameHousehold(supabase, id, name) {
  const res = await supabase.from('households').update({ name }).eq('id', id);
  if (res.error) throw new Error(humanMessage(res.error));
}
