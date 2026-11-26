// App-Steuerung: Anmeldung, Haushalt, Tabs und Verdrahtung von UI ↔ SyncStore.

import {
  createSupabase,
  createBackend,
  loadHousehold,
  createHousehold,
  joinHousehold,
  renameHousehold,
  switchHousehold,
  authMessage,
  scanReceipt,
} from './api.js';
import { SyncStore } from './core/sync.js';
import {
  allCategories,
  cleanName,
  findProductByName,
  FALLBACK_CATEGORY,
  nextPosition,
  positionAt,
  productGroups,
  shoppingView,
  suggestions,
  validateProduct,
  planCategoryRename,
  addDays,
  cleanProductIds,
  cleanUrl,
  ingredientChoices,
  mealIngredients,
  productsToListOps,
  isoDay,
  mealList,
  MAX_INGREDIENTS,
  nextPlanPosition,
  validateMeal,
  weekIngredients,
  upcomingDays,
  weekPlan,
  weekStart,
  expenseStats,
  parseAmount,
  parsePrice,
  listEstimate,
  matchReceiptLines,
  priceOps,
  clampQuantity,
} from './core/model.js';
import {
  esc,
  icons,
  navHtml,
  tabbarHtml,
  productsHtml,
  shoppingHtml,
  finishBarHtml,
  syncLabel,
  categoryOptions,
  weekHtml,
  dishesHtml,
  transferBarHtml,
  formatDay,
  mealViewHtml,
  expensesHtml,
  formatMoney,
  searchHtml,
} from './ui/views.js';
import { toast, confirmDialog, openSheet, closeSheet } from './ui/dialogs.js';
import { enableSwipe, enableDrag, enableDayDrag } from './ui/gestures.js';
import { t, setLang, getLang, initialLang, LANGUAGES, categoryLabel } from './i18n.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const app = document.getElementById('app');
const AUTO_SYNC_MS = 30_000;

const ui = {
  tab: readPref('tab', 'list'),
  query: '', // Suche im Tab „Produkte“
  mealQuery: '', // Suche in „Gerichte“
  collapsed: readCollapsed(), // eingeklappte Kategorien (pro Gerät)
  editing: false,
  favoritesOnly: readPref('favoritesOnly', '0') === '1',
  mealView: readPref('mealView', 'week'), // week | dishes
  expenseRange: readPref('expenseRange', 'weeks'), // weeks | months
  expenseSel: null, // gewählte Periode im Verlauf (null = aktuelle)
  weekOffset: 0, // 0 = aktuelle Woche
  gesture: false, // während Wischen/Verschieben nicht neu zeichnen
  renderPending: false,
  live: false,
  online: navigator.onLine,
};

let supabase = null;
let session = null;
let household = null;
let store = null;
let unsubscribeRealtime = null;
let unsubscribeStore = null;

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

