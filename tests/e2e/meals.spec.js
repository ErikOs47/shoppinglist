// Essen: Gerichte anlegen (auch per Link-Import), in der Woche einplanen,
// Zutaten auf den Zettel bringen. Zwei Personen, Echtzeit, offline.

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

async function addProduct(page, name, { toList }) {
  await page.getByRole('tab', { name: 'Produkte' }).click();
  await page.getByRole('button', { name: 'Produkt hinzufügen' }).click();
  const sheet = page.locator('#sheet');
  await sheet.getByLabel('Name').fill(name);
  if (!toList) await sheet.locator('input[name=addToList]').uncheck();
  await sheet.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  await expect(sheet).not.toBeVisible();
}

const SEARCH = 'Produkt suchen oder neu anlegen';

/** Vorhandenes Produkt in der Auswahlliste antippen (hinzufügen/entfernen). */
async function pickIngredient(sheet, name) {
  await sheet.locator(`[data-testid=choice][data-name="${name}"]`).click();
}

/** Neues Produkt über die Suche anlegen; wird gleich Zutat. */
async function createIngredient(sheet, name) {
  await sheet.getByPlaceholder(SEARCH).fill(name);
  await sheet.getByRole('button', { name: `„${name}“ als Produkt anlegen` }).click();
}

const ingredientNames = (sheet) =>
  sheet.locator('[data-testid=ingredient]').evaluateAll((els) => els.map((e) => e.dataset.name));
const today = (page) => page.locator('[data-testid=day].is-today');
const item = (page, name) => page.locator(`[data-testid=item][data-name="${name}"]`);
const itemNames = (page) =>
  page.locator('[data-testid=item]').evaluateAll((els) => els.map((e) => e.dataset.name).sort());

