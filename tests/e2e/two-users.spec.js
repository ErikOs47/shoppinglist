// Zwei Personen, zwei getrennte Browser-Kontexte (eigene Cookies/Storage),
// ein gemeinsamer Haushalt. Prüft Echtzeit-Abgleich ohne Neuladen,
// gleichzeitige Änderungen, Offline-Betrieb und Datenschutz zwischen Haushalten.

import { test, expect } from '@playwright/test';

const run = Date.now();
const PW = 'geheim123';

async function signUp(page, email) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Neues Konto erstellen' }).click();
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Registrieren' }).click();
  await expect(page.getByRole('heading', { name: 'Haushalt' })).toBeVisible();
}

async function gotoTab(page, name) {
  await page.getByRole('tab', { name }).click();
}

async function addProduct(page, name, { category, toList = true } = {}) {
  await gotoTab(page, 'Produkte');
  await page.getByRole('button', { name: 'Produkt hinzufügen' }).click();
  const sheet = page.locator('#sheet');
  await sheet.getByLabel('Name').fill(name);
  if (category) await sheet.getByLabel('Kategorie').selectOption(category);
  const cb = sheet.locator('input[name=addToList]');
  if (!toList) await cb.uncheck();
  await sheet.getByRole('button', { name: 'Hinzufügen' }).click();
}

const item = (page, name) => page.locator(`[data-testid=item][data-name="${name}"]`);
const product = (page, name) => page.locator(`[data-testid=product][data-name="${name}"]`);

async function waitLive(page) {
  await expect(page.getByTestId('sync')).toHaveText('Live');
}

