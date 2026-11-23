// HTML-Vorlagen. Alle Nutzerdaten laufen durch esc(), damit Produktnamen
// kein HTML einschleusen können. Texte kommen aus i18n.js.

import { t, categoryLabel, getLang } from '../i18n.js';
import { addDays, isoWeek } from '../core/model.js';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Feine Linien-Icons (1,6 px), passend zur Systemschrift.
const svg = (body, vb = 24, sw = 1.6) =>
  `<svg viewBox="0 0 ${vb} ${vb}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 24, 3),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 24, 2),
  info: svg('<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M14.5 7.5l2 2"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>', 24, 1.8),
  clear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="var(--surface)" stroke-width="1.8" stroke-linecap="round"/></svg>',
  person: svg('<circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5c1.4-3 4-4.5 7-4.5s5.6 1.5 7 4.5"/>'),
  products: svg('<rect x="4" y="4" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2"/>'),
  list: svg('<path d="M4 6.5l1.5 1.5L8 5.5M4 12.5l1.5 1.5L8 11.5"/><path d="M11 7h9M11 13h9M11 19h9"/><circle cx="6" cy="19" r="1"/>'),
  bag: svg('<path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>'),
  star: svg('<path d="M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z"/>'),
  grip: svg('<path d="M5 9h14M5 15h14"/>', 24, 1.8),
  trash: svg('<path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12.5h9l1-12.5M10 11v5.5M14 11v5.5"/>'),
  meals: svg('<path d="M7 3.5v7.5M4.5 3.5v4.5a2.5 2.5 0 0 0 5 0V3.5M7 11v9.5"/><path d="M17.5 20.5V3.5c-2.2 1-3.5 3.6-3.5 7v2.5h3.5"/>'),
  chevronL: svg('<path d="M14.5 5.5L8 12l6.5 6.5"/>', 24, 2),
  chevronR: svg('<path d="M9.5 5.5L16 12l-6.5 6.5"/>', 24, 2),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
};

/**
 * Roter Hintergrund, der beim Wischen sichtbar wird. Nur ein Symbol: Durch den
 * Widerstand ist der sichtbare Streifen zu schmal für Text. Die Schwelle
 * erkennt man an Farbe und Größe des Symbols.
 */
function swipeBg() {
  return `<div class="swipe-bg" aria-hidden="true">${icons.trash}</div>`;
}

function starButton(p) {
  const fav = Boolean(p.favorite);
  return `<button class="star-btn ${fav ? 'is-fav' : ''}" data-action="toggle-favorite" data-id="${esc(p.id)}"
    aria-pressed="${fav}" aria-label="${esc(t(fav ? 'products.favRemove' : 'products.favAdd', { name: p.name }))}">${icons.star}</button>`;
}


export function syncLabel({ status, pending, live, online }) {
  if (!online || status === 'offline') {
    const p = pending ? ` · ${t('sync.pending', { n: pending })}` : '';
    return { cls: 'offline', text: `${t('sync.offline')}${p}` };
  }
  if (status === 'syncing' || pending) return { cls: 'syncing', text: t('sync.syncing') };
  if (!live) return { cls: 'syncing', text: t('sync.connecting') };
  return { cls: 'live', text: t('sync.live') };
}

export function navHtml({ title, sync, actions = '' }) {
  return `
    <header class="nav">
      <div class="nav-row">
        <span class="sync ${sync.cls}" data-testid="sync"><span class="dot"></span>${esc(sync.text)}</span>
        <div class="nav-actions">${actions}</div>
      </div>
      <h1>${esc(title)}</h1>
    </header>`;
}

export function tabbarHtml(tab, listCount) {
  // Badge sitzt am Icon, damit „Einkaufszettel“ auch auf schmalen iPhones passt.
  const badge = listCount ? `<span class="badge" data-testid="badge">${listCount}</span>` : '';
  return `
    <nav class="tabbar" role="tablist">
      <button class="tab" role="tab" data-action="tab" data-tab="products" aria-selected="${tab === 'products'}">
        <span class="tab-icon">${icons.products}</span><span>${esc(t('tab.products'))}</span>
      </button>
      <button class="tab" role="tab" data-action="tab" data-tab="list" aria-selected="${tab === 'list'}">
        <span class="tab-icon">${icons.list}${badge}</span><span>${esc(t('tab.list'))}</span>
      </button>
      <button class="tab" role="tab" data-action="tab" data-tab="meals" aria-selected="${tab === 'meals'}">
        <span class="tab-icon">${icons.meals}</span><span>${esc(t('tab.meals'))}</span>
      </button>
    </nav>`;
}

export function filterHtml(favoritesOnly) {
  return `
    <div class="segmented" role="tablist" aria-label="${esc(t('filter.label'))}">
      <button role="tab" data-action="filter" data-filter="all" aria-selected="${!favoritesOnly}">${esc(t('filter.all'))}</button>
      <button role="tab" data-action="filter" data-filter="fav" aria-selected="${favoritesOnly}">${icons.star}${esc(t('filter.favorites'))}</button>
    </div>`;
}

export function productsHtml(groups, query, exactMatch, { favoritesOnly = false } = {}) {
  const q = query.trim();
  let html = filterHtml(favoritesOnly);
  if (q && !exactMatch) {
    html += `
      <div class="group">
        <ul class="list">
          <li class="row add-row"><div class="row-inner">
            <button class="row-main" data-action="quick-add">
              <span class="plus">${icons.plus}</span>
              <span class="row-name">${esc(t('products.quickAdd', { q }))}</span>
            </button>
          </div></li>
        </ul>
      </div>`;
  }
  if (groups.length === 0 && favoritesOnly && !q) {
    return html + `<div class="empty"><div class="empty-icon">${icons.star}</div><strong>${esc(t('products.emptyFavTitle'))}</strong>${esc(t('products.emptyFavText'))}</div>`;
  }
  if (groups.length === 0 && !q) {
    return html + `<div class="empty"><div class="empty-icon">${icons.products}</div><strong>${esc(t('products.emptyTitle'))}</strong>${esc(t('products.emptyText'))}</div>`;
  }
  if (groups.length === 0) {
    return html + `<div class="empty">${esc(t('products.noResults'))}</div>`;
  }
  for (const g of groups) {
    html += `
      <section class="group">
        <h2>${esc(categoryLabel(g.category))}</h2>
        <ul class="list">
          ${g.products
            .map(
              (p) => `
            <li class="row swipe ${p.onList ? 'on' : ''}" data-testid="product" data-name="${esc(p.name)}"
                data-swipe="delete-product" data-product-id="${esc(p.id)}">
              ${swipeBg()}
              <div class="row-inner">
                <button class="row-main" data-action="toggle-list" data-id="${esc(p.id)}"
                  aria-pressed="${p.onList}" aria-label="${esc(p.name)}${p.onList ? esc(t('products.onList')) : ''}">
                  <span class="check">${icons.check}</span>
                  <span class="row-name">${esc(p.name)}</span>
                </button>
                ${starButton(p)}
                <button class="info-btn" data-action="edit-product" data-id="${esc(p.id)}" aria-label="${esc(t('products.editLabel', { name: p.name }))}">${icons.info}</button>
              </div>
            </li>`,
            )
            .join('')}
        </ul>
      </section>`;
  }
  return html;
}

function itemRow(it, editing, done) {
  const remove = editing
    ? `<button class="remove-btn" data-action="remove-item" data-id="${esc(it.productId)}" aria-label="${esc(t('list.removeLabel', { name: it.name }))}"><span></span></button>`
    : '';
  const handle = done
    ? ''
    : `<button class="drag-handle" data-drag aria-label="${esc(t('list.moveLabel', { name: it.name }))}">${icons.grip}</button>`;
  return `
    <li class="row swipe ${done ? 'done' : ''}" data-testid="item" data-name="${esc(it.name)}" data-checked="${done}"
        data-swipe="remove-item" data-product-id="${esc(it.productId)}">
      ${swipeBg()}
      <div class="row-inner">
        ${remove}
        <button class="row-main" data-action="toggle-check" data-id="${esc(it.productId)}"
          role="checkbox" aria-checked="${done}" aria-label="${esc(it.name)}">
          <span class="check">${icons.check}</span>
          <span class="row-name">${esc(it.name)}${it.favorite ? `<span class="fav-dot" aria-hidden="true">${icons.star}</span>` : ''}</span>
        </button>
        ${handle}
      </div>
    </li>`;
}

function suggestionsHtml(list) {
  if (!list.length) return '';
  return `
    <section class="group suggestions" aria-label="${esc(t('list.suggestions'))}">
      <h2>${esc(t('list.oftenBought'))}</h2>
      <div class="chips">
        ${list
          .map(
            (p) => `<button class="chip" data-action="suggest-add" data-id="${esc(p.id)}" data-testid="suggestion"
              aria-label="${esc(t('list.suggestAdd', { name: p.name }))}">${icons.plus}<span>${esc(p.name)}</span></button>`,
          )
          .join('')}
      </div>
    </section>`;
}

export function shoppingHtml(view, editing, suggested = []) {
  if (view.total === 0) {
    return `${suggestionsHtml(suggested)}<div class="empty"><div class="empty-icon">${icons.bag}</div><strong>${esc(t('list.emptyTitle'))}</strong>${esc(t('list.emptyText'))}</div>`;
  }
  const pct = Math.round((view.done.length / view.total) * 100);
  let html = `
    <div class="counter" aria-label="${esc(t('list.counterLabel', { open: view.openCount, done: view.done.length }))}">
      <span>${esc(t('list.counter', { open: view.openCount, done: view.done.length }))}</span>
      <span class="progress"><span style="width:${pct}%"></span></span>
    </div>`;
  html += suggestionsHtml(suggested);
  if (view.open.length) {
    html += `
      <section class="group">
        <ul class="list sortable" data-testid="open-list">${view.open.map((it) => itemRow(it, editing, false)).join('')}</ul>
      </section>`;
  }
  if (view.done.length) {
    html += `
      <section class="group">
        <h2>${esc(t('list.inCart'))}</h2>
        <ul class="list">${view.done.map((it) => itemRow(it, editing, true)).join('')}</ul>
      </section>`;
  }
  return html;
}

export function finishBarHtml(doneCount) {
  if (!doneCount) return '';
  return `
    <div class="finish-bar">
      <button class="btn" data-action="finish" data-testid="finish">${esc(t('list.finishButton', { n: doneCount }))}</button>
    </div>`;
}

export function categoryOptions(categories, selected) {
  const opts = categories
    .map((c) => `<option value="${esc(c)}" ${c === selected ? 'selected' : ''}>${esc(categoryLabel(c))}</option>`)
    .join('');
  return `${opts}<option value="__new__">${esc(t('product.newCategoryOption'))}</option>`;
}

// ---------------------------------------------------------------------------
// Essen: Wochenplan und Gerichte
// ---------------------------------------------------------------------------

const LOCALES = { de: 'de-DE', en: 'en-GB', pt: 'pt-PT' };

/** Datum 'YYYY-MM-DD' in der eingestellten Sprache formatieren. */
export function formatDay(iso, options) {
  const d = new Date(`${iso}T12:00:00Z`);
  return new Intl.DateTimeFormat(LOCALES[getLang()] ?? getLang(), { ...options, timeZone: 'UTC' }).format(d);
}

export function mealViewHtml(view) {
  return `
    <div class="segmented" role="tablist" aria-label="${esc(t('meals.viewLabel'))}">
      <button role="tab" data-action="meal-view" data-view="week" aria-selected="${view === 'week'}">${esc(t('meals.week'))}</button>
      <button role="tab" data-action="meal-view" data-view="dishes" aria-selected="${view === 'dishes'}">${esc(t('meals.dishes'))}</button>
    </div>`;
}

/** `m.ingredients`: Zutaten als Produkte (gelöschte schon herausgefiltert). */
function mealRow(m, { swipe, id, action = 'open-meal', mealId }) {
  const count = m.ingredients?.length ?? 0;
  return `
    <li class="row swipe" data-testid="${swipe === 'unplan' ? 'planned' : 'meal'}" data-name="${esc(m.name)}"
        data-swipe="${swipe}" data-id="${esc(id)}">
      ${swipeBg()}
      <div class="row-inner">
        <button class="row-main" data-action="${action}" data-id="${esc(mealId)}" aria-label="${esc(t('meals.openDish', { name: m.name }))}">
          <span class="row-text">
            <span class="row-name">${esc(m.name)}</span>
            <span class="row-sub">${esc(t('meals.ingredientsCount', { n: count }))}</span>
          </span>
          ${m.source_url ? `<span class="row-icon" aria-hidden="true">${icons.link}</span>` : ''}
        </button>
      </div>
    </li>`;
}

export function weekHtml(days, { monday, today, offset }) {
  const sunday = addDays(monday, 6);
  const range = `${formatDay(monday, { day: 'numeric', month: 'short' })} – ${formatDay(sunday, { day: 'numeric', month: 'short' })}`;
  let html = `${mealViewHtml('week')}
    <div class="week-nav">
      <button class="icon-btn" data-action="week-prev" aria-label="${esc(t('meals.prevWeek'))}">${icons.chevronL}</button>
      <div class="week-label" data-testid="week-label">
        <strong>${esc(t('meals.weekTitle', { week: isoWeek(monday) }))}</strong>
        <span>${esc(range)}</span>
        ${offset ? `<button class="text-btn" data-action="week-today">${esc(t('meals.thisWeek'))}</button>` : ''}
      </div>
      <button class="icon-btn" data-action="week-next" aria-label="${esc(t('meals.nextWeek'))}">${icons.chevronR}</button>
    </div>`;
  const planned = days.some((d) => d.entries.length);
  if (!planned) html += `<p class="hint center-hint">${esc(t('meals.weekEmpty'))}</p>`;
  for (const d of days) {
    const label = formatDay(d.day, { weekday: 'long', day: 'numeric', month: 'numeric' });
    html += `
      <section class="group day ${d.day === today ? 'is-today' : ''}" data-testid="day" data-day="${esc(d.day)}">
        <div class="day-head">
          <h2>${esc(label)}${d.day === today ? ` · ${esc(t('meals.today'))}` : ''}</h2>
          <button class="day-add" data-action="plan-add" data-day="${esc(d.day)}" aria-label="${esc(t('meals.planAdd', { day: label }))}">${icons.plus}</button>
        </div>
        ${
          d.entries.length
            ? `<ul class="list plain">${d.entries
                .map((e) => mealRow({ name: e.name, ingredients: e.ingredients }, { swipe: 'unplan', id: e.id, mealId: e.mealId }))
                .join('')}</ul>`
            : ''
        }
      </section>`;
  }
  return html;
}

/** `ingredientsOf(meal)` liefert die (noch vorhandenen) Zutaten-Produkte. */
export function dishesHtml(meals, ingredientsOf) {
  let html = mealViewHtml('dishes');
  if (!meals.length) {
    return html + `<div class="empty"><div class="empty-icon">${icons.meals}</div><strong>${esc(t('meals.emptyTitle'))}</strong>${esc(t('meals.emptyText'))}</div>`;
  }
  html += `<section class="group"><ul class="list plain">${meals
    .map((m) => mealRow({ ...m, ingredients: ingredientsOf(m) }, { swipe: 'delete-meal', id: m.id, mealId: m.id }))
    .join('')}</ul></section>`;
  return html;
}

export function transferBarHtml(show) {
  if (!show) return '';
  return `
    <div class="finish-bar">
      <button class="btn" data-action="transfer" data-testid="transfer">${esc(t('meals.toList'))}</button>
    </div>`;
}