test('Gericht anlegen, einplanen, Zutaten ohne Vorhandenes auf den Zettel', async ({ browser }) => {
  test.setTimeout(150_000);
  const [ctxA, ctxB] = await Promise.all([browser.newContext(), browser.newContext()]);
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const errors = [];
  for (const p of [a, b]) p.on('pageerror', (e) => errors.push(e.message));

  // --- gemeinsamer Haushalt --------------------------------------------------
  await signUp(a, `meal-a-${run}@example.com`);
  await a.getByLabel('Name').fill('Küche');
  await a.getByRole('button', { name: 'Haushalt anlegen' }).click();
  await expect(a.getByTestId('sync')).toHaveText('Live');
  await a.getByRole('button', { name: 'Einstellungen' }).click();
  const code = (await a.getByTestId('invite-code').textContent()).trim();
  await a.locator('#sheet').getByRole('button', { name: 'Fertig' }).click();
  await signUp(b, `meal-b-${run}@example.com`);
  await b.getByLabel('Code').fill(code);
  await b.getByRole('button', { name: 'Beitreten' }).click();
  await expect(b.getByTestId('sync')).toHaveText('Live');

  // Zwiebel steht schon auf dem Zettel, Spaghetti gibt es als Produkt
  await addProduct(a, 'Zwiebel', { toList: true });
  await addProduct(a, 'Spaghetti', { toList: false });

  // --- Gericht anlegen -----------------------------------------------------------
  await a.getByRole('tab', { name: 'Essen' }).click();
  await a.getByRole('tab', { name: 'Gerichte' }).click();
  await expect(a.getByText('Noch keine Gerichte')).toBeVisible();
  await a.getByRole('button', { name: 'Gericht hinzufügen' }).click();
  const sheet = a.locator('#sheet');
  await sheet.getByLabel('Name').fill('Bolognese');
  // Return im Namensfeld springt zur Produktsuche, statt zu speichern
  await sheet.getByLabel('Name').press('Enter');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByPlaceholder(SEARCH)).toBeFocused();
  // Auswahlliste zeigt die vorhandenen Produkte
  await expect(sheet.locator('[data-testid=choice]')).toHaveCount(2);
  await createIngredient(sheet, 'Hackfleisch'); // gibt es noch nicht → anlegen
  await expect(sheet.getByPlaceholder(SEARCH)).toHaveValue('');
  await sheet.getByPlaceholder(SEARCH).fill('spag'); // Suche filtert
  await expect(sheet.locator('[data-testid=choice]')).toHaveCount(1);
  await pickIngredient(sheet, 'Spaghetti');
  await sheet.getByPlaceholder(SEARCH).fill('');
  await pickIngredient(sheet, 'Zwiebel');
  // Return in der Suche: vorhandenes Produkt wählen bzw. neues anlegen, ohne zu speichern
  await sheet.getByPlaceholder(SEARCH).fill('Tomaten');
  await sheet.getByPlaceholder(SEARCH).press('Enter');
  await expect(sheet).toBeVisible();
  await expect.poll(() => ingredientNames(sheet)).toEqual(['Hackfleisch', 'Spaghetti', 'Zwiebel', 'Tomaten']);
  await expect(sheet.locator('#m-ing-title')).toHaveText('Zutaten (4)');
  // Abwählen über den Chip und über die Liste
  await sheet.getByRole('button', { name: 'Zwiebel entfernen' }).click();
  await expect(sheet.locator('[data-testid=choice][data-name=Zwiebel]')).toHaveAttribute('aria-checked', 'false');
  await pickIngredient(sheet, 'Zwiebel');
  await expect.poll(() => ingredientNames(sheet)).toEqual(['Hackfleisch', 'Spaghetti', 'Tomaten', 'Zwiebel']);
  await sheet.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  await expect(sheet).not.toBeVisible();
  await expect(a.locator('[data-testid=meal][data-name=Bolognese]')).toContainText('4 Zutaten');

  // B sieht das Gericht in Echtzeit
  await b.getByRole('tab', { name: 'Essen' }).click();
  await b.getByRole('tab', { name: 'Gerichte' }).click();
  await expect(b.locator('[data-testid=meal][data-name=Bolognese]')).toBeVisible();

  // Doppelter Name wird abgelehnt
  await b.getByRole('button', { name: 'Gericht hinzufügen' }).click();
  await b.locator('#sheet').getByLabel('Name').fill('bolognese');
  await b.locator('#sheet').getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  await expect(b.locator('#m-error')).toHaveText('„Bolognese“ gibt es schon.');
  await b.locator('#sheet [data-close]').click();

  // --- Einplanen: A plant für heute, B sieht es -------------------------------
  await a.getByRole('tab', { name: 'Woche' }).click();
  await today(a).getByRole('button', { name: /planen/ }).click();
  await a.locator('#sheet [data-testid=pick][data-name=Bolognese]').click();
  await expect(today(a).locator('[data-testid=planned][data-name=Bolognese]')).toBeVisible();
  await b.getByRole('tab', { name: 'Woche' }).click();
  await expect(today(b).locator('[data-testid=planned][data-name=Bolognese]')).toBeVisible();

  // Wochenwechsel: nächste Woche leer, zurück zu „Diese Woche“
  await a.getByRole('button', { name: 'Nächste Woche' }).click();
  await expect(a.locator('[data-testid=planned]')).toHaveCount(0);
  await expect(a.getByTestId('transfer')).toHaveCount(0);
  await a.getByRole('button', { name: 'Diese Woche' }).click();
  await expect(today(a).locator('[data-testid=planned]')).toHaveCount(1);

  // --- Zutaten auf den Zettel: Spaghetti haben wir schon -----------------------
  await a.getByTestId('transfer').click();
  const tl = a.locator('#sheet');
  const row = (name) => tl.locator(`[data-testid=transfer-row][data-name="${name}"]`);
  await expect(row('Zwiebel')).toBeDisabled(); // steht schon drauf
  await expect(row('Zwiebel')).toContainText('steht schon drauf');
  await expect(tl.getByTestId('transfer-confirm')).toHaveText('Auf den Zettel (3)');
  await row('Spaghetti').click(); // „haben wir“
  await expect(row('Spaghetti')).toHaveAttribute('aria-checked', 'false');
  await expect(tl.getByTestId('transfer-confirm')).toHaveText('Auf den Zettel (2)');
  await tl.getByTestId('transfer-confirm').click();
  await expect(a.locator('#toast')).toHaveText('2 Zutaten auf den Zettel gesetzt');

  // B sieht den Zettel: Zwiebel (war schon da), Hackfleisch und Tomaten neu, keine Spaghetti
  await b.getByRole('tab', { name: 'Einkaufszettel' }).click();
  await expect.poll(() => itemNames(b)).toEqual(['Hackfleisch', 'Tomaten', 'Zwiebel']);
  // Neu angelegte Produkte stehen unter „Sonstiges“
  await b.getByRole('tab', { name: 'Produkte' }).click();
  await expect(b.locator('section.group', { hasText: 'Sonstiges' }).locator('[data-testid=product][data-name=Hackfleisch]')).toBeVisible();

  // Zweites Übernehmen fügt nichts doppelt an
  await a.getByTestId('transfer').click();
  await expect(tl.getByTestId('transfer-confirm')).toHaveText('Auf den Zettel (1)'); // nur Spaghetti
  await tl.locator('[data-close]').click();

  // --- Offline einplanen, danach abgleichen --------------------------------------
  await ctxB.setOffline(true);
  await b.getByRole('tab', { name: 'Essen' }).click();
  await b.getByRole('button', { name: 'Nächste Woche' }).click();
  await b.locator('[data-testid=day]').first().getByRole('button', { name: /planen/ }).click();
  await b.locator('#sheet [data-testid=pick][data-name=Bolognese]').click();
  await expect(b.locator('[data-testid=planned]')).toHaveCount(1);
  await expect(b.getByTestId('sync')).toContainText('Offline');
  await ctxB.setOffline(false);
  await expect(b.getByTestId('sync')).toHaveText('Live', { timeout: 20_000 });
  await a.getByRole('button', { name: 'Nächste Woche' }).click();
  await expect(a.locator('[data-testid=planned][data-name=Bolognese]')).toHaveCount(1);

  // --- Gericht löschen entfernt es aus beiden Wochen ---------------------------
  await a.getByRole('tab', { name: 'Gerichte' }).click();
  await a.locator('[data-testid=meal][data-name=Bolognese] .row-main').click();
  await a.locator('#sheet').getByRole('button', { name: 'Gericht löschen' }).click();
  await a.locator('#confirm').getByRole('button', { name: 'Löschen' }).click();
  await expect(a.getByText('Noch keine Gerichte')).toBeVisible();
  await expect(b.locator('[data-testid=planned]')).toHaveCount(0);
  // Der Zettel bleibt unverändert
  await b.getByRole('tab', { name: 'Einkaufszettel' }).click();
  await expect(item(b, 'Hackfleisch')).toBeVisible();

  expect(errors).toEqual([]);
  await Promise.all([ctxA.close(), ctxB.close()]);
});

