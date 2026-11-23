// Gesten: Wischen zum Löschen und Verschieben per Griff.
// Beide arbeiten mit Pointer-Events (Finger und Maus) und Event-Delegation,
// damit sie nach jedem Neuzeichnen der Liste ohne neues Anmelden funktionieren.

// ---------------------------------------------------------------------------
// Wischen zum Löschen
// ---------------------------------------------------------------------------

/** Ab dieser Strecke (px) gilt eine Bewegung als Wischen statt Tippen. */
const SWIPE_START = 12;
/** Anteil der Zeilenbreite, den der Finger zurücklegen muss, damit gelöscht wird. */
export const SWIPE_COMMIT = 0.6;

/**
 * Gedämpfte Verschiebung: Die Zeile folgt dem Finger nur zur Hälfte, nach der
 * Schwelle nur noch sehr wenig. So braucht Löschen eine bewusst lange Bewegung.
 */
export function swipeOffset(travel, commitDistance) {
  if (travel <= commitDistance) return travel * 0.5;
  return commitDistance * 0.5 + (travel - commitDistance) * 0.12;
}

/**
 * @param root Element, in dem Zeilen mit `.swipe` liegen
 * @param onCommit (li) => void, wird nach der Ausblend-Animation aufgerufen
 * @param onActive (aktiv: boolean) => void, z. B. um Neuzeichnen zu pausieren
 */
export function enableSwipe(root, { onCommit, onActive }) {
  let g = null; // laufende Geste

  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || g) return;
    const inner = e.target.closest('.swipe > .row-inner');
    // Auch auf dem Griff erlaubt: Waagerecht ist Wischen, senkrecht Verschieben.
    if (!inner) return;
    const li = inner.parentElement;
    g = { li, inner, x0: e.clientX, y0: e.clientY, id: e.pointerId, active: false, armed: false, width: li.offsetWidth };
  });

  root.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (!g.active) {
      if (Math.abs(dy) > SWIPE_START && Math.abs(dy) > Math.abs(dx)) {
        g = null; // senkrecht: Scrollen, nicht Wischen
        return;
      }
      if (-dx > SWIPE_START && Math.abs(dx) > Math.abs(dy) * 1.2) {
        g.active = true;
        g.inner.setPointerCapture?.(e.pointerId);
        g.li.classList.add('swiping');
        onActive?.(true);
      } else {
        return;
      }
    }
    e.preventDefault();
    const commit = g.width * SWIPE_COMMIT;
    const travel = Math.max(0, -dx);
    g.inner.style.transform = `translateX(${-swipeOffset(travel, commit)}px)`;
    g.li.style.setProperty('--swipe-p', Math.min(1, travel / commit).toFixed(3));
    const armed = travel >= commit;
    if (armed !== g.armed) {
      g.armed = armed;
      g.li.classList.toggle('armed', armed);
      navigator.vibrate?.(10); // spürbare Rückmeldung an der Schwelle, wo unterstützt
    }
  });

  const end = (e) => {
    if (!g || e.pointerId !== g.id) return;
    const { li, inner, active, armed } = g;
    g = null;
    if (!active) return;
    suppressNextClick();
    if (armed && e.type === 'pointerup') {
      li.classList.add('removing');
      inner.style.transform = 'translateX(-100%)';
      li.style.height = `${li.offsetHeight}px`;
      requestAnimationFrame(() => {
        li.style.height = '0px';
      });
      setTimeout(() => {
        // Erst löschen, dann Neuzeichnen freigeben, sonst blitzt die Zeile kurz wieder auf.
        onCommit(li);
        onActive?.(false);
      }, 260);
    } else {
      li.classList.remove('swiping', 'armed');
      inner.style.transform = '';
      li.style.removeProperty('--swipe-p');
      onActive?.(false);
    }
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
}

