// App-Steuerung: Anmeldung, Haushalt, Tabs und Verdrahtung von UI ↔ SyncStore.

import {
  createSupabase,
  createBackend,
  loadHousehold,
  createHousehold,
  joinHousehold,
  renameHousehold,
  authMessage,
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
} from './ui/views.js';
import { toast, confirmDialog, openSheet, closeSheet } from './ui/dialogs.js';
import { enableSwipe, enableDrag } from './ui/gestures.js';
import { t, setLang, getLang, initialLang, LANGUAGES } from './i18n.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const app = document.getElementById('app');
const AUTO_SYNC_MS = 30_000;

const ui = {
  tab: readPref('tab', 'list'),
  query: '',
  editing: false,
  favoritesOnly: readPref('favoritesOnly', '0') === '1',
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

  if (ui.tab === 'products') {
    title = t('tab.products');
    actions = `<button class="icon-btn" data-action="new-product" aria-label="${esc(t('nav.addProduct'))}">${icons.plus}</button>${settingsBtn}`;
    const groups = productGroups(view, ui.query, { favoritesOnly: ui.favoritesOnly });
    const exact = Boolean(findProductByName(view, ui.query));
    content = productsHtml(groups, ui.query, exact, { favoritesOnly: ui.favoritesOnly });
  } else {
    title = t('tab.list');
    const editBtn = list.total
      ? `<button class="text-btn" data-action="toggle-edit">${esc(t(ui.editing ? 'done' : 'nav.edit'))}</button>`
      : '';
    actions = `${editBtn}${settingsBtn}`;
    content = shoppingHtml(list, ui.editing, suggestions(view, 8));
    extra = finishBarHtml(list.done.length);
  }

  // Suchfeld nicht neu erzeugen, sonst verliert es beim Tippen den Fokus.
  let shell = app.querySelector('.shell');
  if (!shell || shell.dataset.tab !== ui.tab || shell.dataset.lang !== getLang()) {
    app.innerHTML = `
      <div class="shell" data-tab="${ui.tab}" data-lang="${getLang()}">
        <div class="topbar">
        <div class="nav-slot"></div>
        ${
          ui.tab === 'products'
            ? `<div class="search-wrap">
                <div class="search">
                  <span class="glass">${icons.search}</span>
                  <input type="search" id="search" placeholder="${esc(t('search.placeholder'))}" value="${esc(ui.query)}"
                    autocomplete="off" autocorrect="off" enterkeyhint="done" aria-label="${esc(t('search.label'))}" />
                  <button class="clear" data-action="clear-search" aria-label="${esc(t('search.clear'))}" ${ui.query ? '' : 'hidden'}>${icons.clear}</button>
                </div>
              </div>`
            : ''
        }
        </div>
        <main id="content"></main>
        <div class="extra-slot"></div>
        <div class="tab-slot"></div>
      </div>`;
    shell = app.querySelector('.shell');
    const search = shell.querySelector('#search');
    if (search) {
      search.addEventListener('input', () => {
        ui.query = search.value;
        shell.querySelector('.clear').hidden = !ui.query;
        render();
      });
      search.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const q = cleanName(ui.query);
          if (q && !findProductByName(store.view, q)) openProductSheet({ name: q });
          else search.blur();
        }
      });
    }
  }
  shell.querySelector('.nav-slot').innerHTML = navHtml({ title, sync, actions });
  shell.querySelector('#content').innerHTML = content;
  shell.querySelector('.extra-slot').innerHTML = extra;
  shell.querySelector('.tab-slot').innerHTML = tabbarHtml(ui.tab, list.openCount);
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
    const id = li.dataset.productId;
    if (!store || !id) return;
    if (li.dataset.swipe === 'delete-product') {
      const name = store.view.products[id]?.name;
      store.dispatch({ type: 'deleteProduct', id });
      if (name) toast(t('products.deleted', { name }));
    } else {
      store.dispatch({ type: 'removeFromList', productId: id });
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
      ui.query = '';
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
      finishShopping();
      break;
    default:
      break;
  }
});

async function finishShopping() {
  const done = shoppingView(store.view).done;
  if (!done.length) return;
  const open = shoppingView(store.view).openCount;
  const ok = await confirmDialog({
    title: t('finish.title'),
    message: t('finish.message', { done: done.length, open }),
    confirmText: t('finish.confirm'),
  });
  if (!ok) return;
  store.dispatch({ type: 'finishShopping', productIds: done.map((d) => d.productId) });
  ui.editing = false;
  toast(t('finish.toast'));
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
        const id = product.id ?? uuid();
        store.dispatch({ type: 'upsertProduct', isNew, product: { id, name, category } });
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
      <span style="width:70px"></span>
      <h2>${esc(t('settings.title'))}</h2>
      <button type="button" class="text-btn strong" data-close style="width:70px;text-align:right">${esc(t('done'))}</button>
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
