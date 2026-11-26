// Preise im Produkt, Schätzung auf dem Zettel, Preise beim Abschließen und
// Bon-Scan. Die Edge Function wird hier nachgebildet (route), weil der echte
// Scan einen kostenpflichtigen API-Schlüssel braucht.

import { test, expect } from '@playwright/test';

const run = Date.now();
// 1×1-PNG, damit das Verkleinern im Browser ein echtes Bild bekommt
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const money = (v) => new RegExp(`${v.replace(',', ',')}\\s€`);

async function signUp(page, email) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Neues Konto erstellen' }).click();
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort').fill('geheim123');
  await page.getByRole('button', { name: 'Registrieren' }).click();
  await expect(page.getByRole('heading', { name: 'Haushalt' })).toBeVisible();
}

async function addProduct(page, name, price) {
  await page.getByRole('tab', { name: 'Produkte' }).click();
  await page.getByRole('button', { name: 'Produkt hinzufügen' }).click();
  const sheet = page.locator('#sheet');
  await sheet.getByLabel('Name').fill(name);
  if (price) await sheet.getByLabel('Preis').fill(price);
  await sheet.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(sheet).not.toBeVisible();
}

const product = (page, name) => page.locator(`[data-testid=product][data-name="${name}"]`);

/** Nachbildung der Edge Function; merkt sich die Anfragen. */
async function fakeScan(page, respond) {
  const calls = [];
  await page.route('**/functions/v1/receipt-scan', async (route) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    calls.push(route.request().postDataJSON());
    const { status = 200, body } = respond(calls.length);
    return route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return calls;
}

test('Preise, Schätzung, Abschließen mit Preisen und Bon-Scan', async ({ browser }) => {
  test.setTimeout(120_000);
  const [ctxA, ctxB] = await Promise.all([browser.newContext(), browser.newContext()]);
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const errors = [];
  for (const p of [a, b]) p.on('pageerror', (e) => errors.push(e.message));

  await signUp(a, `price-a-${run}@example.com`);
  await a.getByLabel('Name').fill('Preise');
  await a.getByRole('button', { name: 'Haushalt anlegen' }).click();
  await expect(a.getByTestId('sync')).toHaveText('Live');
  await a.getByRole('button', { name: 'Einstellungen' }).click();
  const code = (await a.getByTestId('invite-code').textContent()).trim();
  await a.locator('#sheet').getByRole('button', { name: 'Fertig' }).click();
  await signUp(b, `price-b-${run}@example.com`);
  await b.getByLabel('Code').fill(code);
  await b.getByRole('button', { name: 'Beitreten' }).click();
  await expect(b.getByTestId('sync')).toHaveText('Live');

  // --- Preis im Produkt-Editor ---------------------------------------------------
  await addProduct(a, 'Joghurt', '0,59');
  await addProduct(a, 'Milch');
  await a.getByRole('button', { name: 'Produkt hinzufügen' }).click();
  await a.locator('#sheet').getByLabel('Name').fill('Brot');
  await a.locator('#sheet').getByLabel('Preis').fill('abc');
  await a.locator('#sheet').getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(a.locator('#p-error')).toHaveText('Bitte einen gültigen Preis eingeben, z. B. 1,29.');
  await a.locator('#sheet').getByLabel('Preis').fill('2.50');
  await a.locator('#sheet').getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(product(a, 'Joghurt').getByTestId('price')).toHaveText(money('0,59'));
  await expect(product(a, 'Milch').getByTestId('price')).toHaveCount(0);
  await b.getByRole('tab', { name: 'Produkte' }).click();
  await expect(product(b, 'Brot').getByTestId('price')).toHaveText(money('2,50'));

  // Preis ändern und löschen
  await product(a, 'Brot').locator('[data-action=edit-product]').click();
  await expect(a.locator('#sheet').getByLabel('Preis')).toHaveValue('2,50');
  await a.locator('#sheet').getByLabel('Preis').fill('');
  await a.locator('#sheet').getByRole('button', { name: 'Sichern' }).click();
  await expect(product(b, 'Brot').getByTestId('price')).toHaveCount(0);
  await product(a, 'Brot').locator('[data-action=edit-product]').click();
  await a.locator('#sheet').getByLabel('Preis').fill('2,50');
  await a.locator('#sheet').getByRole('button', { name: 'Sichern' }).click();

  // --- Schätzung auf dem Zettel (alle drei sind beim Anlegen draufgekommen) --------
  await a.getByRole('tab', { name: 'Einkaufszettel' }).click();
  await expect(a.getByTestId('estimate')).toHaveText(/ca\. 3,09\s€ · 1 ohne Preis/);
  await b.getByRole('tab', { name: 'Einkaufszettel' }).click();
  await expect(b.getByTestId('estimate')).toHaveText(/ca\. 3,09\s€ · 1 ohne Preis/);

  // --- Abschließen: Preise der gekauften Produkte ---------------------------------
  await a.locator('[data-testid=item][data-name=Joghurt] .row-main').click();
  await a.locator('[data-testid=item][data-name=Milch] .row-main').click();
  await a.getByTestId('finish').click();
  const sheet = a.locator('#sheet');
  await expect(sheet.getByLabel('Preis für Joghurt')).toHaveValue('0,59');
  await expect(sheet.getByLabel('Preis für Milch')).toHaveValue('');
  await expect(sheet.getByLabel('Preis für Brot')).toHaveCount(0); // nicht im Wagen
  await sheet.getByLabel('Preis für Milch').fill('x');
  await sheet.getByRole('button', { name: 'Abschließen' }).click();
  await expect(sheet.locator('#f-error')).toHaveText('Preis für „Milch“ ungültig, z. B. 1,29.');
  await sheet.getByLabel('Preis für Milch').fill('1,09');
  await sheet.getByLabel('Preis für Joghurt').fill('0,65');
  await sheet.getByRole('button', { name: 'Abschließen' }).click();
  await expect(a.locator('#toast')).toHaveText('Einkauf abgeschlossen');
  await b.getByRole('tab', { name: 'Produkte' }).click();
  await expect(product(b, 'Milch').getByTestId('price')).toHaveText(money('1,09'));
  await expect(product(b, 'Joghurt').getByTestId('price')).toHaveText(money('0,65'));

  // --- Bon-Scan aus „Ausgaben“ ----------------------------------------------------
  await a.getByRole('tab', { name: 'Produkte' }).click();
  const ids = {};
  for (const n of ['Joghurt', 'Milch', 'Brot']) ids[n] = await product(a, n).getAttribute('data-product-id');
  // Datum vom Bon: gestern (montags heute, damit die Ausgabe in der angezeigten Woche liegt)
  const yesterday = await a.evaluate(() => {
    const d = new Date(new Date().getDay() === 1 ? Date.now() : Date.now() - 86_400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const calls = await fakeScan(a, (n) => {
    if (n === 1) return { status: 429, body: { error: 'limit' } };
    if (n === 2) {
      return {
        body: {
          total_cents: 756,
          date: yesterday,
          lines: [
            { text: 'ZOTT MONTE', quantity: 2, unit_price_cents: 69, product_id: ids.Joghurt, sure: false },
            { text: 'H-MILCH 1,5%', quantity: 1, unit_price_cents: 119, product_id: ids.Milch, sure: true },
            { text: 'KAFFEE GEMAHLEN', quantity: 1, unit_price_cents: 499, product_id: null, sure: false },
            { text: 'ERFUNDEN', quantity: 1, unit_price_cents: 100, product_id: 'nicht-vorhanden', sure: true },
          ],
        },
      };
    }
    // dritter Scan: gelernter Bon-Name, KI kennt das Produkt nicht
    return { body: { total_cents: 70, date: null, lines: [{ text: 'zott  monte', quantity: 1, unit_price_cents: 70, product_id: null, sure: false }] } };
  });

  await a.getByRole('tab', { name: 'Ausgaben' }).click();
  await a.getByRole('button', { name: 'Bon scannen' }).click();
  await expect(sheet.getByRole('heading', { name: 'Bon' })).toBeVisible();
  // ohne Scan nichts zu sichern
  await sheet.getByRole('button', { name: 'Sichern' }).click();
  await expect(sheet.locator('#f-error')).toHaveText('Nichts zu übernehmen. Erst einen Bon scannen.');

  await sheet.locator('[data-file]').setInputFiles({ name: 'bon.png', mimeType: 'image/png', buffer: PNG });
  await expect(sheet.locator('#scan-status')).toHaveText('Heute wurden schon 20 Bons gescannt. Morgen geht es wieder.');

  await sheet.locator('[data-file]').setInputFiles({ name: 'bon.png', mimeType: 'image/png', buffer: PNG });
  await expect(sheet.locator('#scan-status')).toHaveText('4 Zeilen gelesen, 2 zugeordnet.');
  expect(calls[1].media_type).toBe('image/jpeg');
  expect(calls[1].image).toMatch(/^[A-Za-z0-9+/]+=*$/); // reines Base64 ohne data:-Präfix
  await expect(sheet.getByLabel('Bezahlt (optional)')).toHaveValue('7,56');
  const line = (text) => sheet.locator(`[data-testid=receipt-line][data-text="${text}"]`);
  await expect(line('ZOTT MONTE')).toContainText('×2');
  await expect(line('ZOTT MONTE').locator('.check-badge')).toHaveText('prüfen');
  await expect(line('ZOTT MONTE').locator('select')).toHaveValue(ids.Joghurt);
  await expect(line('H-MILCH 1,5%').locator('.check-badge')).toHaveCount(0);
  await expect(line('KAFFEE GEMAHLEN').locator('select')).toHaveValue('');
  await expect(line('ERFUNDEN').locator('select')).toHaveValue(''); // unbekannte id verworfen
  // von Hand zuordnen
  await sheet.getByLabel('Produkt für „KAFFEE GEMAHLEN“').selectOption({ label: 'Brot' });
  await sheet.getByRole('button', { name: 'Sichern' }).click();
  await expect(a.locator('#toast')).toHaveText(/7,56\s€ eingetragen, 3 Preise übernommen/);

  // Ausgabe mit Datum vom Bon, Preise bei beiden
  await expect(a.locator('[data-testid=expense]').first()).toContainText(money('7,56'));
  await b.getByRole('tab', { name: 'Produkte' }).click();
  await expect(product(b, 'Joghurt').getByTestId('price')).toHaveText(money('0,69'));
  await expect(product(b, 'Milch').getByTestId('price')).toHaveText(money('1,19'));
  await expect(product(b, 'Brot').getByTestId('price')).toHaveText(money('4,99'));

  // --- Gelernter Bon-Name: beim nächsten Scan sicher zugeordnet ----------------------
  await a.getByRole('button', { name: 'Bon scannen' }).click();
  await sheet.locator('[data-file]').setInputFiles({ name: 'bon.png', mimeType: 'image/png', buffer: PNG });
  await expect(sheet.locator('#scan-status')).toHaveText('1 Zeile gelesen, 1 zugeordnet.');
  await expect(line('zott  monte').locator('select')).toHaveValue(ids.Joghurt);
  await expect(line('zott  monte').locator('.check-badge')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Abbrechen' }).click();

  expect(errors).toEqual([]);
  await Promise.all([ctxA.close(), ctxB.close()]);
});

test('Bon-Scan nicht eingerichtet: verständliche Meldung', async ({ page }) => {
  await signUp(page, `price-c-${run}@example.com`);
  await page.getByLabel('Name').fill('Ohne Scan');
  await page.getByRole('button', { name: 'Haushalt anlegen' }).click();
  await fakeScan(page, () => ({ status: 404, body: { message: 'Requested function was not found' } }));
  await page.getByRole('tab', { name: 'Ausgaben' }).click();
  await page.getByRole('button', { name: 'Bon scannen' }).click();
  await page.locator('#sheet [data-file]').setInputFiles({ name: 'bon.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('#scan-status')).toHaveText('Der Bon-Scan ist noch nicht eingerichtet (SETUP.md, Schritt 11).');
});
