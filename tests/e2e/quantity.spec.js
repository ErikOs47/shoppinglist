// Mengen auf dem Einkaufszettel: „− n +“, mindestens 1, in Echtzeit bei beiden.

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

async function addProduct(page, name, price) {
  await page.getByRole('tab', { name: 'Produkte' }).click();
  await page.getByRole('button', { name: 'Produkt hinzufügen' }).click();
  const sheet = page.locator('#sheet');
  await sheet.getByLabel('Name').fill(name);
  if (price) await sheet.getByLabel('Preis').fill(price);
  await sheet.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(sheet).not.toBeVisible();
}

const item = (page, name) => page.locator(`[data-testid=item][data-name="${name}"]`);

test('Mengen ändern, mindestens 1, beide sehen es', async ({ browser }) => {
  test.setTimeout(120_000);
  const [ctxA, ctxB] = await Promise.all([browser.newContext(), browser.newContext()]);
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const errors = [];
  for (const p of [a, b]) p.on('pageerror', (e) => errors.push(e.message));

  await signUp(a, `qty-a-${run}@example.com`);
  await a.getByLabel('Name').fill('Mengen');
  await a.getByRole('button', { name: 'Haushalt anlegen' }).click();
  await expect(a.getByTestId('sync')).toHaveText('Live');
  await a.getByRole('button', { name: 'Einstellungen' }).click();
  const code = (await a.getByTestId('invite-code').textContent()).trim();
  await a.locator('#sheet').getByRole('button', { name: 'Fertig' }).click();
  await signUp(b, `qty-b-${run}@example.com`);
  await b.getByLabel('Code').fill(code);
  await b.getByRole('button', { name: 'Beitreten' }).click();
  await expect(b.getByTestId('sync')).toHaveText('Live');

  await addProduct(a, 'Eier', '0,30');
  await addProduct(a, 'Milch');
  await a.getByRole('tab', { name: 'Einkaufszettel' }).click();
  await b.getByRole('tab', { name: 'Einkaufszettel' }).click();

  // Start bei 1, Minus gesperrt
  await expect(item(a, 'Eier').getByTestId('qty')).toHaveText('1');
  await expect(a.getByRole('button', { name: 'Eier: eins weniger' })).toBeDisabled();

  // Plus: Menge, Preis × Menge und Schätzung; B sieht es in Echtzeit
  for (let i = 0; i < 3; i++) await a.getByRole('button', { name: 'Eier: eins mehr' }).click();
  await expect(item(a, 'Eier').getByTestId('qty')).toHaveText('4');
  await expect(item(a, 'Eier')).toContainText(/1,20\s€/);
  await expect(a.getByTestId('estimate')).toHaveText(/ca\. 1,20\s€ · 1 ohne Preis/);
  await expect(item(b, 'Eier').getByTestId('qty')).toHaveText('4');
  await expect(b.getByTestId('estimate')).toHaveText(/ca\. 1,20\s€/);

  // B verringert, A sieht es; nicht unter 1
  await b.getByRole('button', { name: 'Eier: eins weniger' }).click();
  await expect(item(a, 'Eier').getByTestId('qty')).toHaveText('3');
  await a.getByRole('button', { name: 'Eier: eins weniger' }).click();
  await a.getByRole('button', { name: 'Eier: eins weniger' }).click();
  await expect(item(a, 'Eier').getByTestId('qty')).toHaveText('1');
  await expect(a.getByRole('button', { name: 'Eier: eins weniger' })).toBeDisabled();
  await a.getByRole('button', { name: 'Eier: eins mehr' }).click();
  await a.getByRole('button', { name: 'Eier: eins mehr' }).click();
  await expect(item(b, 'Eier').getByTestId('qty')).toHaveText('3');

  // Tippen auf das Mengenfeld hakt nicht ab
  await expect(item(a, 'Eier')).toHaveAttribute('data-checked', 'false');

  // Im Wagen: „3 ×“ statt Mengenfeld; Abschließen zeigt die Menge
  await item(a, 'Eier').locator('.row-main').click();
  await expect(item(a, 'Eier').getByTestId('qty')).toHaveText('3 ×');
  await expect(item(a, 'Eier').locator('.stepper')).toHaveCount(0);
  await a.getByTestId('finish').click();
  await expect(a.locator('#sheet label[for=pr-0]')).toHaveText('3 × Eier');
  await a.locator('#sheet').getByRole('button', { name: 'Abschließen' }).click();
  await expect(item(a, 'Eier')).toHaveCount(0);

  // Wieder auf den Zettel: Menge beginnt bei 1
  await a.locator('[data-testid=suggestion]').first().click();
  await expect(item(a, 'Eier').getByTestId('qty')).toHaveText('1');

  expect(errors).toEqual([]);
  await Promise.all([ctxA.close(), ctxB.close()]);
});
