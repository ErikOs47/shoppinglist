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

async function addIngredient(sheet, name) {
  await sheet.getByPlaceholder('Zutat hinzufügen').fill(name);
  await sheet.getByPlaceholder('Zutat hinzufügen').press('Enter');
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
  // Return im Namensfeld springt zu den Zutaten, statt zu speichern
  await sheet.getByLabel('Name').press('Enter');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByPlaceholder('Zutat hinzufügen')).toBeFocused();
  await addIngredient(sheet, 'Hackfleisch');
  await addIngredient(sheet, 'spaghetti'); // Schreibweise egal
  await addIngredient(sheet, 'Zwiebel');
  await addIngredient(sheet, 'hackfleisch'); // doppelt → ignoriert
  await addIngredient(sheet, 'Tomaten');
  await expect.poll(() => ingredientNames(sheet)).toEqual(['Hackfleisch', 'spaghetti', 'Zwiebel', 'Tomaten']);
  await sheet.getByRole('button', { name: 'Zwiebel entfernen' }).click();
  await addIngredient(sheet, 'Zwiebel');
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
  await expect(row('Hackfleisch')).toContainText('neues Produkt');
  await expect(row('Spaghetti')).not.toContainText('neues Produkt'); // vorhandenes Produkt erkannt
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

test('Zutaten aus eingefügtem Text (z. B. aus ChatGPT kopiert)', async ({ page }) => {
  await signUp(page, `meal-paste-${run}@example.com`);
  await page.getByLabel('Name').fill('Einfügen');
  await page.getByRole('button', { name: 'Haushalt anlegen' }).click();
  await page.getByRole('tab', { name: 'Essen' }).click();
  await page.getByRole('button', { name: 'Gericht hinzufügen' }).click();
  const sheet = page.locator('#sheet');
  await sheet.getByLabel('Name').fill('Linsensuppe');
  await addIngredient(sheet, 'Linsen'); // schon von Hand eingetragen

  // Kein Link-Import mehr
  await expect(sheet.getByRole('button', { name: /aus Link laden/ })).toHaveCount(0);

  await sheet.getByRole('button', { name: 'Zutaten aus Text einfügen' }).click();
  const area = sheet.getByRole('textbox', { name: 'Zutaten aus Text einfügen' });
  await expect(area).toBeFocused();

  // Nur Überschriften: nichts erkannt, Meldung
  await area.fill('Zutaten:\n');
  await sheet.getByRole('button', { name: 'Zutaten übernehmen' }).click();
  await expect(sheet.locator('#m-error')).toHaveText('Im Text wurden keine Zutaten erkannt. Eine Zutat pro Zeile einfügen.');

  await area.fill(`Hier ist ein Rezept für Linsensuppe (4 Portionen):

**Zutaten:**
- 250 g rote Linsen
- 1 Zwiebel, gewürfelt
- 2 Karotten
- 1 l Gemüsebrühe
- Salz und Pfeffer nach Geschmack

**Zubereitung:**
1. Zwiebel andünsten.
2. Alles 20 Minuten köcheln.`);
  await sheet.getByRole('button', { name: 'Zutaten übernehmen' }).click();
  await expect(page.locator('#toast')).toContainText('5 Zutaten übernommen');
  await expect(area).toBeHidden();
  await expect.poll(() => ingredientNames(sheet)).toEqual([
    'Linsen',
    'Rote Linsen',
    'Zwiebel',
    'Karotten',
    'Gemüsebrühe',
    'Salz und Pfeffer',
  ]);
  // einzelne falsch erkannte Zutat lässt sich entfernen
  await sheet.getByRole('button', { name: 'Rote Linsen entfernen' }).click();

  await sheet.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  await page.getByRole('tab', { name: 'Gerichte' }).click();
  await expect(page.locator('[data-testid=meal][data-name=Linsensuppe]')).toContainText('5 Zutaten');

  // Nach Neuladen ist alles gespeichert
  await page.reload();
  await page.locator('[data-testid=meal][data-name=Linsensuppe] .row-main').click();
  await expect.poll(() => ingredientNames(page.locator('#sheet'))).toEqual(['Linsen', 'Zwiebel', 'Karotten', 'Gemüsebrühe', 'Salz und Pfeffer']);
});
