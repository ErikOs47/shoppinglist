// Wochenplan: Gerichte per Griff zwischen Tagen und innerhalb eines Tages verschieben.

import { test, expect } from '@playwright/test';

const run = Date.now();

async function signUp(page, email) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Neues Konto erstellen' }).click();
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort').fill('geheim123');
  await page.getByRole('button', { name: 'Registrieren' }).click();
  await expect(page.getByRole('heading', { name: 'Haushalt' })).toBeVisible();
}

const day = (page, i) => page.locator('[data-testid=day]').nth(i);
const planned = (page, i) =>
  day(page, i).locator('[data-testid=planned]').evaluateAll((els) => els.map((e) => e.dataset.name));

/**
 * Position einer Zeile. Trifft gerade die Bestätigung des Servers ein, wird die
 * Zeile neu gezeichnet und boundingBox() liefert kurz null; dann erneut messen.
 */
async function box(locator) {
  let b = null;
  await expect.poll(async () => (b = await locator.boundingBox())).not.toBeNull();
  return b;
}

/** Griff der Zeile greifen und senkrecht bis `toY` ziehen (wie mit dem Finger). */
async function dragTo(page, row, toY) {
  const h = await box(row.locator('[data-drag-meal]'));
  const x = h.x + h.width / 2;
  const y0 = h.y + h.height / 2;
  await page.mouse.move(x, y0);
  await page.mouse.down();
  const steps = 15;
  for (let i = 1; i <= steps; i++) await page.mouse.move(x, y0 + ((toY - y0) * i) / steps);
  await page.mouse.up();
}

test('Gerichte im Wochenplan zwischen Tagen verschieben', async ({ browser }) => {
  test.setTimeout(120_000);
  const [ctxA, ctxB] = await Promise.all([browser.newContext(), browser.newContext()]);
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const errors = [];
  for (const p of [a, b]) p.on('pageerror', (e) => errors.push(e.message));

  await signUp(a, `drag-a-${run}@example.com`);
  await a.getByLabel('Name').fill('Woche');
  await a.getByRole('button', { name: 'Haushalt anlegen' }).click();
  await expect(a.getByTestId('sync')).toHaveText('Live');
  await a.getByRole('button', { name: 'Einstellungen' }).click();
  const code = (await a.getByTestId('invite-code').textContent()).trim();
  await a.locator('#sheet').getByRole('button', { name: 'Fertig' }).click();
  await signUp(b, `drag-b-${run}@example.com`);
  await b.getByLabel('Code').fill(code);
  await b.getByRole('button', { name: 'Beitreten' }).click();
  await expect(b.getByTestId('sync')).toHaveText('Live');

  // Drei Gerichte: Mo Curry + Suppe, Mi Pasta
  await a.getByRole('tab', { name: 'Essen' }).click();
  for (const name of ['Curry', 'Suppe', 'Pasta']) {
    await a.getByRole('button', { name: 'Gericht hinzufügen' }).click();
    await a.locator('#sheet').getByLabel('Name').fill(name);
    await a.locator('#sheet').getByRole('button', { name: 'Hinzufügen', exact: true }).click();
    await expect(a.locator('#sheet')).not.toBeVisible();
  }
  for (const [i, name] of [[0, 'Curry'], [0, 'Suppe'], [2, 'Pasta']]) {
    await day(a, i).getByRole('button', { name: /planen/ }).click();
    await a.locator(`#sheet [data-testid=pick][data-name="${name}"]`).click();
  }
  await expect.poll(() => planned(a, 0)).toEqual(['Curry', 'Suppe']);
  await b.getByRole('tab', { name: 'Essen' }).click();
  await expect.poll(() => planned(b, 0)).toEqual(['Curry', 'Suppe']);

  // --- Suppe von Montag auf den leeren Dienstag -----------------------------
  const dienstagKopf = await box(day(a, 1).locator('.day-head'));
  await dragTo(a, day(a, 0).locator('[data-testid=planned][data-name=Suppe]'), dienstagKopf.y + dienstagKopf.height + 8);
  await expect.poll(() => planned(a, 0)).toEqual(['Curry']);
  await expect.poll(() => planned(a, 1)).toEqual(['Suppe']);
  await expect.poll(() => planned(b, 1)).toEqual(['Suppe']); // Echtzeit beim Partner

  // --- Pasta von Mittwoch vor das Curry am Montag ----------------------------
  const curry = await box(day(a, 0).locator('[data-testid=planned][data-name=Curry]'));
  await dragTo(a, day(a, 2).locator('[data-testid=planned][data-name=Pasta]'), curry.y + 6);
  await expect.poll(() => planned(a, 0)).toEqual(['Pasta', 'Curry']);
  await expect.poll(() => planned(a, 2)).toEqual([]);

  // --- innerhalb des Tages: Curry wieder nach oben ---------------------------
  const pasta = await box(day(a, 0).locator('[data-testid=planned][data-name=Pasta]'));
  await dragTo(a, day(a, 0).locator('[data-testid=planned][data-name=Curry]'), pasta.y + 6);
  await expect.poll(() => planned(a, 0)).toEqual(['Curry', 'Pasta']);
  await expect.poll(() => planned(b, 0)).toEqual(['Curry', 'Pasta']);

  // Kurzes Ziehen ohne Zielwechsel ändert nichts; Antippen des Gerichts öffnet es weiter
  const c = await box(day(a, 0).locator('[data-testid=planned][data-name=Curry]'));
  await dragTo(a, day(a, 0).locator('[data-testid=planned][data-name=Curry]'), c.y + c.height / 2 + 10);
  await expect.poll(() => planned(a, 0)).toEqual(['Curry', 'Pasta']);
  await day(a, 0).locator('[data-testid=planned][data-name=Curry] .row-main').click();
  await expect(a.locator('#sheet h2')).toHaveText('Gericht');
  await a.locator('#sheet [data-close]').click();

  // Nach Neuladen bleibt alles so
  await a.reload();
  await expect.poll(() => planned(a, 0)).toEqual(['Curry', 'Pasta']);
  await expect.poll(() => planned(a, 1)).toEqual(['Suppe']);

  expect(errors).toEqual([]);
  await Promise.all([ctxA.close(), ctxB.close()]);
});
