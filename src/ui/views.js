// HTML-Vorlagen. Alle Nutzerdaten laufen durch esc(), damit Produktnamen
// kein HTML einschleusen können.

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
  // Badge sitzt am Icon, damit „Einkaufszettel“ auch auf schmalen iPhones passt.
  const badge = listCount ? `<span class="badge" data-testid="badge">${listCount}</span>` : '';
  return `
    <nav class="tabbar" role="tablist">
      <button class="tab" role="tab" data-action="tab" data-tab="products" aria-selected="${tab === 'products'}">
        <span class="tab-icon">${icons.products}</span><span>Produkte</span>
      </button>
      <button class="tab" role="tab" data-action="tab" data-tab="list" aria-selected="${tab === 'list'}">
        <span class="tab-icon">${icons.list}${badge}</span><span>Einkaufszettel</span>
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
    return `<div class="empty"><div class="empty-icon">${icons.products}</div><strong>Noch keine Produkte</strong>Tippe oben auf + oder suche nach einem Produkt, um es anzulegen.</div>`;
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
    return `<div class="empty"><div class="empty-icon">${icons.bag}</div><strong>Der Zettel ist leer</strong>Wähle im Tab „Produkte“ aus, was du brauchst.</div>`;
  }
  const pct = Math.round((view.done.length / view.total) * 100);
  let html = `
    <div class="counter" aria-label="${view.openCount} offen, ${view.done.length} im Wagen">
      <span>${view.openCount} offen · ${view.done.length} im Wagen</span>
      <span class="progress"><span style="width:${pct}%"></span></span>
    </div>`;
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