test('zwei Personen teilen Produkte und Einkaufszettel in Echtzeit', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const errors = [];
  const conflicts = []; // Antworttexte aller 409-Antworten
  for (const p of [a, b]) {
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    p.on('response', async (r) => {
      if (r.status() === 409) conflicts.push(await r.text().catch(() => ''));
    });
  }

  // --- Konten und Haushalt ------------------------------------------------
  await signUp(a, `anna-${run}@example.com`);
  await a.getByLabel('Name').fill('Zuhause');
  await a.getByRole('button', { name: 'Haushalt anlegen' }).click();
  await expect(a.getByRole('heading', { name: 'Einkaufszettel' })).toBeVisible();
  await waitLive(a);

  await a.getByRole('button', { name: 'Einstellungen' }).click();
  const code = (await a.getByTestId('invite-code').textContent()).trim();
  expect(code).toMatch(/^[A-Z2-9]{12}$/);
  await a.locator('#sheet').getByRole('button', { name: 'Fertig' }).click();

  await signUp(b, `ben-${run}@example.com`);
  await b.getByLabel('Code').fill(code.toLowerCase());
  await b.getByRole('button', { name: 'Beitreten' }).click();
  await expect(b.getByRole('heading', { name: 'Einkaufszettel' })).toBeVisible();
  await waitLive(b);

  // --- A legt an, B sieht es sofort (ohne Neuladen) ----------------------
  await addProduct(a, 'Milch', { category: 'Milchprodukte & Eier' });
  await expect(item(b, 'Milch')).toBeVisible();
  await expect(b.getByTestId('badge')).toHaveText('1');

  // --- B legt über die Suche an, A sieht es in der Produktliste ----------
  await gotoTab(b, 'Produkte');
  await b.getByLabel('Produkte durchsuchen').fill('Brot');
  await b.getByRole('button', { name: /„Brot“ als Produkt anlegen/ }).click();
  await b.locator('#sheet').getByLabel('Kategorie').selectOption('Brot & Backwaren');
  await b.locator('#sheet').getByRole('button', { name: 'Hinzufügen' }).click();
  await gotoTab(a, 'Produkte');
  await expect(product(a, 'Brot')).toBeVisible();
  await expect(product(a, 'Brot')).toHaveClass(/\bon\b/); // steht auf dem Zettel

  // --- Duplikat wird abgelehnt ------------------------------------------
  await a.getByRole('button', { name: 'Produkt hinzufügen' }).click();
  await a.locator('#sheet').getByLabel('Name').fill('  MILCH ');
  await a.locator('#sheet').getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(a.locator('#p-error')).toHaveText('„Milch“ gibt es schon.');
  await a.locator('#sheet').getByRole('button', { name: 'Abbrechen' }).click();

  // --- Produkt ohne Zettel anlegen, dann per Tippen auf den Zettel ------
  await addProduct(a, 'Äpfel', { category: 'Obst & Gemüse', toList: false });
  await expect(product(b, 'Äpfel')).toBeVisible();
  await expect(product(b, 'Äpfel')).not.toHaveClass(/\bon\b/);
  await product(b, 'Äpfel').getByRole('button', { name: 'Äpfel', exact: true }).click();
  await gotoTab(a, 'Einkaufszettel');
  await expect(item(a, 'Äpfel')).toBeVisible();

  // --- Abhaken: A hakt ab, B sieht es durchgestrichen --------------------
  await gotoTab(b, 'Einkaufszettel');
  await item(a, 'Milch').getByRole('checkbox').click();
  await expect(item(b, 'Milch')).toHaveAttribute('data-checked', 'true');
  await expect(item(b, 'Milch').locator('.row-name')).toHaveCSS('text-decoration-line', 'line-through');

  // --- Gleichzeitig: beide haken verschiedene Artikel im selben Moment ab --
  await Promise.all([
    item(a, 'Brot').getByRole('checkbox').click(),
    item(b, 'Äpfel').getByRole('checkbox').click(),
  ]);
  for (const p of [a, b]) {
    await expect(item(p, 'Brot')).toHaveAttribute('data-checked', 'true');
    await expect(item(p, 'Äpfel')).toHaveAttribute('data-checked', 'true');
  }

  // --- B nimmt den Haken bei Äpfel wieder raus, A schließt sofort ab ----
  await item(b, 'Äpfel').getByRole('checkbox').click();
  await expect(item(a, 'Äpfel')).toHaveAttribute('data-checked', 'false');
  await a.getByTestId('finish').click();
  await expect(a.getByTestId('finish-message')).toContainText('2 abgehakte Artikel werden vom Zettel entfernt. 1 nicht gekaufter bleibt stehen.');
  await a.locator('#sheet').getByRole('button', { name: 'Abschließen' }).click();

  for (const p of [a, b]) {
    await expect(item(p, 'Milch')).toHaveCount(0);
    await expect(item(p, 'Brot')).toHaveCount(0);
    await expect(item(p, 'Äpfel')).toBeVisible(); // nicht gekauft → bleibt
  }
  // Produktdatenbank unverändert
  await gotoTab(b, 'Produkte');
  for (const n of ['Milch', 'Brot', 'Äpfel']) await expect(product(b, n)).toBeVisible();

  // --- Beide legen ohne Netz dasselbe Produkt an (echter Konflikt) -------
  // Online würde schon das Formular das Duplikat ablehnen, sobald das
  // Realtime-Ereignis der anderen Person da ist. Offline kann das nicht
  // greifen; dann muss der Server ablehnen und der Client zusammenführen.
  await Promise.all([ctxA.setOffline(true), ctxB.setOffline(true)]);
  await Promise.all([addProduct(a, 'Butter'), addProduct(b, 'Butter')]);
  for (const p of [a, b]) await expect(product(p, 'Butter')).toHaveCount(1);
  await Promise.all([ctxA.setOffline(false), ctxB.setOffline(false)]);
  for (const p of [a, b]) {
    await expect(product(p, 'Butter')).toHaveCount(1);
    await expect(product(p, 'Butter')).toHaveClass(/\bon\b/);
    await expect(p.getByTestId('sync')).toHaveText('Live');
  }

  // --- Offline: B ändert offline, A sieht es nach dem Wiederverbinden ----
  await ctxB.setOffline(true);
  await expect(b.getByTestId('sync')).toContainText('Offline');
  await addProduct(b, 'Eier', { category: 'Milchprodukte & Eier' });
  await gotoTab(b, 'Einkaufszettel');
  await item(b, 'Äpfel').getByRole('checkbox').click();
  await expect(b.getByTestId('sync')).toContainText('3 Änderungen warten');

  // App offline neu starten: Daten und Warteschlange müssen erhalten bleiben
  await b.reload();
  await expect(item(b, 'Eier')).toBeVisible();
  await expect(item(b, 'Äpfel')).toHaveAttribute('data-checked', 'true');
  await expect(b.getByTestId('sync')).toContainText('3 Änderungen warten');

  await gotoTab(a, 'Einkaufszettel');
  await expect(item(a, 'Eier')).toHaveCount(0);

  await ctxB.setOffline(false);
  await expect(item(a, 'Eier')).toBeVisible({ timeout: 20_000 });
  await expect(item(a, 'Äpfel')).toHaveAttribute('data-checked', 'true');
  await expect(b.getByTestId('sync')).toHaveText('Live', { timeout: 20_000 });

  // --- Produkt bearbeiten und löschen -----------------------------------
  await gotoTab(a, 'Produkte');
  await product(a, 'Eier').getByRole('button', { name: 'Eier bearbeiten' }).click();
  await a.locator('#sheet').getByLabel('Name').fill('Bio-Eier');
  await a.locator('#sheet').getByRole('button', { name: 'Sichern' }).click();
  await expect(item(b, 'Bio-Eier')).toBeVisible();

  await product(a, 'Bio-Eier').getByRole('button', { name: 'Bio-Eier bearbeiten' }).click();
  await a.locator('#sheet').getByRole('button', { name: 'Produkt löschen' }).click();
  await a.locator('#confirm').getByRole('button', { name: 'Löschen' }).click();
  await expect(item(b, 'Bio-Eier')).toHaveCount(0);
  await gotoTab(b, 'Produkte');
  await expect(product(b, 'Bio-Eier')).toHaveCount(0);

  // --- Bearbeiten-Modus: einzelnen Artikel vom Zettel nehmen ------------
  await gotoTab(b, 'Einkaufszettel');
  await b.getByRole('button', { name: 'Bearbeiten' }).click();
  await b.getByRole('button', { name: 'Butter vom Zettel entfernen' }).click();
  await gotoTab(a, 'Einkaufszettel');
  await expect(item(a, 'Butter')).toHaveCount(0);

  // --- Nach Neuladen ist alles noch da (Persistenz in der DB) -----------
  await a.reload();
  await expect(item(a, 'Äpfel')).toBeVisible();
  await gotoTab(a, 'Produkte');
  for (const n of ['Milch', 'Brot', 'Äpfel', 'Butter']) await expect(product(a, n)).toBeVisible();

  // --- Ein dritter Haushalt sieht nichts davon --------------------------
  const ctxC = await browser.newContext();
  const c = await ctxC.newPage();
  await signUp(c, `carl-${run}@example.com`);
  await c.getByLabel('Code').fill(code);
  await c.getByRole('button', { name: 'Beitreten' }).click();
  await expect(c.locator('#setup-error')).toHaveText('Haushalt hat bereits zwei Mitglieder');
  await c.getByLabel('Name').fill('Andere WG');
  await c.getByRole('button', { name: 'Haushalt anlegen' }).click();
  await gotoTab(c, 'Produkte');
  await expect(c.getByText('Noch keine Produkte')).toBeVisible();

  // Fremde Änderung kommt nicht bei C an
  await addProduct(a, 'Geheimprodukt');
  await c.waitForTimeout(1500);
  await expect(product(c, 'Geheimprodukt')).toHaveCount(0);

  // 409 ist nur in zwei Fällen erlaubt:
  // - products_household_name_uq: das absichtlich doppelt angelegte „Butter“ (wird zusammengeführt)
  // - *_pkey: Anfrage kam beim Server an, Antwort ging durch das Abschalten des Netzes
  //   verloren; die Wiederholung mit derselben id wird als erledigt gewertet.
  expect(conflicts.some((c) => c.includes('products_household_name_uq'))).toBe(true);
  for (const c of conflicts) expect(c).toMatch(/products_household_name_uq|_pkey/);
  const unexpected = errors.filter(
    (e) => !/ERR_INTERNET_DISCONNECTED|Failed to fetch|WebSocket|net::ERR|status of 409/i.test(e),
  );
  expect(unexpected).toEqual([]);

  await Promise.all([ctxA.close(), ctxB.close(), ctxC.close()]);
});
