// HTML-Vorlagen. Alle Nutzerdaten laufen durch esc(), damit Produktnamen
// kein HTML einschleusen können.

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const icons = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v6" stroke-linecap="round"/><circle cx="12" cy="7.6" r="1.1" fill="currentColor" stroke="none"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20"/></svg>',
  clear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="var(--card)" stroke-width="2" stroke-linecap="round"/></svg>',
  person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="10" r="3.2"/><path d="M6.2 18.4c1.3-2.2 3.4-3.4 5.8-3.4s4.5 1.2 5.8 3.4"/></svg>',
  products: '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="4" y="4" width="8.5" height="8.5" rx="2"/><rect x="15.5" y="4" width="8.5" height="8.5" rx="2"/><rect x="4" y="15.5" width="8.5" height="8.5" rx="2"/><rect x="15.5" y="15.5" width="8.5" height="8.5" rx="2"/></svg>',
  productsOn: '<svg viewBox="0 0 28 28" fill="currentColor"><rect x="4" y="4" width="8.5" height="8.5" rx="2"/><rect x="15.5" y="4" width="8.5" height="8.5" rx="2"/><rect x="4" y="15.5" width="8.5" height="8.5" rx="2"/><rect x="15.5" y="15.5" width="8.5" height="8.5" rx="2"/></svg>',
  list: '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3.5" width="18" height="21" rx="3"/><path d="M9.5 10h9M9.5 14.5h9M9.5 19h5"/></svg>',
  listOn: '<svg viewBox="0 0 28 28"><rect x="5" y="3.5" width="18" height="21" rx="3" fill="currentColor"/><path d="M9.5 10h9M9.5 14.5h9M9.5 19h5" stroke="var(--bar-solid, #fff)" stroke-width="1.8" stroke-linecap="round"/></svg>',
};

export function syncLabel({ status, pending, live, online }) {
  if (!online || status === 'offline') {
    const p = pending ? ` · ${pending} ${pending === 1 ? 'Änderung wartet' : 'Änderungen warten'}` : '';
    return { cls: 'offline', text: `Offline${p}` };
  }
  if (status === 'syncing' || pending) return { cls: 'syncing', text: 'Synchronisiere …' };
  if (!live) return { cls: 'syncing', text: 'Verbinde …' };
  return { cls: 'live', text: 'Live' };
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
  const badge = listCount ? `<span class="badge" data-testid="badge">${listCount}</span>` : '';
  return `
    <nav class="tabbar" role="tablist">
      <button class="tab" role="tab" data-action="tab" data-tab="products" aria-selected="${tab === 'products'}">
        ${tab === 'products' ? icons.productsOn : icons.products}<span>Produkte</span>
      </button>
      <button class="tab" role="tab" data-action="tab" data-tab="list" aria-selected="${tab === 'list'}">
        ${tab === 'list' ? icons.listOn : icons.list}${badge}<span>Einkaufszettel</span>
      </button>
    </nav>`;
}

export function productsHtml(groups, query, exactMatch) {
  const q = query.trim();
  let html = '';
  if (q && !exactMatch) {
    html += `
      <div class="group">
        <ul class="list">
          <li class="row add-row">
            <button class="row-main" data-action="quick-add">
              <span class="plus">${icons.plus}</span>
              <span class="row-name">„${esc(q)}“ als Produkt anlegen</span>
            </button>
          </li>
        </ul>
      </div>`;
  }
  if (groups.length === 0 && !q) {
    return `<div class="empty"><strong>Noch keine Produkte</strong>Tippe oben auf + oder suche nach einem Produkt, um es anzulegen.</div>`;
  }
  if (groups.length === 0) {
    return html + `<div class="empty">Kein Produkt gefunden.</div>`;
  }
  for (const g of groups) {
    html += `
      <section class="group">
        <h2>${esc(g.category)}</h2>
        <ul class="list">
          ${g.products
            .map(
              (p) => `
            <li class="row ${p.onList ? 'on' : ''}" data-testid="product" data-name="${esc(p.name)}">
              <button class="row-main" data-action="toggle-list" data-id="${esc(p.id)}"
                aria-pressed="${p.onList}" aria-label="${esc(p.name)}${p.onList ? ', auf dem Zettel' : ''}">
                <span class="check">${icons.check}</span>
                <span class="row-name">${esc(p.name)}</span>
              </button>
              <button class="info-btn" data-action="edit-product" data-id="${esc(p.id)}" aria-label="${esc(p.name)} bearbeiten">${icons.info}</button>
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
    ? `<button class="remove-btn" data-action="remove-item" data-id="${esc(it.productId)}" aria-label="${esc(it.name)} vom Zettel entfernen"><span></span></button>`
    : '';
  return `
    <li class="row ${done ? 'done' : ''}" data-testid="item" data-name="${esc(it.name)}" data-checked="${done}">
      ${remove}
      <button class="row-main" data-action="toggle-check" data-id="${esc(it.productId)}"
        role="checkbox" aria-checked="${done}" aria-label="${esc(it.name)}">
        <span class="check">${icons.check}</span>
        <span class="row-name">${esc(it.name)}</span>
      </button>
    </li>`;
}

export function shoppingHtml(view, editing) {
  if (view.total === 0) {
    return `<div class="empty"><strong>Der Zettel ist leer</strong>Wähle im Tab „Produkte“ aus, was du brauchst.</div>`;
  }
  let html = `<p class="counter">${view.openCount} offen · ${view.done.length} im Wagen</p>`;
  for (const g of view.groups) {
    html += `
      <section class="group">
        <h2>${esc(g.category)}</h2>
        <ul class="list">${g.items.map((it) => itemRow(it, editing, false)).join('')}</ul>
      </section>`;
  }
  if (view.done.length) {
    html += `
      <section class="group">
        <h2>Im Einkaufswagen</h2>
        <ul class="list">${view.done.map((it) => itemRow(it, editing, true)).join('')}</ul>
      </section>`;
  }
  return html;
}

export function finishBarHtml(doneCount) {
  if (!doneCount) return '';
  return `
    <div class="finish-bar">
      <button class="btn" data-action="finish" data-testid="finish">Einkauf abschließen (${doneCount})</button>
    </div>`;
}

export function categoryOptions(categories, selected) {
  const opts = categories
    .map((c) => `<option value="${esc(c)}" ${c === selected ? 'selected' : ''}>${esc(c)}</option>`)
    .join('');
  return `${opts}<option value="__new__">Neue Kategorie …</option>`;
}
