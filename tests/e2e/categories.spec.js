// Kategorien ein-/ausklappen und umbenennen (Tab „Produkte“), Suche in „Gerichte“.

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

async function addProduct(page, name, category) {
  await page.getByRole('tab', { name: 'Produkte' }).click();
  await page.getByRole('button', { name: 'Produkt hinzufügen' }).click();
  const sheet = page.locator('#sheet');
  await sheet.getByLabel('Name').fill(name);
  await sheet.getByLabel('Kategorie').selectOption(category);
  await sheet.locator('input[name=addToList]').uncheck();
  await sheet.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(sheet).not.toBeVisible();
}

const category = (page, name) => page.locator(`[data-testid=category][data-category="${name}"]`);
const product = (page, name) => page.locator(`[data-testid=product][data-name="${name}"]`);
const categoryOf = (page, name) =>
  page.locator(`[data-testid=product][data-name="${name}"]`).evaluate((el) => el.closest('[data-testid=category]').dataset.category);

test('Kategorien einklappen und umbenennen, Gerichte durchsuchen', async ({ browser }) => {
  test.setTimeout(120_000);
  const [ctxA, ctxB] = await Promise.all([browser.newContext(), browser.newContext()]);
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const errors = [];
  for (const p of [a, b]) p.on('pageerror', (e) => errors.push(e.message));

  await signUp(a, `cat-a-${run}@example.com`);
  await a.getByLabel('Name').fill('Kategorien');
  await a.getByRole('button', { name: 'Haushalt anlegen' }).click();
  await expect(a.getByTestId('sync')).toHaveText('Live');
  await a.getByRole('button', { name: 'Einstellungen' }).click();
  const code = (await a.getByTestId('invite-code').textContent()).trim();
  await a.locator('#sheet').getByRole('button', { name: 'Fertig' }).click();
  await signUp(b, `cat-b-${run}@example.com`);
  await b.getByLabel('Code').fill(code);
  await b.getByRole('button', { name: 'Beitreten' }).click();
  await expect(b.getByTestId('sync')).toHaveText('Live');

  await addProduct(a, 'Äpfel', 'Obst & Gemüse');
  await addProduct(a, 'Bananen', 'Obst & Gemüse');
  await addProduct(a, 'Cola', 'Getränke');
  await addProduct(a, 'Chips', 'Süßes & Snacks');

  // --- Einklappen: Produkte verschwinden, Anzahl bleibt sichtbar ----------------
  await expect(category(a, 'Obst & Gemüse')).toContainText('2');
  await category(a, 'Obst & Gemüse').getByRole('button', { name: 'Obst & Gemüse einklappen' }).click();
  await expect(product(a, 'Äpfel')).toHaveCount(0);
  await expect(product(a, 'Cola')).toBeVisible();
  // Suche zeigt Treffer auch in eingeklappten Kategorien
  await a.getByRole('searchbox', { name: 'Produkte durchsuchen' }).fill('äpf');
  await expect(product(a, 'Äpfel')).toBeVisible();
  await a.getByRole('button', { name: 'Suche leeren' }).click();
  await expect(product(a, 'Äpfel')).toHaveCount(0);
  // bleibt nach Neuladen eingeklappt (pro Gerät), bei B nicht
  await a.reload();
  await a.getByRole('tab', { name: 'Produkte' }).click();
  await expect(product(a, 'Äpfel')).toHaveCount(0);
  await b.getByRole('tab', { name: 'Produkte' }).click();
  await expect(product(b, 'Äpfel')).toBeVisible();
  await category(a, 'Obst & Gemüse').getByRole('button', { name: 'Obst & Gemüse ausklappen' }).click();
  await expect(product(a, 'Äpfel')).toBeVisible();

  // --- Umbenennen: neuer Name, B sieht es in Echtzeit --------------------------
  await category(a, 'Getränke').getByRole('button', { name: 'Kategorie Getränke umbenennen' }).click();
  const sheet = a.locator('#sheet');
  await expect(sheet).toContainText('Gilt für 1 Produkt');
  await sheet.getByLabel('Name').fill('  ');
  await sheet.getByRole('button', { name: 'Sichern' }).click();
  await expect(sheet.locator('#c-error')).toHaveText('Bitte einen Namen eingeben.');
  await sheet.getByLabel('Name').fill('Drinks');
  await sheet.getByRole('button', { name: 'Sichern' }).click();
  await expect(a.locator('#toast')).toHaveText('„Getränke“ heißt jetzt „Drinks“');
  await expect.poll(() => categoryOf(a, 'Cola')).toBe('Drinks');
  await expect.poll(() => categoryOf(b, 'Cola')).toBe('Drinks');

  // --- Umbenennen auf vorhandenen Namen: Rückfrage, dann zusammenführen --------
  await category(a, 'Süßes & Snacks').getByRole('button', { name: /umbenennen/ }).click();
  await sheet.getByLabel('Name').fill('drinks');
  await sheet.getByRole('button', { name: 'Sichern' }).click();
  await expect(a.locator('#confirm')).toContainText('„Drinks“ gibt es schon');
  await a.locator('#confirm').getByRole('button', { name: 'Abbrechen' }).click();
  await expect.poll(() => categoryOf(a, 'Chips')).toBe('Süßes & Snacks'); // nichts geändert
  await sheet.getByRole('button', { name: 'Sichern' }).click();
  await a.locator('#confirm').getByRole('button', { name: 'Zusammenführen' }).click();
  await expect(a.locator('#toast')).toHaveText('„Süßes & Snacks“ mit „Drinks“ zusammengeführt');
  await expect(category(a, 'Drinks')).toContainText('2');
  await expect.poll(() => categoryOf(b, 'Chips')).toBe('Drinks');

  // Neue Kategorie steht auch im Produkt-Editor zur Auswahl
  await product(b, 'Chips').locator('[data-action=edit-product]').click();
  await expect(b.locator('#sheet').getByLabel('Kategorie')).toHaveValue('Drinks');
  await b.locator('#sheet [data-close]').click();

  // --- Suche in „Gerichte“ (Name und Zutat) ---------------------------------------
  await a.getByRole('tab', { name: 'Essen' }).click();
  await a.getByRole('tab', { name: 'Gerichte' }).click();
  for (const [name, ingredients] of [
    ['Obstsalat', ['Äpfel', 'Bananen']],
    ['Filmabend', ['Chips', 'Cola']],
    ['Apfelkuchen', ['Äpfel']],
  ]) {
    await a.getByRole('button', { name: 'Gericht hinzufügen' }).click();
    await sheet.getByLabel('Name').fill(name);
    for (const i of ingredients) await sheet.locator(`[data-testid=choice][data-name="${i}"]`).click();
    await sheet.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
    await expect(sheet).not.toBeVisible();
  }
  const meals = () => a.locator('[data-testid=meal]').evaluateAll((els) => els.map((e) => e.dataset.name));
  await expect.poll(meals).toEqual(['Apfelkuchen', 'Filmabend', 'Obstsalat']);
  const search = a.getByRole('searchbox', { name: 'Gerichte oder Zutaten suchen' });
  await search.fill('film');
  await expect.poll(meals).toEqual(['Filmabend']);
  await search.fill('äpfel'); // über die Zutat
  await expect.poll(meals).toEqual(['Apfelkuchen', 'Obstsalat']);
  // Tippen verliert den Fokus nicht (Suchfeld wird nicht neu gezeichnet)
  await search.pressSequentially('x');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('äpfelx');
  await expect(a.getByText('Kein Gericht gefunden.')).toBeVisible();
  await a.getByRole('button', { name: 'Suche leeren' }).click();
  await expect.poll(meals).toEqual(['Apfelkuchen', 'Filmabend', 'Obstsalat']);
  // Wochenansicht hat kein Suchfeld
  await a.getByRole('tab', { name: 'Woche' }).click();
  await expect(a.getByRole('searchbox')).toHaveCount(0);

  expect(errors).toEqual([]);
  await Promise.all([ctxA.close(), ctxB.close()]);
});
