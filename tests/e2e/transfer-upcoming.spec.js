// „Zutaten auf den Zettel“ nimmt nur Gerichte von heute und den folgenden
// Tagen. Was gestern geplant war, ist gegessen und kommt nicht auf den Zettel.

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

async function addMeal(page, name, ingredient) {
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await page.getByRole('button', { name: 'Gericht hinzufügen' }).click();
  const sheet = page.locator('#sheet');
  await sheet.getByLabel('Name').fill(name);
  await sheet.getByPlaceholder('Produkt suchen oder neu anlegen').fill(ingredient);
  await sheet.getByRole('button', { name: `„${ingredient}“ als Produkt anlegen` }).click();
  await sheet.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  await expect(sheet).not.toBeVisible();
}

async function plan(page, day, meal) {
  await page.locator(`[data-testid=day][data-day="${day}"] [data-action=plan-add]`).click();
  await page.locator(`#sheet [data-testid=pick][data-name="${meal}"]`).click();
  await expect(page.locator(`[data-testid=day][data-day="${day}"] [data-testid=planned][data-name="${meal}"]`)).toBeVisible();
}

test('Zutaten auf den Zettel: nur heute und folgende Tage', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signUp(page, `upcoming-${run}@example.com`);
  await page.getByLabel('Name').fill('Ab heute');
  await page.getByRole('button', { name: 'Haushalt anlegen' }).click();

  await page.getByRole('tab', { name: 'Essen' }).click();
  await addMeal(page, 'Gestern-Curry', 'Lauch');
  await addMeal(page, 'Heute-Risotto', 'Reis');
  await page.getByRole('tab', { name: 'Woche' }).click();

  const { today, yesterday, sameWeek } = await page.evaluate(() => {
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const now = new Date();
    const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    return { today: iso(now), yesterday: iso(y), sameWeek: now.getDay() !== 1 }; // montags liegt gestern in der Vorwoche
  });

  // Nur ein vergangenes Gericht: kein Knopf zum Übernehmen
  if (!sameWeek) await page.getByRole('button', { name: 'Vorige Woche' }).click();
  await plan(page, yesterday, 'Gestern-Curry');
  await expect(page.getByTestId('transfer')).toHaveCount(0);
  if (!sameWeek) await page.getByRole('button', { name: 'Diese Woche' }).click();

  // Mit einem Gericht für heute: nur dessen Zutaten
  await plan(page, today, 'Heute-Risotto');
  await page.getByTestId('transfer').click();
  const sheet = page.locator('#sheet');
  const names = () => sheet.locator('[data-testid=transfer-row]').evaluateAll((els) => els.map((e) => e.dataset.name));
  await expect.poll(names).toEqual(['Reis']);
  if (sameWeek) await expect(sheet.getByTestId('transfer-from')).toHaveText('Nur Gerichte ab heute – was schon gegessen ist, bleibt draußen.');
  await sheet.getByTestId('transfer-confirm').click();
  await expect(page.locator('#toast')).toHaveText('1 Zutat auf den Zettel gesetzt');

  // Zettel: Reis ja, Lauch nein
  await page.getByRole('tab', { name: 'Einkaufszettel' }).click();
  await expect(page.locator('[data-testid=item][data-name=Reis]')).toBeVisible();
  await expect(page.locator('[data-testid=item][data-name=Lauch]')).toHaveCount(0);

  expect(errors).toEqual([]);
});