// Nach einer Geste würde der Browser noch ein „click“ auslösen (z. B. Abhaken).
let suppressUntil = 0;
function suppressNextClick() {
  suppressUntil = Date.now() + 400;
}
globalThis.document?.addEventListener(
  'click',
  (e) => {
    if (Date.now() < suppressUntil) {
      e.stopPropagation();
      e.preventDefault();
      suppressUntil = 0;
    }
  },
  true,
);

// ---------------------------------------------------------------------------
// Verschieben per Griff
// ---------------------------------------------------------------------------

/**
 * Zielindex beim Ziehen: Anzahl der anderen Zeilen, deren Mitte oberhalb der
 * Mitte der gezogenen Zeile liegt. `centers` sind die Mitten aller Zeilen in
 * Ausgangslage, `from` der Index der gezogenen Zeile.
 */
export function dropIndex(centers, from, draggedCenter) {
  let n = 0;
  centers.forEach((c, i) => {
    if (i !== from && c < draggedCenter) n++;
  });
  return n;
}

/**
 * @param root Element mit Listen `.sortable`, Zeilen haben einen Griff `[data-drag]`
 * @param onDrop (productId, toIndex) => void; toIndex bezieht sich auf die Liste ohne die gezogene Zeile
 * @param onActive (aktiv: boolean) => void
 */
