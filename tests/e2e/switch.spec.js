// Haushalt wechseln: B hat versehentlich einen eigenen Haushalt angelegt und
// wechselt mit dem Code von A. Bs Produkte kommen mit, Bs alter Haushalt verschwindet.

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

async function createHousehold(page, name) {
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Haushalt anlegen' }).click();
  await expect(page.getByTestId('sync')).toHaveText('Live');
}

async function addProduct(page, name) {
  await page.getByRole('tab', { name: 'Produkte' }).click();
  await page.getByRole('button', { name: 'Produkt hinzufügen' }).click();
  await page.locator('#sheet').getByLabel('Name').fill(name);
  await page.locator('#sheet').getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(page.locator('#sheet')).not.toBeVisible();
}

const productNames = (page) =>
  page.locator('[data-testid=product]').evaluateAll((els) => els.map((e) => e.dataset.name).sort());

async function switchTo(page, code) {
  await page.getByRole('button', { name: 'Einstellungen' }).click();
  await page.locator('#sheet').getByLabel('Code').fill(code);
  await page.locator('#sheet').getByRole('button', { name: 'Wechseln' }).click();
}

test('versehentlich eigener Haushalt: per Code wechseln, Produkte kommen mit', async ({ browser }) => {
  test.setTimeout(120_000);
  const [ctxA, ctxB, ctxC] = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  const [a, b, c] = await Promise.all([ctxA.newPage(), ctxB.newPage(), ctxC.newPage()]);
  const errors = [];
  for (const p of [a, b, c]) p.on('pageerror', (e) => errors.push(e.message));

  // A: richtiger Haushalt
  await signUp(a, `sw-a-${run}@example.com`);
  await createHousehold(a, 'CasaA');
  await addProduct(a, 'Milch');
  await addProduct(a, 'Brot');
  await a.getByRole('button', { name: 'Einstellungen' }).click();
  const code = (await a.getByTestId('invite-code').textContent()).trim();
  await a.locator('#sheet').getByRole('button', { name: 'Fertig' }).click();

  // B: versehentlich eigener Haushalt mit eigenen Produkten
  await signUp(b, `sw-b-${run}@example.com`);
  await createHousehold(b, 'Versehen');
  await addProduct(b, 'milch'); // gleicher Name wie bei A, andere Schreibweise
  await addProduct(b, 'Kaffee');

  // --- Schutz: offline mit wartender Änderung wird nicht gewechselt -------
  await ctxB.setOffline(true);
  await addProduct(b, 'Tee');
  await switchTo(b, code);
  await expect(b.locator('#toast')).toContainText('noch nicht gesendete Änderungen');
  await b.locator('#sheet [data-close]').click();
  await ctxB.setOffline(false);
  await expect(b.getByTestId('sync')).toHaveText('Live', { timeout: 20_000 });

  // --- Wechsel mit Sicherheitsabfrage ------------------------------------
  await switchTo(b, code.toLowerCase());
  await expect(b.locator('#confirm')).toContainText('Du verlässt „Versehen“');
  await expect(b.locator('#confirm')).toContainText('werden deine 3 Produkte mitgenommen');
  await b.locator('#confirm').getByRole('button', { name: 'Wechseln' }).click();
  await expect(b.locator('#toast')).toHaveText('Willkommen in „CasaA“');

  // B sieht den gemeinsamen Bestand, Milch nur einmal
  await b.getByRole('tab', { name: 'Produkte' }).click();
  await expect.poll(() => productNames(b)).toEqual(['Brot', 'Kaffee', 'Milch', 'Tee']);
  // A sieht Bs mitgebrachte Produkte in Echtzeit
  await a.getByRole('tab', { name: 'Produkte' }).click();
  await expect.poll(() => productNames(a)).toEqual(['Brot', 'Kaffee', 'Milch', 'Tee']);

  // Haushalt ist jetzt voll: Einstellungen zeigen 2 von 2, kein Einladungscode mehr
  await b.getByRole('button', { name: 'Einstellungen' }).click();
  await expect(b.locator('#sheet')).toContainText('Mitglieder: 2 von 2');
  await expect(b.locator('#s-name')).toHaveValue('CasaA');
  await expect(b.getByTestId('invite-code')).toHaveCount(0);
  await b.locator('#sheet [data-close]').click();

  // Nach Neuladen bleibt B im neuen Haushalt
  await b.reload();
  await b.getByRole('tab', { name: 'Produkte' }).click();
  await expect.poll(() => productNames(b)).toEqual(['Brot', 'Kaffee', 'Milch', 'Tee']);

  // --- Dritter kann nicht in den vollen Haushalt wechseln -----------------
  await signUp(c, `sw-c-${run}@example.com`);
  await createHousehold(c, 'Haushalt C');
  await switchTo(c, code);
  await c.locator('#confirm').getByRole('button', { name: 'Wechseln' }).click();
  await expect(c.locator('#toast')).toHaveText('Haushalt hat bereits zwei Mitglieder');
  await expect(c.locator('#s-name')).toHaveValue('Haushalt C'); // bleibt in seinem Haushalt

  expect(errors).toEqual([]);
  await Promise.all([ctxA.close(), ctxB.close(), ctxC.close()]);
});
