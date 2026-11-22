// Sprache gilt pro Konto: A stellt auf Englisch, B bleibt auf Deutsch.
// Produktnamen und eigene Kategorien bleiben unverändert, vorgegebene
// Kategorien werden nur angezeigt übersetzt.

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

test('Sprache pro Konto umstellen, die andere Person bleibt bei ihrer Sprache', async ({ browser }) => {
  test.setTimeout(120_000);
  const emailA = `lang-a-${run}@example.com`;
  const [ctxA, ctxB] = await Promise.all([browser.newContext(), browser.newContext()]);
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const errors = [];
  for (const p of [a, b]) p.on('pageerror', (e) => errors.push(e.message));

  await signUp(a, emailA);
  await a.getByLabel('Name').fill('Zuhause');
  await a.getByRole('button', { name: 'Haushalt anlegen' }).click();
  await a.getByRole('button', { name: 'Einstellungen' }).click();
  const code = (await a.getByTestId('invite-code').textContent()).trim();
  await a.locator('#sheet').getByRole('button', { name: 'Fertig' }).click();
  await signUp(b, `lang-b-${run}@example.com`);
  await b.getByLabel('Code').fill(code);
  await b.getByRole('button', { name: 'Beitreten' }).click();
  await expect(b.getByTestId('sync')).toHaveText('Live');

  // Produkte mit vorgegebener und eigener Kategorie
  await a.getByRole('tab', { name: 'Produkte' }).click();
  for (const [name, cat] of [['Hafermilch', 'Milchprodukte & Eier'], ['Katzenfutter', null]]) {
    await a.getByRole('button', { name: 'Produkt hinzufügen' }).click();
    await a.locator('#sheet').getByLabel('Name').fill(name);
    if (cat) await a.locator('#sheet').getByLabel('Kategorie').selectOption(cat);
    else {
      await a.locator('#sheet').getByLabel('Kategorie').selectOption('__new__');
      await a.locator('#sheet').getByLabel('Neu').fill('Haustier');
    }
    await a.locator('#sheet').getByRole('button', { name: 'Hinzufügen' }).click();
  }

  // --- A stellt auf Englisch --------------------------------------------
  await a.getByRole('button', { name: 'Einstellungen' }).click();
  await expect(a.getByText('Gilt nur für dein Konto, nicht für den ganzen Haushalt.')).toBeVisible();
  await a.locator('#sheet').getByLabel('Sprache').selectOption('en');
  await expect(a.locator('#sheet').getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(a.locator('#sheet').getByLabel('Language')).toHaveValue('en');
  await a.locator('#sheet').getByRole('button', { name: 'Done' }).click();

  await expect(a.getByRole('heading', { level: 1, name: 'Products' })).toBeVisible();
  await expect(a.getByRole('tab', { name: 'Shopping list' })).toBeVisible();
  await expect(a.getByPlaceholder('Search or add new')).toBeVisible();
  await expect(a.locator('main h2', { hasText: 'Dairy & Eggs' })).toBeVisible(); // vorgegebene Kategorie übersetzt
  await expect(a.locator('main h2', { hasText: 'Haustier' })).toBeVisible(); // eigene Kategorie unverändert
  await expect(a.locator('[data-testid=product][data-name="Hafermilch"]')).toBeVisible(); // Produktname unverändert
  expect(await a.evaluate(() => document.documentElement.lang)).toBe('en');

  // Suche findet die Kategorie auch über den englischen Namen
  await a.getByPlaceholder('Search or add new').fill('dairy');
  await expect(a.locator('[data-testid=product]')).toHaveCount(1);
  await a.getByRole('button', { name: 'Clear search' }).click();

  // --- B bleibt auf Deutsch, sieht aber dieselben Daten -------------------
  await b.getByRole('tab', { name: 'Produkte' }).click();
  await expect(b.getByRole('heading', { level: 1, name: 'Produkte' })).toBeVisible();
  await expect(b.locator('main h2', { hasText: 'Milchprodukte & Eier' })).toBeVisible();
  await expect(b.locator('[data-testid=product][data-name="Hafermilch"]')).toBeVisible();
  await b.reload();
  await expect(b.getByRole('tab', { name: 'Einkaufszettel' })).toBeVisible();

  // --- Englisch bleibt nach Neuladen ------------------------------------
  await a.reload();
  await expect(a.getByRole('tab', { name: 'Shopping list' })).toBeVisible();

  // --- A meldet sich auf einem anderen Gerät an: Sprache kommt aus dem Konto
  const ctxA2 = await browser.newContext(); // eigenes Gerät, Locale de-DE, leerer Speicher
  const a2 = await ctxA2.newPage();
  await a2.goto('/');
  await expect(a2.getByRole('button', { name: 'Anmelden' })).toBeVisible(); // vor Anmeldung: Gerätesprache
  await a2.getByLabel('E-Mail').fill(emailA);
  await a2.getByLabel('Passwort').fill(PW);
  await a2.getByRole('button', { name: 'Anmelden' }).click();
  await expect(a2.getByRole('tab', { name: 'Shopping list' })).toBeVisible();

  // --- Portugiesisch (pt-PT), dann zurück auf Deutsch ---------------------
  await a.getByRole('button', { name: 'Settings' }).click();
  await a.locator('#sheet').getByLabel('Language').selectOption('pt');
  await expect(a.locator('#sheet').getByRole('heading', { name: 'Definições' })).toBeVisible();
  await a.locator('#sheet').getByRole('button', { name: 'Concluído' }).click();
  await expect(a.getByRole('tab', { name: 'Lista de compras' })).toBeVisible();
  await expect(a.locator('main h2', { hasText: 'Laticínios e ovos' })).toBeVisible();
  await a.getByRole('button', { name: 'Definições' }).click();
  await a.locator('#sheet').getByLabel('Idioma').selectOption('de');
  await expect(a.locator('#sheet').getByRole('heading', { name: 'Einstellungen' })).toBeVisible();

  expect(errors).toEqual([]);
  await Promise.all([ctxA.close(), ctxB.close(), ctxA2.close()]);
});