export function enableDrag(root, { onDrop, onActive }) {
  let d = null;

  // Erst nach einigen Pixeln entscheiden: senkrecht = verschieben,
  // waagerecht = der Wisch-Geste überlassen (der Griff sitzt genau dort, wo
  // man zum Wischen den Finger ansetzt).
  const DECIDE = 6;
  let pending = null;

  root.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('[data-drag]');
    if (!handle || d || pending || e.button !== 0) return;
    const li = handle.closest('li');
    const list = li.parentElement;
    if (!list.classList.contains('sortable')) return;
    e.preventDefault();
    pending = { handle, li, list, id: e.pointerId, x0: e.clientX, y0: e.clientY };
  });

  function start(p, e) {
    const { handle, li, list } = p;
    const rows = [...list.children];
    const scroll0 = window.scrollY;
    const rects = rows.map((r) => r.getBoundingClientRect());
    d = {
      li,
      rows,
      from: rows.indexOf(li),
      to: rows.indexOf(li),
      id: p.id,
      y0: p.y0,
      lastY: e.clientY,
      scroll0,
      height: rects[rows.indexOf(li)].height,
      centers: rects.map((r) => r.top + scroll0 + r.height / 2),
      raf: 0,
    };
    handle.setPointerCapture?.(p.id);
    li.classList.add('dragging');
    list.classList.add('is-sorting');
    onActive?.(true);
    autoScroll();
    update();
  }

  function update() {
    const dy = d.lastY - d.y0 + (window.scrollY - d.scroll0);
    d.li.style.transform = `translateY(${dy}px) scale(1.02)`;
    const to = dropIndex(d.centers, d.from, d.centers[d.from] + dy);
    if (to !== d.to) {
      d.to = to;
      d.rows.forEach((r, i) => {
        if (r === d.li) return;
        let shift = 0;
        if (i > d.from && i <= to) shift = -d.height;
        if (i < d.from && i >= to) shift = d.height;
        r.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    }
  }

  // Am oberen/unteren Rand mitscrollen, damit auch lange Listen sortierbar sind.
  function autoScroll() {
    if (!d) return;
    const edge = 90;
    const bottomEdge = window.innerHeight - 170; // Tab-Leiste und Abschluss-Knopf
    let v = 0;
    if (d.lastY < edge) v = -Math.ceil((edge - d.lastY) / 6);
    else if (d.lastY > bottomEdge) v = Math.ceil((d.lastY - bottomEdge) / 6);
    if (v) {
      window.scrollBy(0, v);
      update();
    }
    d.raf = requestAnimationFrame(autoScroll);
  }

  root.addEventListener('pointermove', (e) => {
    if (pending && e.pointerId === pending.id) {
      const dx = Math.abs(e.clientX - pending.x0);
      const dy = Math.abs(e.clientY - pending.y0);
      if (dy > DECIDE && dy >= dx) {
        const p = pending;
        pending = null;
        start(p, e);
      } else if (dx > DECIDE && dx > dy) {
        pending = null; // Wischen
      }
      return;
    }
    if (!d || e.pointerId !== d.id) return;
    e.preventDefault();
    d.lastY = e.clientY;
    update();
  });

  const end = (e) => {
    if (pending && e.pointerId === pending.id) pending = null; // nur angetippt
    if (!d || e.pointerId !== d.id) return;
    const { li, rows, from, to, raf } = d;
    d = null;
    cancelAnimationFrame(raf);
    suppressNextClick();
    for (const r of rows) r.style.transform = '';
    li.classList.remove('dragging');
    li.parentElement?.classList.remove('is-sorting');
    onActive?.(false);
    if (e.type === 'pointerup' && to !== from) onDrop(li.dataset.productId, to);
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
}

// ---------------------------------------------------------------------------
// Gerichte im Wochenplan zwischen Tagen verschieben
// ---------------------------------------------------------------------------

/**
 * Ziel beim Verschieben im Wochenplan. `layout`: Tage von oben nach unten,
 * je { day, top, rows: [{ id, top, bottom }] } in Seitenkoordinaten.
 * Ein Punkt im Abstand über einem Tag gehört noch zum Tag darüber.
 * `index` zählt ohne die gezogene Zeile.
 */
export function dayDropTarget(layout, y, draggedId) {
  let sec = layout[0];
  for (const s of layout) if (s.top <= y) sec = s;
  const rows = sec.rows.filter((r) => r.id !== draggedId);
  const index = rows.filter((r) => (r.top + r.bottom) / 2 < y).length;
  return { day: sec.day, index };
}

/**
 * @param root Element mit Tagen `[data-day]` und Zeilen `[data-testid=planned]`
 *   (Griff `[data-drag-meal]`, Eintrags-id in `data-id`)
 * @param onDrop (entryId, day, index) => void; index ohne die gezogene Zeile
 * @param onActive (aktiv: boolean) => void
 */
export function enableDayDrag(root, { onDrop, onActive }) {
  const DECIDE = 6;
  let pending = null;
  let d = null;

  root.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('[data-drag-meal]');
    if (!handle || d || pending || e.button !== 0) return;
    e.preventDefault();
    pending = { handle, li: handle.closest('li'), id: e.pointerId, x0: e.clientX, y0: e.clientY };
  });

  function measure() {
    const sy = window.scrollY;
    return [...root.querySelectorAll('[data-testid=day]')].map((sec) => {
      const head = sec.querySelector('.day-head');
      const hb = head.getBoundingClientRect();
      return {
        el: sec,
        day: sec.dataset.day,
        top: sec.getBoundingClientRect().top + sy,
        head: { el: head, top: hb.top + sy },
        headBottom: hb.bottom + sy,
        rows: [...sec.querySelectorAll('[data-testid=planned]')].map((r) => {
          const b = r.getBoundingClientRect();
          return { el: r, id: r.dataset.id, top: b.top + sy, bottom: b.bottom + sy };
        }),
      };
    });
  }

  function start(p, e) {
    // In den ersten Pixeln kann ein Realtime-Ereignis die Zeile neu gezeichnet
    // haben; dann lieber nicht verschieben als eine veraltete Zeile bewegen.
    if (!p.li?.isConnected) return;
    const layout = measure();
    const entryId = p.li.dataset.id;
    const fromSec = layout.find((s) => s.rows.some((r) => r.id === entryId));
    const self = fromSec?.rows.find((r) => r.id === entryId);
    if (!self) return;
    // Alles, was beim Verschieben auf- oder zurückrückt: Tagesköpfe und übrige Zeilen
    const movers = layout.flatMap((s) => [s.head, ...s.rows.filter((r) => r.id !== entryId)]);
    d = {
      ...p,
      entryId,
      layout,
      movers,
      origTop: self.top,
      height: self.bottom - self.top,
      fromDay: fromSec.day,
      fromIndex: fromSec.rows.indexOf(self),
      target: null,
      scroll0: window.scrollY,
      lastY: e.clientY,
      raf: 0,
    };
    p.handle.setPointerCapture?.(p.id);
    p.li.classList.add('dragging');
    root.classList.add('is-moving');
    onActive?.(true);
    autoScroll();
    update();
  }

  /** Einfügestelle (Seitenkoordinate) für ein Ziel: über der Zielzeile, sonst darunter. */
  function insertY(target) {
    const sec = d.layout.find((s) => s.day === target.day);
    const rows = sec.rows.filter((r) => r.id !== d.entryId);
    if (target.index < rows.length) return rows[target.index].top;
    if (rows.length) return rows[rows.length - 1].bottom;
    return sec.headBottom;
  }

  function update() {
    const sy = window.scrollY;
    const dy = d.lastY - d.y0 + (sy - d.scroll0);
    d.li.style.transform = `translateY(${dy}px) scale(1.02)`;
    const target = dayDropTarget(d.layout, d.lastY + sy, d.entryId);
    const changed = !d.target || target.day !== d.target.day || target.index !== d.target.index;
    d.target = target;
    if (!changed) return;
    for (const s of d.layout) s.el.classList.toggle('drop-target', s.day === target.day);
    // Wie Herausnehmen und Einsetzen: Was unter der alten Stelle liegt, rückt
    // hoch; was unter der neuen Stelle liegt, rückt runter. So öffnet sich die
    // Lücke genau dort, wo das Gericht landet.
    const at = insertY(target);
    for (const m of d.movers) {
      const shift = (m.top > d.origTop ? -d.height : 0) + (m.top >= at ? d.height : 0);
      m.el.style.transform = shift ? `translateY(${shift}px)` : '';
    }
  }

  function autoScroll() {
    if (!d) return;
    const edge = 120;
    const bottomEdge = window.innerHeight - 170;
    let v = 0;
    if (d.lastY < edge) v = -Math.ceil((edge - d.lastY) / 6);
    else if (d.lastY > bottomEdge) v = Math.ceil((d.lastY - bottomEdge) / 6);
    if (v) {
      window.scrollBy(0, v);
      update();
    }
    d.raf = requestAnimationFrame(autoScroll);
  }

  root.addEventListener('pointermove', (e) => {
    if (pending && e.pointerId === pending.id) {
      const dx = Math.abs(e.clientX - pending.x0);
      const dy = Math.abs(e.clientY - pending.y0);
      if (dy > DECIDE && dy >= dx) {
        const p = pending;
        pending = null;
        start(p, e);
      } else if (dx > DECIDE && dx > dy) {
        pending = null; // waagerecht: Wischen zum Entfernen
      }
      return;
    }
    if (!d || e.pointerId !== d.id) return;
    e.preventDefault();
    d.lastY = e.clientY;
    update();
  });

  const end = (e) => {
    if (pending && e.pointerId === pending.id) pending = null;
    if (!d || e.pointerId !== d.id) return;
    const { li, entryId, target, fromDay, fromIndex, raf, layout, movers } = d;
    d = null;
    cancelAnimationFrame(raf);
    suppressNextClick();
    for (const m of movers) m.el.style.transform = '';
    for (const s of layout) s.el.classList.remove('drop-target');
    li.style.transform = '';
    li.classList.remove('dragging');
    root.classList.remove('is-moving');
    onActive?.(false);
    const moved = target && (target.day !== fromDay || target.index !== fromIndex);
    if (e.type === 'pointerup' && moved) onDrop(entryId, target.day, target.index);
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
}