test('Zutaten sind Produkte: Umbenennen wirkt im Gericht, Löschen entfernt die Zutat', async ({ page }) => {
  await signUp(page, `meal-prod-${run}@example.com`);
  await page.getByLabel('Name').fill('Produkte');
  await page.getByRole('button', { name: 'Haushalt anlegen' }).click();
  for (const name of ['Milch', 'Mehl', 'Eier']) await addProduct(page, name, { toList: false });

  await page.getByRole('tab', { name: 'Essen' }).click();
  await page.getByRole('button', { name: 'Gericht hinzufügen' }).click();
  const sheet = page.locator('#sheet');
  await sheet.getByLabel('Name').fill('Pfannkuchen');
  await expect(sheet.locator('#m-ing-title')).toHaveText('Zutaten (0)');
  for (const name of ['Mehl', 'Eier', 'Milch']) await pickIngredient(sheet, name);
  // Bestehendes Produkt wird nicht doppelt angelegt: „milch“ + Return wählt Milch nur aus
  await sheet.getByPlaceholder(SEARCH).fill('milch');
  await expect(sheet.getByRole('button', { name: /als Produkt anlegen/ })).toHaveCount(0);
  await sheet.getByPlaceholder(SEARCH).press('Enter');
  await expect.poll(() => ingredientNames(sheet)).toEqual(['Mehl', 'Eier', 'Milch']);
  await sheet.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  const meal = page.locator('[data-testid=meal][data-name=Pfannkuchen]');
  await expect(meal).toContainText('3 Zutaten');

  // Produkt umbenennen → im Gericht sichtbar
  await page.getByRole('tab', { name: 'Produkte' }).click();
  await page.locator('[data-testid=product][data-name=Mehl] [data-action=edit-product]').click();
  await page.locator('#sheet').getByLabel('Name').fill('Weizenmehl');
  await page.locator('#sheet').getByRole('button', { name: 'Sichern' }).click();
  // Produkt löschen → Zutat verschwindet
  await page.locator('[data-testid=product][data-name=Eier] [data-action=edit-product]').click();
  await page.locator('#sheet').getByRole('button', { name: 'Produkt löschen' }).click();
  await page.locator('#confirm').getByRole('button', { name: 'Löschen' }).click();

  await page.getByRole('tab', { name: 'Essen' }).click();
  await expect(meal).toContainText('2 Zutaten');
  await meal.locator('.row-main').click();
  await expect.poll(() => ingredientNames(page.locator('#sheet'))).toEqual(['Weizenmehl', 'Milch']);
  await page.locator('#sheet [data-close]').click();

  // Nach Neuladen unverändert
  await page.reload();
  await page.locator('[data-testid=meal][data-name=Pfannkuchen] .row-main').click();
  await expect.poll(() => ingredientNames(page.locator('#sheet'))).toEqual(['Weizenmehl', 'Milch']);
});
