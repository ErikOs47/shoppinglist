// Ladebildschirm: sichtbar, solange die App lädt; verschwindet, sobald die
// erste richtige Ansicht steht.

import { test, expect } from '@playwright/test';

const run = Date.now();
const splash = (page) => page.getByTestId('splash');

test('Ladebildschirm beim ersten Laden, dann Anmeldung', async ({ page }) => {
  // App-Code verzögert ausliefern, wie bei langsamem Netz
  await page.route('**/assets/*.js', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.goto('/', { waitUntil: 'commit' });
  await expect(splash(page)).toBeVisible();
  await expect(splash(page)).toContainText('Einkauf');
  await expect(splash(page)).toHaveAttribute('role', 'status');
  // Ladebalken erscheint erst nach kurzer Zeit
  await expect(page.locator('.splash-bar')).toHaveCSS('opacity', '1', { timeout: 3000 });

  await expect(page.getByRole('button', { name: 'Neues Konto erstellen' })).toBeVisible();
  await expect(splash(page)).toHaveCount(0); // ausgeblendet und entfernt
});

test('Angemeldet ohne Zwischenspeicher: Ladebildschirm bis der Haushalt geladen ist', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Neues Konto erstellen' }).click();
  await page.getByLabel('E-Mail').fill(`splash-${run}@example.com`);
  await page.getByLabel('Passwort').fill('geheim123');
  await page.getByRole('button', { name: 'Registrieren' }).click();
  await page.getByLabel('Name').fill('Laden');
  await page.getByRole('button', { name: 'Haushalt anlegen' }).click();
  await expect(page.getByTestId('sync')).toHaveText('Live');

  // Zwischenspeicher des Haushalts löschen (wie auf einem neuen Gerät) und das
  // Laden des Haushalts verzögern
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('household:') || k.startsWith('store:')) localStorage.removeItem(k);
  });
  await page.route('**/rest/v1/households*', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.reload({ waitUntil: 'commit' });
  await expect(splash(page)).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Produkte' })).toBeVisible({ timeout: 15_000 });
  await expect(splash(page)).toHaveCount(0);

  // Mit Zwischenspeicher steht die App sofort, ohne auf den Server zu warten
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Produkte' })).toBeVisible({ timeout: 1400 });
  await expect(splash(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});