function readPref(key, fallback) {
  try {
    return localStorage.getItem(`pref:${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}

function readCollapsed() {
  try {
    const list = JSON.parse(readPref('collapsed', '[]'));
    return new Set(Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(`pref:${key}`, value);
  } catch {
    /* nur Komfort, kein Datenverlust */
  }
}

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // Fallback für ältere Safari-Versionen ohne randomUUID (vor iOS 15.4)
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function householdCacheKey(userId) {
  return `household:${userId}`;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

function showFatal(title, detail) {
  app.innerHTML = `<div class="center"><h1>${esc(title)}</h1><p class="lead">${esc(detail)}</p></div>`;
  hideSplash();
}

/**
 * Ladebildschirm aus index.html ausblenden, sobald die erste richtige Ansicht
 * steht (Anmeldung, Haushalt einrichten, App, Fehler). Während „Lade …“ bleibt
 * er stehen.
 */
function hideSplash() {
  const el = document.getElementById('splash');
  if (!el || el.classList.contains('is-hidden')) return;
  el.classList.add('is-hidden');
  setTimeout(() => el.remove(), 350);
}

// ---------------------------------------------------------------------------
// Sprache: gilt pro Konto. Gespeichert in den Profildaten des eigenen
// Supabase-Kontos (user_metadata.lang), die nur das Konto selbst ändern kann;
// zusätzlich auf dem Gerät, damit die App schon vor der Anmeldung und offline
// in der richtigen Sprache startet.
// ---------------------------------------------------------------------------

setLang(initialLang({ stored: readPref('lang', null), deviceLangs: navigator.languages || [navigator.language] }));

/** Nach der Anmeldung: Sprache aus dem Konto übernehmen, falls dort gesetzt. */
function applyAccountLang(user) {
  const lang = user?.user_metadata?.lang;
  if (lang && lang !== getLang()) {
    setLang(lang);
    writePref('lang', getLang());
    return true;
  }
  return false;
}

async function changeLang(code) {
  setLang(code);
  writePref('lang', getLang());
  render();
  try {
    const { error } = await supabase.auth.updateUser({ data: { lang: getLang() } });
    if (error) throw error;
  } catch {
    toast(t('settings.languageLocalOnly'));
  }
}

async function boot() {
  window.__appStarted = true;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    showFatal(t('fatal.notConfigured'), t('fatal.notConfiguredText'));
    return;
  }
  try {
    supabase = createSupabase(SUPABASE_URL, SUPABASE_KEY);
  } catch (e) {
    // z. B. URL ohne https:// – sonst bliebe der Bildschirm leer
    showFatal(t('fatal.badUrl'), t('fatal.badUrlText', { msg: e.message }));
    return;
  }

  supabase.auth.onAuthStateChange((event, s) => {
    const prevUser = session?.user?.id;
    session = s;
    if (event === 'SIGNED_OUT') {
      teardown();
      renderAuth();
    } else if (event === 'SIGNED_IN' && s?.user?.id !== prevUser) {
      // setTimeout: Supabase empfiehlt, im Callback keine weiteren
      // Supabase-Aufrufe direkt abzuwarten (sonst Deadlock möglich).
      setTimeout(() => afterLogin(), 0);
    }
  });

  // Vor dem ersten await registrieren: Beim Offline-Start kann das Laden
  // lange hängen, und ein „online“-Ereignis in dieser Zeit ginge sonst verloren.
  window.addEventListener('online', () => {
    ui.online = true;
    if (store) {
      store.retryNow();
      store.resync().catch(() => {});
    }
    render();
  });
  window.addEventListener('offline', () => {
    ui.online = false;
    render();
  });
  // iOS friert Web-Apps im Hintergrund ein und trennt dabei den WebSocket.
  // Beim Zurückkehren daher sofort nachladen und offene Änderungen senden.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && store) {
      store.retryNow();
      store.resync().catch(() => {});
    }
  });

  const { data } = await supabase.auth.getSession();
  session = data.session;
  if (session) await afterLogin();
  else renderAuth();
}

let afterLoginRunning = false;
async function afterLogin() {
  if (afterLoginRunning || !session) return;
  afterLoginRunning = true;
  try {
    const userId = session.user.id;
    applyAccountLang(session.user);
    // Offline-Start: zuletzt bekannten Haushalt aus dem Cache nehmen.
    let cached = null;
    try {
      cached = JSON.parse(localStorage.getItem(householdCacheKey(userId)) || 'null');
    } catch {
      cached = null;
    }
    // Läuft der Store für diesen Haushalt schon (zweiter Aufruf durch
    // SIGNED_IN nach dem Start), nicht neu anlegen.
    const running = store && household?.id === cached?.id;
    if (cached && !running) startHousehold(cached);
    else if (running) render();
    else app.innerHTML = `<div class="center"><p class="lead">${esc(t('loading'))}</p></div>`;

    try {
      const h = await loadHousehold(supabase);
      if (!h) {
        localStorage.removeItem(householdCacheKey(userId));
        teardown();
        renderSetup();
        return;
      }
      localStorage.setItem(householdCacheKey(userId), JSON.stringify(h));
      if (!store || household?.id !== h.id) startHousehold(h);
      else {
        household = h;
        render();
      }
    } catch (e) {
      if (!cached) {
        // Nur bei echten Netzproblemen „Keine Verbindung“ zeigen; andere
        // Fehler (z. B. fehlende Tabellen) mit ihrer Ursache, sonst sucht man
        // an der falschen Stelle.
        const offline = e?.kind === 'transient';
        hideSplash();
        app.innerHTML = `<div class="center"><h1>${esc(t(offline ? 'load.offline' : 'load.error'))}</h1>
          <p class="lead">${esc(offline ? t('load.offlineText') : e?.message || String(e))}</p>
          <button class="btn" data-action="retry-boot">${esc(t('retry'))}</button>
          <div class="stack"><button class="text-btn" data-action="logout">${esc(t('logout'))}</button></div></div>`;
      }
    }
  } finally {
    afterLoginRunning = false;
  }
}

function startHousehold(h) {
  teardown();
  household = h;
  const backend = createBackend(supabase, h.id);
  store = new SyncStore({
    backend,
    storage: localStorage,
    storageKey: `store:${session.user.id}:${h.id}`,
  });
  store.onError((msg) => toast(msg, { error: true }));
  store.load();
  unsubscribeStore = store.subscribe(() => render());

  unsubscribeRealtime = backend.subscribe({
    onChange: (table, type, row, old) => store.applyRemote(table, type, row, old),
    onStatus: (status) => {
      const live = status === 'SUBSCRIBED';
      if (live !== ui.live) {
        ui.live = live;
        render();
      }
      // Nach jedem (Wieder-)Verbinden vollständig abgleichen, damit
      // verpasste Ereignisse nicht fehlen.
      if (live) store.resync().catch(() => {});
    },
    // Gerichte-Kanal: nach (Wieder-)Verbinden ebenfalls abgleichen
    onExpensesStatus: (status) => {
      if (status === 'SUBSCRIBED') store?.resync().catch(() => {});
    },
    onMealsStatus: (status) => {
      if (status === 'SUBSCRIBED') store?.resync().catch(() => {});
    },
  });

  // Sicherheitsnetz, falls ein Realtime-Ereignis verloren geht: alle 30 s
  // vollständig abgleichen. Nur im Vordergrund und mit Netz, damit im
  // Hintergrund kein Akku und kein Datenvolumen verbraucht wird.
  store.startAutoSync({
    intervalMs: AUTO_SYNC_MS,
    isActive: () => document.visibilityState === 'visible' && navigator.onLine,
  });

  store.flush();
  store.resync().catch(() => {});
  render();
}

function teardown() {
  store?.dispose();
  unsubscribeRealtime?.();
  unsubscribeStore?.();
  unsubscribeRealtime = null;
  unsubscribeStore = null;
  store = null;
  household = null;
  ui.live = false;
}

// ---------------------------------------------------------------------------
// Anmeldung
// ---------------------------------------------------------------------------

function renderAuth(mode = 'login', errorMsg = '') {
  const isSignup = mode === 'signup';
  app.innerHTML = `
    <form class="center" id="auth-form" novalidate>
      <img class="logo" src="./icons/icon-192.png" alt="" />
      <h1>${esc(t('appName'))}</h1>
      <p class="lead">${esc(t(isSignup ? 'auth.createAccount' : 'auth.tagline'))}</p>
      <div class="field-group">
        <div class="field"><label for="email">${esc(t('auth.email'))}</label>
          <input id="email" name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="off" required /></div>
        <div class="field"><label for="password">${esc(t('auth.password'))}</label>
          <input id="password" name="password" type="password" minlength="6"
            autocomplete="${isSignup ? 'new-password' : 'current-password'}" required /></div>
      </div>
      ${isSignup ? `<p class="hint">${esc(t('auth.minChars'))}</p>` : ''}
      <p class="error" id="auth-error">${esc(errorMsg)}</p>
      <div class="stack">
        <button class="btn" type="submit">${esc(t(isSignup ? 'auth.register' : 'auth.login'))}</button>
        <button class="btn secondary" type="button" data-action="auth-mode" data-mode="${isSignup ? 'login' : 'signup'}">
          ${esc(t(isSignup ? 'auth.haveAccount' : 'auth.newAccount'))}</button>
      </div>
    </form>`;

  const form = document.getElementById('auth-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    const password = form.password.value;
    const err = document.getElementById('auth-error');
    if (!email || !password) {
      err.textContent = t('auth.missing');
      return;
    }
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    err.textContent = '';
    try {
      if (isSignup) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          // Gewählte Sprache gleich ins neue Konto übernehmen
          options: { emailRedirectTo: location.href.split('#')[0], data: { lang: getLang() } },
        });
        if (error) throw error;
        if (!data.session) {
          renderAuth('login', '');
          toast(t('auth.confirmMail'), { ms: 8000 });
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (ex) {
      err.textContent = authMessage(ex);
    } finally {
      btn.disabled = false;
    }
  });
  form.querySelector('[data-action=auth-mode]').addEventListener('click', (e) => renderAuth(e.currentTarget.dataset.mode));
  hideSplash();
}

// ---------------------------------------------------------------------------
// Haushalt einrichten
// ---------------------------------------------------------------------------

function renderSetup(errorMsg = '') {
  app.innerHTML = `
    <div class="center">
      <img class="logo" src="./icons/icon-192.png" alt="" />
      <h1>${esc(t('setup.title'))}</h1>
      <p class="lead">${esc(t('setup.lead'))}</p>

      <form id="create-form" novalidate>
        <div class="field-group">
          <div class="field"><label for="hh-name">${esc(t('name'))}</label>
            <input id="hh-name" name="name" maxlength="60" placeholder="${esc(t('setup.namePlaceholder'))}" required /></div>
        </div>
        <div class="stack"><button class="btn" type="submit">${esc(t('setup.create'))}</button></div>
      </form>

      <p class="divider">${esc(t('setup.or'))}</p>

      <form id="join-form" novalidate>
        <div class="field-group">
          <div class="field"><label for="hh-code">${esc(t('setup.code'))}</label>
            <input id="hh-code" name="code" placeholder="${esc(t('setup.codePlaceholder'))}" autocapitalize="characters" autocomplete="off" spellcheck="false" required /></div>
        </div>
        <div class="stack"><button class="btn secondary" type="submit">${esc(t('setup.join'))}</button></div>
      </form>

      <p class="error" id="setup-error">${esc(errorMsg)}</p>
      <div class="stack"><button class="text-btn" data-action="logout">${esc(t('setup.logoutAs', { email: session?.user?.email ?? '' }))}</button></div>
    </div>`;

  const handle = (form, fn) =>
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        await fn();
        await afterLogin();
      } catch (ex) {
        document.getElementById('setup-error').textContent = ex.message;
      } finally {
        btn.disabled = false;
      }
    });

  const cf = document.getElementById('create-form');
  handle(cf, async () => {
    const name = cleanName(cf.name.value);
    if (!name) throw new Error(t('setup.nameMissing'));
    await createHousehold(supabase, name);
  });
  const jf = document.getElementById('join-form');
  handle(jf, async () => {
    const code = jf.code.value.trim();
    if (!code) throw new Error(t('setup.codeMissing'));
    await joinHousehold(supabase, code);
  });
  hideSplash();
}

// ---------------------------------------------------------------------------
// Hauptansicht
// ---------------------------------------------------------------------------

function render() {
  if (!store || !household) return;
  // Ein Realtime-Ereignis mitten in einer Geste würde die Zeile unter dem
  // Finger ersetzen. Daher aufschieben, bis die Geste vorbei ist.
  if (ui.gesture) {
    ui.renderPending = true;
    return;
  }
  ui.renderPending = false;
  const view = store.view;
  const sync = syncLabel({ status: store.status, pending: store.pendingCount, live: ui.live, online: ui.online });
  const list = shoppingView(view);
  const settingsBtn = `<button class="icon-btn" data-action="settings" aria-label="${esc(t('nav.settings'))}">${icons.person}</button>`;

  let content;
  let actions;
  let extra = '';
  let title;

  if (ui.tab === 'expenses') {
    title = t('tab.expenses');
    actions = `<button class="icon-btn" data-action="scan-receipt" aria-label="${esc(t('expenses.scan'))}">${icons.camera}</button><button class="icon-btn" data-action="new-expense" aria-label="${esc(t('expenses.add'))}">${icons.plus}</button>${settingsBtn}`;
    content = expensesHtml(expenseStats(view, isoDay()), { range: ui.expenseRange, selected: ui.expenseSel });
  } else if (ui.tab === 'meals') {
    title = t('tab.meals');
    actions = `<button class="icon-btn" data-action="new-meal" aria-label="${esc(t('meals.newDish'))}">${icons.plus}</button>${settingsBtn}`;
    if (ui.mealView === 'dishes') {
      content = dishesHtml(mealList(view, ui.mealQuery), (m) => mealIngredients(view, m), { query: ui.mealQuery });
    } else {
      const today = isoDay();
      const monday = addDays(weekStart(today), ui.weekOffset * 7);
      const days = weekPlan(view, monday);
      content = weekHtml(days, { monday, today, offset: ui.weekOffset });
      // Zutaten übernehmen nur für heute und später (Vergangenes ist gegessen)
      extra = transferBarHtml(upcomingDays(days, today).some((d) => d.entries.length));
    }
  } else if (ui.tab === 'products') {
    title = t('tab.products');
    actions = `<button class="icon-btn" data-action="new-product" aria-label="${esc(t('nav.addProduct'))}">${icons.plus}</button>${settingsBtn}`;
    const groups = productGroups(view, ui.query, { favoritesOnly: ui.favoritesOnly });
    const exact = Boolean(findProductByName(view, ui.query));
    content = productsHtml(groups, ui.query, exact, { favoritesOnly: ui.favoritesOnly, collapsed: ui.collapsed });
  } else {
    title = t('tab.list');
    const editBtn = list.total
      ? `<button class="text-btn" data-action="toggle-edit">${esc(t(ui.editing ? 'done' : 'nav.edit'))}</button>`
      : '';
    actions = `${editBtn}${settingsBtn}`;
    content = shoppingHtml(list, ui.editing, suggestions(view, 8), listEstimate(view));
    extra = finishBarHtml(list.done.length);
  }

  // Kopfbereich (Suchfeld, Umschalter) nicht neu erzeugen, sonst verliert das
  // Suchfeld beim Tippen den Fokus. Neu nur bei anderem Tab, anderer Ansicht
  // in „Essen“ oder anderer Sprache.
  const shellKey = `${ui.tab}|${ui.tab === 'meals' ? ui.mealView : ''}|${getLang()}`;
  let shell = app.querySelector('.shell');
  if (!shell || shell.dataset.key !== shellKey) {
    let top = '';
    if (ui.tab === 'products') {
      top = `<div class="search-wrap">${searchHtml(ui.query, t('search.placeholder'), t('search.label'))}</div>`;
    } else if (ui.tab === 'meals') {
      top = `<div class="search-wrap">${mealViewHtml(ui.mealView)}${
        ui.mealView === 'dishes' ? searchHtml(ui.mealQuery, t('meals.searchPlaceholder')) : ''
      }</div>`;
    }
    app.innerHTML = `
      <div class="shell" data-key="${esc(shellKey)}">
        <div class="topbar">
        <div class="nav-slot"></div>
        ${top}
        </div>
        <main id="content"></main>
        <div class="extra-slot"></div>
        <div class="tab-slot"></div>
      </div>`;
    shell = app.querySelector('.shell');
    const search = shell.querySelector('#search');
    if (search) {
      const key = searchKey();
      search.addEventListener('input', () => {
        ui[key] = search.value;
        shell.querySelector('.clear').hidden = !ui[key];
        render();
      });
      search.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const q = cleanName(ui.query);
          if (key === 'query' && q && !findProductByName(store.view, q)) openProductSheet({ name: q });
          else search.blur();
        }
      });
    }
  }
  shell.querySelector('.nav-slot').innerHTML = navHtml({ title, sync, actions });
  shell.querySelector('#content').innerHTML = content;
  shell.querySelector('.extra-slot').innerHTML = extra;
  shell.querySelector('.tab-slot').innerHTML = tabbarHtml(ui.tab, list.openCount);
  hideSplash();
}

/** Welcher Suchbegriff zum Suchfeld im Kopfbereich gehört. */
function searchKey() {
  return ui.tab === 'meals' ? 'mealQuery' : 'query';
}

// ---------------------------------------------------------------------------
// Aktionen (Event-Delegation)
// ---------------------------------------------------------------------------

/** Auf den Zettel, hinten an die offenen Artikel. */
function addToList(productId) {
  if (store.view.items[productId]) return;
  store.dispatch({ type: 'addToList', id: uuid(), productId, position: nextPosition(store.view) });
}

function setGesture(active) {
  ui.gesture = active;
  if (!active && ui.renderPending) render();
}

// Wischen: im Tab „Produkte“ Produkt löschen, auf dem Zettel nur entfernen.
enableSwipe(app, {
  onActive: setGesture,
  onCommit: (li) => {
    if (!store) return;
    const pid = li.dataset.productId;
    const id = li.dataset.id;
    switch (li.dataset.swipe) {
      case 'delete-product': {
        const name = store.view.products[pid]?.name;
        store.dispatch({ type: 'deleteProduct', id: pid });
        if (name) toast(t('products.deleted', { name }));
        break;
      }
      case 'remove-item':
        store.dispatch({ type: 'removeFromList', productId: pid });
        break;
      case 'unplan':
        store.dispatch({ type: 'unplanMeal', id });
        break;
      case 'delete-expense':
        store.dispatch({ type: 'deleteExpense', id });
        toast(t('expenses.deleted'));
        break;
      case 'delete-meal': {
        const name = store.view.meals[id]?.name;
        store.dispatch({ type: 'deleteMeal', id });
        if (name) toast(t('meal.deleted', { name }));
        break;
      }
      default:
        break;
    }
  },
});

// Verschieben auf dem Zettel (nur offene Artikel).
enableDrag(app, {
  onActive: setGesture,
  onDrop: (productId, toIndex) => {
    if (!store) return;
    const others = shoppingView(store.view).open.filter((r) => r.productId !== productId);
    store.dispatch({ type: 'moveItem', productId, position: positionAt(others, toIndex) });
  },
});

// Gerichte im Wochenplan zwischen Tagen und innerhalb eines Tages verschieben.
enableDayDrag(app, {
  onActive: setGesture,
  onDrop: (entryId, day, toIndex) => {
    if (!store?.view.plan[entryId]) return;
    const monday = addDays(weekStart(isoDay()), ui.weekOffset * 7);
    const target = weekPlan(store.view, monday).find((d) => d.day === day);
    if (!target) return;
    const others = target.entries.filter((e) => e.id !== entryId);
    store.dispatch({ type: 'movePlan', id: entryId, day, position: positionAt(others, toIndex) });
  },
});

app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const id = el.dataset.id;

  switch (action) {
    case 'retry-boot':
      afterLogin();
      break;
    case 'logout':
      logout();
      break;
    case 'tab':
      ui.tab = el.dataset.tab;
      ui.editing = false;
      writePref('tab', ui.tab);
      render();
      window.scrollTo(0, 0);
      break;
    case 'settings':
      openSettings();
      break;
    case 'new-product':
      openProductSheet({ name: cleanName(ui.query) });
      break;
    case 'quick-add':
      openProductSheet({ name: cleanName(ui.query) });
      break;
    case 'clear-search': {
      ui[searchKey()] = '';
      const s = document.getElementById('search');
      s.value = '';
      el.hidden = true;
      render();
      s.focus();
      break;
    }
    case 'edit-product':
      openProductSheet(store.view.products[id]);
      break;
    case 'toggle-list': {
      if (store.view.items[id]) store.dispatch({ type: 'removeFromList', productId: id });
      else addToList(id);
      break;
    }
    case 'toggle-check': {
      const it = store.view.items[id];
      if (it) store.dispatch({ type: 'setChecked', productId: id, checked: !it.checked });
      break;
    }
    case 'remove-item':
      store.dispatch({ type: 'removeFromList', productId: id });
      break;
    case 'qty-inc':
    case 'qty-dec': {
      const it = store.view.items[id];
      if (!it) break;
      const q = clampQuantity((it.quantity ?? 1) + (action === 'qty-inc' ? 1 : -1));
      if (q !== it.quantity) store.dispatch({ type: 'setQuantity', productId: id, quantity: q });
      break;
    }
    case 'toggle-favorite': {
      const p = store.view.products[id];
      if (p) store.dispatch({ type: 'setFavorite', productId: id, favorite: !p.favorite });
      break;
    }
    case 'filter':
      ui.favoritesOnly = el.dataset.filter === 'fav';
      writePref('favoritesOnly', ui.favoritesOnly ? '1' : '0');
      render();
      break;
    case 'suggest-add':
      addToList(id);
      break;
    case 'toggle-edit':
      ui.editing = !ui.editing;
      render();
      break;
    case 'finish':
      openFinishSheet();
      break;
    case 'scan-receipt':
      openFinishSheet({ mode: 'receipt' });
      break;
    case 'new-expense':
      openExpenseSheet();
      break;
    case 'open-expense':
      if (store.view.expenses[id]) openExpenseSheet(store.view.expenses[id]);
      break;
    case 'expense-range':
      ui.expenseRange = el.dataset.range === 'months' ? 'months' : 'weeks';
      ui.expenseSel = null;
      writePref('expenseRange', ui.expenseRange);
      render();
      break;
    case 'expense-select':
      ui.expenseSel = el.dataset.key;
      render();
      break;
    case 'toggle-category': {
      const cat = el.dataset.category;
      if (ui.collapsed.has(cat)) ui.collapsed.delete(cat);
      else ui.collapsed.add(cat);
      writePref('collapsed', JSON.stringify([...ui.collapsed]));
      render();
      break;
    }
    case 'rename-category':
      openCategorySheet(el.dataset.category);
      break;
    case 'meal-view':
      ui.mealView = el.dataset.view === 'dishes' ? 'dishes' : 'week';
      writePref('mealView', ui.mealView);
      render();
      break;
    case 'week-prev':
    case 'week-next':
    case 'week-today':
      ui.weekOffset = action === 'week-today' ? 0 : ui.weekOffset + (action === 'week-next' ? 1 : -1);
      render();
      break;
    case 'new-meal':
      openMealSheet();
      break;
    case 'open-meal':
      if (store.view.meals[id]) openMealSheet(store.view.meals[id]);
      break;
    case 'plan-add':
      openPickSheet(el.dataset.day);
      break;
    case 'transfer':
      openTransferSheet();
      break;
    default:
      break;
  }
});

/**
 * Einkauf abschließen (mode 'finish') bzw. nur einen Bon erfassen (mode
 * 'receipt', aus „Ausgaben“): bezahlten Betrag, Preise der gekauften Produkte
 * und optional einen gescannten Bon übernehmen.
 */
function openFinishSheet({ mode = 'finish' } = {}) {
  const finishing = mode === 'finish';
  const list = shoppingView(store.view);
  const done = finishing ? list.done : [];
  if (finishing && !done.length) return;
  let lines = []; // gescannte Bon-Zeilen (matchReceiptLines)
  let receiptDate = null;

  const priceField = (d, i) => {
    const price = store.view.products[d.productId]?.price_cents;
    return `
      <div class="field price-field">
        <label for="pr-${i}">${d.quantity > 1 ? `${d.quantity} × ` : ''}${esc(d.name)}</label>
        <input id="pr-${i}" data-price-for="${esc(d.productId)}" data-name="${esc(d.name)}" inputmode="decimal"
          value="${esc(amountInput(price))}" placeholder="–" autocomplete="off" aria-label="${esc(t('price.for', { name: d.name }))}" /><span class="unit">€</span>
      </div>`;
  };

  openSheet(
    `
    <form id="finish-form" novalidate>
      <div class="sheet-head">
        <button type="button" class="text-btn" data-close>${esc(t('cancel'))}</button>
        <h2>${esc(t(finishing ? 'finish.sheetTitle' : 'receipt.title'))}</h2>
        <button type="submit" class="text-btn strong">${esc(t(finishing ? 'finish.confirm' : 'receipt.save'))}</button>
      </div>
      <div class="sheet-body">
        ${finishing ? `<p class="hint" data-testid="finish-message">${esc(t('finish.message', { done: done.length, open: list.openCount }))}</p>` : ''}
        <div class="field-group">
          <div class="field"><label for="f-amount">${esc(t('finish.amountLabel'))}</label>
            <input id="f-amount" name="amount" inputmode="decimal" placeholder="${esc(t('finish.amountPlaceholder'))}" autocomplete="off" /><span class="unit">€</span></div>
        </div>
        <button type="button" class="btn secondary scan-btn" data-scan>${icons.camera}<span>${esc(t('finish.scan'))}</span></button>
        <input type="file" accept="image/*" hidden data-file />
        <p class="hint" id="scan-status" role="status" aria-live="polite"></p>
        ${
          finishing
            ? `<h3>${esc(t('finish.prices'))}</h3>
               <div class="field-group">${done.map(priceField).join('')}</div>
               <p class="hint">${esc(t('finish.pricesHint'))}</p>`
            : ''
        }
        <div id="receipt-lines"></div>
        <p class="error" id="f-error"></p>
      </div>
    </form>`,
    (dlg, close) => {
      const form = dlg.querySelector('#finish-form');
      const err = dlg.querySelector('#f-error');
      const status = dlg.querySelector('#scan-status');
      const scanBtn = dlg.querySelector('[data-scan]');
      const file = dlg.querySelector('[data-file]');
      const linesBox = dlg.querySelector('#receipt-lines');
      dlg.querySelector('[data-close]').addEventListener('click', close);

      const products = Object.values(store.view.products).sort((a, b) => a.name.localeCompare(b.name, getLang()));
      const cartInput = (productId) =>
        [...form.querySelectorAll('[data-price-for]')].find((el) => el.dataset.priceFor === productId);

      function renderLines() {
        if (!lines.length) {
          linesBox.innerHTML = '';
          return;
        }
        linesBox.innerHTML = `
          <h3>${esc(t('finish.fromReceipt'))}</h3>
          <div class="field-group">${lines
            .map((l, i) => {
              const options = products
                .map((p) => `<option value="${esc(p.id)}" ${p.id === l.productId ? 'selected' : ''}>${esc(p.name)}</option>`)
                .join('');
              return `
                <div class="receipt-line" data-testid="receipt-line" data-text="${esc(l.text)}">
                  <div class="receipt-text"><span>${esc(l.text)}${l.quantity > 1 ? ` ×${l.quantity}` : ''}</span>${
                    l.productId && !l.sure ? `<span class="check-badge">${esc(t('finish.check'))}</span>` : ''
                  }<span>${esc(formatMoney(l.priceCents))}</span></div>
                  <span class="select-wrap"><select data-line="${i}" aria-label="${esc(t('finish.lineLabel', { text: l.text }))}">
                    <option value="">${esc(t('finish.skipLine'))}</option>${options}
                  </select>${icons.chevronR}</span>
                </div>`;
            })
            .join('')}</div>
          <p class="hint">${esc(t('finish.receiptHint'))}</p>`;
      }

      linesBox.addEventListener('change', (e) => {
        const sel = e.target.closest('select[data-line]');
        if (!sel) return;
        const l = lines[Number(sel.dataset.line)];
        l.productId = sel.value || null;
        l.sure = true; // von Hand bestätigt
        sel.closest('.receipt-line').querySelector('.check-badge')?.remove();
        const input = l.productId && cartInput(l.productId);
        if (input) input.value = amountInput(l.priceCents);
      });

      scanBtn.addEventListener('click', () => file.click());
      file.addEventListener('change', async () => {
        const f = file.files?.[0];
        file.value = '';
        if (!f) return;
        scanBtn.disabled = true;
        scanBtn.setAttribute('aria-busy', 'true');
        status.textContent = t('finish.scanning');
        status.classList.remove('error');
        try {
          let image;
          try {
            image = await receiptImage(f);
          } catch {
            throw new Error(t('err.scanImage'));
          }
          const result = await scanReceipt(supabase, image);
          lines = matchReceiptLines(store.view, result.lines);
          for (const l of lines) {
            const input = l.productId && cartInput(l.productId);
            if (input) input.value = amountInput(l.priceCents);
          }
          if (Number.isInteger(result.total_cents) && result.total_cents > 0 && !form.amount.value.trim()) {
            form.amount.value = amountInput(result.total_cents);
          }
          receiptDate = /^\d{4}-\d{2}-\d{2}$/.test(result.date ?? '') && result.date <= isoDay() ? result.date : null;
          status.textContent = t('finish.scanResult', { n: lines.length, m: lines.filter((l) => l.productId).length });
          renderLines();
        } catch (e) {
          status.textContent = e.message;
          status.classList.add('error');
        } finally {
          scanBtn.disabled = false;
          scanBtn.removeAttribute('aria-busy');
        }
      });

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const amountText = form.amount.value.trim();
        const cents = amountText ? parseAmount(amountText) : null;
        if (amountText && !cents) {
          err.textContent = t('expenses.errAmount');
          return;
        }
        // Bon zuerst, dann die Felder: Was im Feld steht, gilt
        const entries = lines
          .filter((l) => l.productId)
          .map((l) => ({ productId: l.productId, priceCents: l.priceCents, receiptName: l.text }));
        for (const input of form.querySelectorAll('[data-price-for]')) {
          const v = input.value.trim();
          const price = v ? parsePrice(v) : null;
          if (v && !price) {
            err.textContent = t('price.errFor', { name: input.dataset.name });
            input.focus();
            return;
          }
          entries.push({ productId: input.dataset.priceFor, priceCents: price });
        }
        const ops = priceOps(store.view, entries);
        if (!finishing && !ops.length && !cents) {
          err.textContent = t('receipt.nothing');
          return;
        }
        for (const op of ops) store.dispatch(op);
        if (finishing) store.dispatch({ type: 'finishShopping', productIds: done.map((d) => d.productId) });
        if (cents) {
          store.dispatch({
            type: 'upsertExpense',
            isNew: true,
            expense: { id: uuid(), amount_cents: cents, spent_on: receiptDate ?? isoDay(), note: null },
          });
        }
        if (finishing) ui.editing = false;
        close();
        if (finishing) toast(cents ? t('finish.toastAmount', { amount: formatMoney(cents) }) : t('finish.toast'));
        else toast(cents ? t('receipt.savedAmount', { n: ops.length, amount: formatMoney(cents) }) : t('receipt.saved', { n: ops.length }));
      });
    },
  );
}

/**
 * Foto für den Bon-Scan: auf höchstens 2000 px lange Kante verkleinern und als
 * JPEG (Base64) liefern. Spart Upload und Kosten; Bon-Text bleibt lesbar.
 */
async function receiptImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return { image: dataUrl.slice(dataUrl.indexOf(',') + 1), mediaType: 'image/jpeg' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------------------
// Ausgabe anlegen / bearbeiten
// ---------------------------------------------------------------------------

/** Betrag in Cent als Eingabetext in der eingestellten Sprache („23,40“). */
function amountInput(cents) {
  if (!cents) return '';
  return (cents / 100).toLocaleString(getLang() === 'en' ? 'en-GB' : getLang() === 'pt' ? 'pt-PT' : 'de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  });
}

function openExpenseSheet(expense = {}) {
  const isNew = !expense.id;
  openSheet(
    `
    <form id="expense-form" novalidate>
      <div class="sheet-head">
        <button type="button" class="text-btn" data-close>${esc(t('cancel'))}</button>
        <h2>${esc(t(isNew ? 'expenses.new' : 'expenses.edit'))}</h2>
        <button type="submit" class="text-btn strong">${esc(t(isNew ? 'meal.add' : 'meal.save'))}</button>
      </div>
      <div class="sheet-body">
        <div class="field-group">
          <div class="field"><label for="x-amount">${esc(t('expenses.amount'))}</label>
            <input id="x-amount" name="amount" inputmode="decimal" value="${esc(amountInput(expense.amount_cents))}"
              placeholder="${esc(t('finish.amountPlaceholder'))}" autocomplete="off" required /><span class="unit">€</span></div>
          <div class="field"><label for="x-date">${esc(t('expenses.date'))}</label>
            <input id="x-date" name="date" type="date" value="${esc(expense.spent_on || isoDay())}" required /></div>
          <div class="field"><label for="x-note">${esc(t('expenses.note'))}</label>
            <input id="x-note" name="note" maxlength="80" value="${esc(expense.note || '')}" placeholder="${esc(t('expenses.notePlaceholder'))}" autocomplete="off" /></div>
        </div>
        <p class="error" id="x-error"></p>
        ${isNew ? '' : `<div class="stack"><button type="button" class="btn danger" data-delete>${esc(t('expenses.delete'))}</button></div>`}
      </div>
    </form>`,
    (dlg, close) => {
      const form = dlg.querySelector('#expense-form');
      const err = dlg.querySelector('#x-error');
      dlg.querySelector('[data-close]').addEventListener('click', close);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const cents = parseAmount(form.amount.value);
        if (!cents) {
          err.textContent = t('expenses.errAmount');
          return;
        }
        const date = form.date.value;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          err.textContent = t('expenses.errDate');
          return;
        }
        const note = cleanName(form.note.value) || null;
        store.dispatch({
          type: 'upsertExpense',
          isNew,
          expense: { id: expense.id ?? uuid(), amount_cents: cents, spent_on: date, note },
        });
        close();
      });
      dlg.querySelector('[data-delete]')?.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: t('expenses.deleteTitle'),
          message: `${expense.note || t('expenses.defaultNote')} · ${formatMoney(expense.amount_cents)}`,
          confirmText: t('expenses.deleteConfirm'),
          destructive: true,
        });
        if (!ok) return;
        store.dispatch({ type: 'deleteExpense', id: expense.id });
        close();
        toast(t('expenses.deleted'));
      });
      if (isNew) setTimeout(() => !dlg.contains(document.activeElement) && form.amount.focus(), 50);
    },
  );
}

// ---------------------------------------------------------------------------
// Produkt anlegen / bearbeiten
// ---------------------------------------------------------------------------

function openProductSheet(product = {}) {
  const isNew = !product.id;
  const categories = allCategories(store.view);
  const selected = product.category || FALLBACK_CATEGORY;
  const onList = !isNew && Boolean(store.view.items[product.id]);

  openSheet(
    `
    <form id="product-form" novalidate>
      <div class="sheet-head">
        <button type="button" class="text-btn" data-close>${esc(t('cancel'))}</button>
        <h2>${esc(t(isNew ? 'product.new' : 'product.edit'))}</h2>
        <button type="submit" class="text-btn strong">${esc(t(isNew ? 'product.add' : 'product.save'))}</button>
      </div>
      <div class="sheet-body">
        <div class="field-group">
          <div class="field"><label for="p-name">${esc(t('name'))}</label>
            <input id="p-name" name="name" maxlength="80" value="${esc(product.name || '')}" placeholder="${esc(t('product.namePlaceholder'))}" autocomplete="off" required /></div>
          <div class="field"><label for="p-cat">${esc(t('product.category'))}</label>
            <select id="p-cat" name="category">${categoryOptions(categories, selected)}</select></div>
          <div class="field" id="new-cat-field" hidden><label for="p-newcat">${esc(t('product.newCategory'))}</label>
            <input id="p-newcat" name="newcat" maxlength="40" placeholder="${esc(t('product.newCategoryPlaceholder'))}" autocomplete="off" /></div>
          <div class="field"><label for="p-price">${esc(t('price.label'))}</label>
            <input id="p-price" name="price" inputmode="decimal" value="${esc(amountInput(product.price_cents))}" placeholder="${esc(t('price.placeholder'))}" autocomplete="off" /><span class="unit">€</span></div>
        </div>
        ${isNew ? `<label class="hint" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="addToList" checked /> ${esc(t('product.addToListNow'))}</label>` : ''}
        <p class="error" id="p-error"></p>
        ${
          isNew
            ? ''
            : `<div class="stack">
                <button type="button" class="btn secondary" data-toggle-list>${esc(t(onList ? 'product.removeFromList' : 'product.addToList'))}</button>
                <button type="button" class="btn danger" data-delete>${esc(t('product.delete'))}</button>
              </div>`
        }
      </div>
    </form>`,
    (dlg, close) => {
      const form = dlg.querySelector('#product-form');
      const cat = form.category;
      const newCatField = dlg.querySelector('#new-cat-field');
      const err = dlg.querySelector('#p-error');

      cat.addEventListener('change', () => {
        newCatField.hidden = cat.value !== '__new__';
        if (!newCatField.hidden) form.newcat.focus();
      });
      dlg.querySelector('[data-close]').addEventListener('click', close);

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = cleanName(form.name.value);
        const category = cat.value === '__new__' ? cleanName(form.newcat.value) : cat.value;
        const problem = validateProduct(store.view, { id: product.id ?? null, name, category });
        if (problem) {
          err.textContent = problem;
          return;
        }
        const priceText = form.price.value.trim();
        const priceCents = priceText ? parsePrice(priceText) : null;
        if (priceText && !priceCents) {
          err.textContent = t('price.err');
          return;
        }
        const id = product.id ?? uuid();
        store.dispatch({ type: 'upsertProduct', isNew, product: { id, name, category } });
        for (const op of priceOps(store.view, [{ productId: id, priceCents }])) store.dispatch(op);
        if (isNew && form.addToList?.checked) addToList(id);
        if (isNew) {
          ui.query = '';
          const s = document.getElementById('search');
          if (s) s.value = '';
          render();
        }
        close();
      });

      dlg.querySelector('[data-toggle-list]')?.addEventListener('click', () => {
        if (store.view.items[product.id]) store.dispatch({ type: 'removeFromList', productId: product.id });
        else addToList(product.id);
        close();
      });

      dlg.querySelector('[data-delete]')?.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: t('product.deleteTitle', { name: product.name }),
          message: t('product.deleteText'),
          confirmText: t('product.deleteConfirm'),
          destructive: true,
        });
        if (!ok) return;
        store.dispatch({ type: 'deleteProduct', id: product.id });
        close();
      });

      if (isNew) setTimeout(() => (product.name ? cat : form.name).focus(), 50);
    },
  );
}

// ---------------------------------------------------------------------------
// Kategorie umbenennen
// ---------------------------------------------------------------------------

/**
 * Benennt eine Kategorie für den ganzen Haushalt um (alle Produkte darin).
 * Gibt es den Namen schon, wird nach Rückfrage zusammengeführt.
 */
function openCategorySheet(category) {
  const label = categoryLabel(category);
  const count = Object.values(store.view.products).filter((p) => p.category === category).length;
  openSheet(
    `
    <form id="category-form" novalidate>
      <div class="sheet-head">
        <button type="button" class="text-btn" data-close>${esc(t('cancel'))}</button>
        <h2>${esc(t('category.renameTitle'))}</h2>
        <button type="submit" class="text-btn strong">${esc(t('product.save'))}</button>
      </div>
      <div class="sheet-body">
        <div class="field-group">
          <div class="field"><label for="c-name">${esc(t('name'))}</label>
            <input id="c-name" name="name" maxlength="40" value="${esc(label)}" autocomplete="off" required /></div>
        </div>
        <p class="hint">${esc(t('category.renameHint', { n: count }))}</p>
        <p class="error" id="c-error"></p>
      </div>
    </form>`,
    (dlg, close) => {
      const form = dlg.querySelector('#category-form');
      const err = dlg.querySelector('#c-error');
      dlg.querySelector('[data-close]').addEventListener('click', close);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const plan = planCategoryRename(store.view, category, form.name.value);
        if (plan.error) {
          err.textContent = plan.error;
          return;
        }
        if (plan.unchanged) {
          close();
          return;
        }
        const toLabel = categoryLabel(plan.to);
        if (plan.merge) {
          const ok = await confirmDialog({
            title: t('category.mergeTitle', { name: toLabel }),
            message: t('category.mergeText', { n: count, from: label, to: toLabel }),
            confirmText: t('category.mergeConfirm'),
          });
          if (!ok) return;
        }
        store.dispatch({ type: 'renameCategory', from: category, to: plan.to });
        // Eingeklappt bleibt eingeklappt, auch unter dem neuen Namen
        if (ui.collapsed.delete(category)) {
          ui.collapsed.add(plan.to);
          writePref('collapsed', JSON.stringify([...ui.collapsed]));
        }
        close();
        toast(t(plan.merge ? 'category.merged' : 'category.renamed', { from: label, to: toLabel }));
      });
      setTimeout(() => form.name.select(), 50);
    },
  );
}

// ---------------------------------------------------------------------------
// Essen: Gericht anlegen/bearbeiten, einplanen, Zutaten auf den Zettel
// ---------------------------------------------------------------------------

/**
 * Gericht-Editor. Zutaten werden aus der Produktliste gewählt (antippen fügt
 * hinzu oder entfernt); fehlt ein Produkt, wird es hier angelegt.
 * `planDay`: nach dem Anlegen gleich an diesem Tag einplanen (Aufruf aus
 * „Gericht wählen“).
 */
function openMealSheet(meal = {}, { planDay = null } = {}) {
  const isNew = !meal.id;
  // Reihenfolge des Hinzufügens bleibt erhalten; gelöschte Produkte fallen weg
  let selected = mealIngredients(store.view, meal).map((p) => p.id);
  let query = '';

  openSheet(
    `
    <form id="meal-form" novalidate>
      <div class="sheet-head">
        <button type="button" class="text-btn" data-close>${esc(t('cancel'))}</button>
        <h2>${esc(t(isNew ? 'meal.new' : 'meal.edit'))}</h2>
        <button type="submit" class="text-btn strong">${esc(t(isNew ? 'meal.add' : 'meal.save'))}</button>
      </div>
      <div class="sheet-body">
        <div class="field-group">
          <div class="field"><label for="m-name">${esc(t('name'))}</label>
            <input id="m-name" name="name" maxlength="80" value="${esc(meal.name || '')}" placeholder="${esc(t('meal.namePlaceholder'))}" autocomplete="off" required /></div>
          <div class="field"><label for="m-url">${esc(t('meal.link'))}</label>
            <input id="m-url" name="url" type="url" inputmode="url" maxlength="2000" value="${esc(meal.source_url || '')}" placeholder="https://…" autocomplete="off" autocapitalize="off" spellcheck="false" /></div>
        </div>
        ${
          meal.source_url && cleanUrl(meal.source_url)
            ? `<div class="link-actions"><a class="text-btn" href="${esc(cleanUrl(meal.source_url))}" target="_blank" rel="noopener noreferrer">${esc(t('meal.openLink'))}</a></div>`
            : ''
        }

        <h3 class="sheet-section" id="m-ing-title"></h3>
        <div class="chips wrap" data-testid="ingredients"></div>

        <div class="search sheet-search">
          <span class="glass">${icons.search}</span>
          <input type="search" id="m-q" name="q" placeholder="${esc(t('meal.pickSearch'))}" aria-label="${esc(t('meal.pickSearch'))}"
            autocomplete="off" enterkeyhint="done" />
        </div>
        <ul class="list choice-list" data-testid="choices"></ul>
        <p class="error" id="m-error"></p>
        ${isNew ? '' : `<div class="stack"><button type="button" class="btn danger" data-delete>${esc(t('meal.delete'))}</button></div>`}
      </div>
    </form>`,
    (dlg, close) => {
      const form = dlg.querySelector('#meal-form');
      const chips = dlg.querySelector('[data-testid=ingredients]');
      const choices = dlg.querySelector('[data-testid=choices]');
      const title = dlg.querySelector('#m-ing-title');
      const search = form.q;
      const err = dlg.querySelector('#m-error');

      const draw = () => {
        const view = store.view;
        selected = selected.filter((id) => view.products[id]); // vom Partner gelöscht
        title.textContent = t('meal.ingredientsN', { n: selected.length });
        chips.innerHTML = selected.length
          ? selected
              .map((id) => {
                const name = view.products[id].name;
                return `<button type="button" class="chip removable" data-remove="${esc(id)}" data-testid="ingredient" data-name="${esc(name)}"
                  aria-label="${esc(t('meal.ingredientRemove', { name }))}"><span>${esc(name)}</span>${icons.clear}</button>`;
              })
              .join('')
          : `<p class="hint" style="margin:0 4px">${esc(t('meal.noIngredients'))}</p>`;

        const q = cleanName(query);
        const list = ingredientChoices(view, selected, q);
        let html = '';
        if (q && !findProductByName(view, q)) {
          html += `<li class="row add-row"><div class="row-inner">
            <button type="button" class="row-main" data-create>
              <span class="plus">${icons.plus}</span>
              <span class="row-name">${esc(t('meal.createProduct', { name: q }))}</span>
            </button></div></li>`;
        }
        html += list
          .map(
            (c) => `<li class="row ${c.selected ? 'on' : ''}"><div class="row-inner">
              <button type="button" class="row-main" data-pick="${esc(c.id)}" data-testid="choice" data-name="${esc(c.name)}"
                role="checkbox" aria-checked="${c.selected}">
                <span class="check">${icons.check}</span>
                <span class="row-name">${esc(c.name)}</span>
              </button></div></li>`,
          )
          .join('');
        if (!html) html = `<li class="row"><div class="row-inner"><span class="row-main row-sub">${esc(t('meal.noProducts'))}</span></div></li>`;
        choices.innerHTML = html;
      };
      draw();
      // Änderungen des Partners (neue/umbenannte Produkte) sofort übernehmen
      const unsubscribe = store.subscribe(() => draw());
      dlg.addEventListener('close', unsubscribe, { once: true });

      const toggle = (id) => {
        err.textContent = '';
        if (selected.includes(id)) selected = selected.filter((x) => x !== id);
        else if (selected.length >= MAX_INGREDIENTS) err.textContent = t('meal.tooMany');
        else selected = [...selected, id];
        draw();
      };

      const createProduct = () => {
        const name = cleanName(query);
        const problem = validateProduct(store.view, { name, category: FALLBACK_CATEGORY });
        if (problem) {
          err.textContent = problem;
          return;
        }
        const id = uuid();
        store.dispatch({ type: 'upsertProduct', isNew: true, product: { id, name, category: FALLBACK_CATEGORY } });
        query = '';
        search.value = '';
        toggle(id);
        toast(t('meal.productCreated', { name }));
      };

      search.addEventListener('input', () => {
        query = search.value;
        draw();
      });
      search.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault(); // nicht das ganze Gericht speichern
        const q = cleanName(query);
        if (!q) return;
        const existing = findProductByName(store.view, q);
        if (existing) {
          if (!selected.includes(existing.id)) toggle(existing.id);
          query = '';
          search.value = '';
          draw();
        } else {
          createProduct();
        }
      });
      // Return in Name oder Link springt zur Produktsuche, statt das Gericht
      // halbfertig zu speichern und das Sheet zu schließen.
      for (const field of [form.name, form.url]) {
        field.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            search.focus();
          }
        });
      }
      choices.addEventListener('click', (e) => {
        if (e.target.closest('[data-create]')) return createProduct();
        const b = e.target.closest('[data-pick]');
        if (b) toggle(b.dataset.pick);
      });
      chips.addEventListener('click', (e) => {
        const b = e.target.closest('[data-remove]');
        if (b) toggle(b.dataset.remove);
      });

      dlg.querySelector('[data-close]').addEventListener('click', close);

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = cleanName(form.name.value);
        const problem = validateMeal(store.view, { id: meal.id ?? null, name, sourceUrl: form.url.value });
        if (problem) {
          err.textContent = problem;
          return;
        }
        const id = meal.id ?? uuid();
        store.dispatch({
          type: 'upsertMeal',
          isNew,
          meal: { id, name, source_url: cleanUrl(form.url.value), product_ids: cleanProductIds(selected) },
        });
        if (isNew && planDay) planMeal(id, planDay);
        close();
      });

      dlg.querySelector('[data-delete]')?.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: t('meal.deleteTitle', { name: meal.name }),
          message: t('meal.deleteText'),
          confirmText: t('meal.deleteConfirm'),
          destructive: true,
        });
        if (!ok) return;
        store.dispatch({ type: 'deleteMeal', id: meal.id });
        close();
      });

      // Nur fokussieren, wenn noch kein Feld aktiv ist (sonst springt die Eingabe weg)
      if (isNew) setTimeout(() => !dlg.contains(document.activeElement) && form.name.focus(), 50);
    },
  );
}

function planMeal(mealId, day) {
  store.dispatch({ type: 'planMeal', id: uuid(), mealId, day, position: nextPlanPosition(store.view, day) });
}

/** Gericht für einen Tag auswählen (mit Filter) oder neu anlegen. */
function openPickSheet(day) {
  const label = formatDay(day, { weekday: 'long', day: 'numeric', month: 'numeric' });
  openSheet(
    `
    <div class="sheet-head">
      <button type="button" class="text-btn" data-close>${esc(t('cancel'))}</button>
      <h2>${esc(t('meals.pickTitle'))}</h2>
      <span></span>
    </div>
    <div class="sheet-body">
      <p class="hint" style="margin-top:0">${esc(label)}</p>
      <div class="search sheet-search">
        <span class="glass">${icons.search}</span>
        <input type="search" id="pick-q" placeholder="${esc(t('meals.searchPlaceholder'))}" autocomplete="off" aria-label="${esc(t('meals.searchPlaceholder'))}" />
      </div>
      <ul class="list pick-list" style="margin-top:12px"></ul>
      <div class="stack"><button type="button" class="btn secondary" data-new>${esc(t('meal.new'))}</button></div>
    </div>`,
    (dlg, close) => {
      const list = dlg.querySelector('.pick-list');
      const q = dlg.querySelector('#pick-q');
      const draw = () => {
        const meals = mealList(store.view, q.value);
        list.hidden = !meals.length && !q.value;
        list.innerHTML = meals.length
          ? meals
              .map(
                (m) => `<li class="row"><div class="row-inner">
                  <button class="row-main" data-pick="${esc(m.id)}" data-testid="pick" data-name="${esc(m.name)}">
                    <span class="plus">${icons.plus}</span>
                    <span class="row-text"><span class="row-name">${esc(m.name)}</span>
                    <span class="row-sub">${esc(t('meals.ingredientsCount', { n: mealIngredients(store.view, m).length }))}</span></span>
                  </button></div></li>`,
              )
              .join('')
          : `<li class="row"><div class="row-inner"><span class="row-main row-sub">${esc(t(q.value ? 'meals.noResults' : 'meals.pickEmpty'))}</span></div></li>`;
      };
      draw();
      q.addEventListener('input', draw);
      list.addEventListener('click', (e) => {
        const b = e.target.closest('[data-pick]');
        if (!b) return;
        const m = store.view.meals[b.dataset.pick];
        if (!m) return;
        planMeal(m.id, day);
        close();
        toast(t('meals.planned', { name: m.name }));
      });
      dlg.querySelector('[data-close]').addEventListener('click', close);
      dlg.querySelector('[data-new]').addEventListener('click', () => {
        close();
        openMealSheet({ name: cleanName(q.value) }, { planDay: day });
      });
    },
  );
}

/**
 * Zutaten der angezeigten Woche als Checkliste. Vorausgewählt ist alles, was
 * noch nicht auf dem Zettel steht; vorhandene Zutaten tippt man weg.
 */
function openTransferSheet() {
  const today = isoDay();
  const monday = addDays(weekStart(today), ui.weekOffset * 7);
  const rows = weekIngredients(store.view, upcomingDays(weekPlan(store.view, monday), today));
  const selected = new Set(rows.filter((r) => !r.onList).map((r) => r.productId));

  openSheet(
    `
    <div class="sheet-head">
      <button type="button" class="text-btn" data-close>${esc(t('cancel'))}</button>
      <h2>${esc(t('transfer.title'))}</h2>
      <span></span>
    </div>
    <div class="sheet-body">
      ${monday < today ? `<p class="hint" style="margin-top:0" data-testid="transfer-from">${esc(t('transfer.fromToday'))}</p>` : ''}
      ${rows.length ? `<p class="hint" style="margin-top:0">${esc(t('transfer.hint'))}</p>` : `<p class="hint">${esc(t('transfer.empty'))}</p>`}
      <ul class="list" data-testid="transfer-list">${rows
        .map(
          (r) => `<li class="row ${r.onList ? 'done' : ''}" data-key="${esc(r.productId)}">
            <div class="row-inner">
              <button class="row-main" data-testid="transfer-row" data-name="${esc(r.name)}" role="checkbox"
                aria-checked="${r.onList ? 'true' : 'false'}" ${r.onList ? 'disabled' : ''}>
                <span class="check">${icons.check}</span>
                <span class="row-text">
                  <span class="row-name">${esc(r.name)}</span>
                  <span class="row-sub">${esc(r.onList ? t('transfer.onList') : r.meals.join(' · '))}</span>
                </span>
              </button>
            </div>
          </li>`,
        )
        .join('')}</ul>
      <div class="sheet-foot"><button type="button" class="btn" data-confirm data-testid="transfer-confirm"></button></div>
    </div>`,
    (dlg, close) => {
      const confirm = dlg.querySelector('[data-confirm]');
      const draw = () => {
        for (const li of dlg.querySelectorAll('li[data-key]')) {
          const r = rows.find((x) => x.productId === li.dataset.key);
          if (r.onList) continue;
          const on = selected.has(r.productId);
          li.classList.toggle('on', on);
          li.querySelector('[role=checkbox]').setAttribute('aria-checked', String(on));
        }
        confirm.textContent = t('transfer.confirm', { n: selected.size });
        confirm.disabled = selected.size === 0;
        confirm.hidden = rows.length === 0;
      };
      draw();
      dlg.querySelector('[data-testid=transfer-list]').addEventListener('click', (e) => {
        const li = e.target.closest('li[data-key]');
        if (!li || li.classList.contains('done')) return;
        if (selected.has(li.dataset.key)) selected.delete(li.dataset.key);
        else selected.add(li.dataset.key);
        draw();
      });
      dlg.querySelector('[data-close]').addEventListener('click', close);
      confirm.addEventListener('click', () => {
        // Stand zum Zeitpunkt des Tippens: Inzwischen vom Partner Ergänztes wird nicht doppelt angefügt
        const ops = productsToListOps(store.view, [...selected], uuid);
        for (const op of ops) store.dispatch(op);
        const n = ops.length;
        close();
        toast(n ? t('transfer.done', { n }) : t('transfer.nothing'));
      });
    },
  );
}

// ---------------------------------------------------------------------------
// Einstellungen
// ---------------------------------------------------------------------------

async function openSettings() {
  // Aktuellen Stand (z. B. ob der Partner beigetreten ist) nachladen.
  try {
    const h = await loadHousehold(supabase);
    if (h) {
      household = h;
      localStorage.setItem(householdCacheKey(session.user.id), JSON.stringify(h));
    }
  } catch {
    /* offline: zwischengespeicherten Stand zeigen */
  }
  const full = household.memberCount >= 2;
  openSheet(
    `
    <div class="sheet-head">
      <span></span>
      <h2>${esc(t('settings.title'))}</h2>
      <button type="button" class="text-btn strong" data-close>${esc(t('done'))}</button>
    </div>
    <div class="sheet-body">
      <form id="rename-form" novalidate>
        <div class="field-group">
          <div class="field"><label for="s-name">${esc(t('settings.household'))}</label>
            <input id="s-name" name="name" maxlength="60" value="${esc(household.name)}" /></div>
        </div>
      </form>
      <p class="hint">${esc(t('settings.members', { n: household.memberCount }))}</p>

      ${
        full
          ? ''
          : `<p class="hint" style="margin-bottom:6px">${esc(t('settings.inviteHint'))}</p>
             <div class="code" data-testid="invite-code">${esc(household.invite_code)}</div>
             <div class="stack"><button class="btn secondary" data-share>${esc(t('settings.share'))}</button></div>`
      }

      <form id="switch-form" novalidate style="margin-top:28px">
        <p class="hint" style="margin-bottom:6px"><strong>${esc(t('switch.title'))}</strong></p>
        <div class="field-group">
          <div class="field"><label for="s-code">${esc(t('setup.code'))}</label>
            <input id="s-code" name="code" placeholder="${esc(t('setup.codePlaceholder'))}" autocapitalize="characters"
              autocomplete="off" spellcheck="false" /></div>
        </div>
        <p class="hint">${esc(t('switch.hint', { name: household.name }))}</p>
        <div class="stack"><button class="btn secondary" type="submit">${esc(t('switch.button'))}</button></div>
      </form>

      <div class="field-group" style="margin-top:28px">
        <div class="field"><label for="s-lang">${esc(t('settings.language'))}</label>
          <select id="s-lang" name="lang">${LANGUAGES.map(
            (l) => `<option value="${l.code}" ${l.code === getLang() ? 'selected' : ''}>${esc(l.name)}</option>`,
          ).join('')}</select></div>
      </div>
      <p class="hint">${esc(t('settings.languageHint'))}</p>

      <p class="hint" style="margin-top:28px">${esc(t('settings.loggedInAs', { email: session.user.email }))}</p>
      <div class="stack"><button class="btn danger" data-logout>${esc(t('logout'))}</button></div>
    </div>`,
    (dlg, close) => {
      dlg.querySelector('[data-close]').addEventListener('click', close);
      const form = dlg.querySelector('#rename-form');
      const save = async () => {
        const name = cleanName(form.name.value);
        if (!name || name === household.name) return;
        try {
          await renameHousehold(supabase, household.id, name);
          household.name = name;
          toast(t('settings.nameSaved'));
        } catch (e) {
          toast(e.message, { error: true });
        }
      };
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        form.name.blur();
      });
      form.name.addEventListener('change', save);
      dlg.querySelector('[data-share]')?.addEventListener('click', async () => {
        const text = t('settings.shareText', { code: household.invite_code });
        try {
          if (navigator.share) await navigator.share({ text, url: location.href.split('#')[0] });
          else {
            await navigator.clipboard.writeText(household.invite_code);
            toast(t('settings.codeCopied'));
          }
        } catch {
          /* Teilen abgebrochen */
        }
      });
      const switchForm = dlg.querySelector('#switch-form');
      switchForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = switchForm.code.value.trim();
        if (!code) {
          toast(t('setup.codeMissing'), { error: true });
          return;
        }
        // Noch nicht gesendete Änderungen gehören zum alten Haushalt und
        // gingen beim Wechsel verloren. Daher erst nach dem Senden wechseln.
        if (store?.pendingCount) {
          toast(t('switch.pending'), { error: true, ms: 6000 });
          return;
        }
        const alone = household.memberCount <= 1;
        const ok = await confirmDialog({
          title: t('switch.confirmTitle'),
          message: alone
            ? t('switch.confirmAlone', { name: household.name, n: Object.keys(store?.view.products ?? {}).length })
            : t('switch.confirmShared', { name: household.name }),
          confirmText: t('switch.button'),
          destructive: true,
        });
        if (!ok) return;
        const btn = switchForm.querySelector('[type=submit]');
        btn.disabled = true;
        const userId = session.user.id;
        const oldId = household.id;
        try {
          const target = await switchHousehold(supabase, code);
          close();
          localStorage.removeItem(householdCacheKey(userId));
          localStorage.removeItem(`store:${userId}:${oldId}`); // Zwischenspeicher des alten Haushalts
          teardown();
          await afterLogin();
          toast(t('switch.done', { name: target?.name ?? '' }));
        } catch (ex) {
          toast(ex.message, { error: true, ms: 5000 });
          btn.disabled = false;
        }
      });

      dlg.querySelector('#s-lang').addEventListener('change', async (e) => {
        await changeLang(e.target.value);
        // Sheet in der neuen Sprache neu aufbauen
        close();
        openSettings();
      });
      dlg.querySelector('[data-logout]').addEventListener('click', () => {
        close();
        logout();
      });
    },
  );
}

async function logout() {
  if (store?.pendingCount) {
    const ok = await confirmDialog({
      title: t('logout.pendingTitle'),
      message: t('logout.pendingText', { n: store.pendingCount }),
      confirmText: t('logout.pendingConfirm'),
      destructive: true,
    });
    if (!ok) return;
  }
  closeSheet();
  teardown();
  await supabase.auth.signOut({ scope: 'local' });
  renderAuth();
}

// ---------------------------------------------------------------------------
// Service Worker (Offline-Start, Installation)
// ---------------------------------------------------------------------------

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

boot().catch((e) => showFatal(t('fatal.start'), e?.message || String(e)));
