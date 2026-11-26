// Verschieben, Wischen zum Löschen, Favoriten und Vorschläge – mit zwei
// Personen, damit auch der Abgleich in Echtzeit geprüft ist.

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

async function addProduct(page, name) {
  await page.getByRole('tab', { name: 'Produkte' }).click();
  await page.getByRole('button', { name: 'Produkt hinzufügen' }).click();
  await page.locator('#sheet').getByLabel('Name').fill(name);
  await page.locator('#sheet').getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(page.locator('#sheet')).not.toBeVisible();
}

const order = (page) =>
  page.locator('[data-testid=open-list] [data-testid=item]').evaluateAll((els) => els.map((e) => e.dataset.name));
const item = (page, name) => page.locator(`[data-testid=item][data-name="${name}"]`);
const product = (page, name) => page.locator(`[data-testid=product][data-name="${name}"]`);

/**
 * Waagerecht von rechts nach links wischen. `fraction`: Strecke als Anteil der
 * Zeilenbreite, `start`: Ansatzpunkt (0.95 liegt auf dem Verschiebe-Griff).
 */
async function swipeLeft(page, row, fraction, start = 0.95) {
  const box = await row.boundingBox();
  const y = box.y + box.height / 2;
  const x0 = box.x + box.width * start;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i++) await page.mouse.move(x0 - (box.width * fraction * i) / steps, y);
  await page.mouse.up();
}

test('Verschieben, Wischen, Favoriten und Vorschläge mit zwei Personen', async ({ browser }) => {
  test.setTimeout(120_000);
  const [ctxA, ctxB] = await Promise.all([browser.newContext(), browser.newContext()]);
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const errors = [];
  for (const p of [a, b]) p.on('pageerror', (e) => errors.push(e.message));

  await signUp(a, `feat-a-${run}@example.com`);
  await a.getByLabel('Name').fill('Zuhause');
  await a.getByRole('button', { name: 'Haushalt anlegen' }).click();
  await a.getByRole('button', { name: 'Einstellungen' }).click();
  const code = (await a.getByTestId('invite-code').textContent()).trim();
  await a.locator('#sheet').getByRole('button', { name: 'Fertig' }).click();
  await signUp(b, `feat-b-${run}@example.com`);
  await b.getByLabel('Code').fill(code);
  await b.getByRole('button', { name: 'Beitreten' }).click();
  await expect(b.getByTestId('sync')).toHaveText('Live');

  for (const n of ['Milch', 'Brot', 'Eier', 'Kaffee']) await addProduct(a, n);

  // --- Zettel ohne Kategorien, neue Artikel hinten --------------------------
  await a.getByRole('tab', { name: 'Einkaufszettel' }).click();
  await b.getByRole('tab', { name: 'Einkaufszettel' }).click();
  await expect.poll(() => order(a)).toEqual(['Milch', 'Brot', 'Eier', 'Kaffee']);
  await expect(a.locator('main h2', { hasText: /Sonstiges/i })).toHaveCount(0);
  await expect.poll(() => order(b)).toEqual(['Milch', 'Brot', 'Eier', 'Kaffee']);

  // --- Verschieben: Kaffee per Griff an den Anfang --------------------------
  const handle = item(a, 'Kaffee').getByRole('button', { name: 'Kaffee verschieben' });
  const hb = await handle.boundingBox();
  const first = await item(a, 'Milch').boundingBox();
  await a.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await a.mouse.down();
  for (let i = 1; i <= 15; i++) {
    await a.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 - ((hb.y - first.y + 10) * i) / 15);
  }
  await a.mouse.up();
  await expect.poll(() => order(a)).toEqual(['Kaffee', 'Milch', 'Brot', 'Eier']);
  await expect.poll(() => order(b)).toEqual(['Kaffee', 'Milch', 'Brot', 'Eier']); // Echtzeit
  await a.reload();
  await expect.poll(() => order(a)).toEqual(['Kaffee', 'Milch', 'Brot', 'Eier']); // gespeichert

  // --- Wischen mit Widerstand: kurzer Zug löscht nicht ----------------------
  await swipeLeft(b, item(b, 'Eier'), 0.35, 0.6); // auf dem Namen angesetzt
  await b.waitForTimeout(500);
  await expect(item(b, 'Eier')).toBeVisible();
  await expect(item(b, 'Eier')).toHaveAttribute('data-checked', 'false'); // kein versehentliches Abhaken

  // --- langer Zug entfernt vom Zettel, Produkt bleibt -----------------------
  await swipeLeft(b, item(b, 'Eier'), 0.8, 0.95); // auf dem Griff angesetzt
  await expect(item(b, 'Eier')).toHaveCount(0);
  await expect(item(a, 'Eier')).toHaveCount(0);
  await a.getByRole('tab', { name: 'Produkte' }).click();
  await expect(product(a, 'Eier')).toBeVisible();

  // --- Favorit: A markiert Milch, B sieht es, Filter ------------------------
  await product(a, 'Milch').getByRole('button', { name: 'Milch als Favorit markieren' }).click();
  await b.getByRole('tab', { name: 'Produkte' }).click();
  await expect(product(b, 'Milch').locator('.star-btn')).toHaveClass(/is-fav/);
  await b.getByRole('tab', { name: 'Favoriten' }).click();
  await expect(b.locator('[data-testid=product]')).toHaveCount(1);
  await expect(product(b, 'Milch')).toBeVisible();
  await b.getByRole('tab', { name: 'Alle' }).click();
  await expect(b.locator('[data-testid=product]')).toHaveCount(4);

  // --- Wischen im Produkt-Tab löscht das Produkt für beide ------------------
  await swipeLeft(b, product(b, 'Eier'), 0.8, 0.7);
  await expect(product(b, 'Eier')).toHaveCount(0);
  await expect(product(a, 'Eier')).toHaveCount(0);

  // --- Vorschläge nach dem Einkauf ------------------------------------------
  await a.getByRole('tab', { name: 'Einkaufszettel' }).click();
  await b.getByRole('tab', { name: 'Einkaufszettel' }).click();
  await expect(a.getByTestId('suggestion')).toHaveCount(0); // noch keine Kaufhistorie
  await item(a, 'Kaffee').getByRole('checkbox').click();
  await item(a, 'Brot').getByRole('checkbox').click();
  await a.getByTestId('finish').click();
  await a.locator('#sheet').getByRole('button', { name: 'Abschließen' }).click();
  await expect.poll(() => order(a)).toEqual(['Milch']);
  for (const p of [a, b]) {
    // gleich oft und im selben Einkauf gekauft → alphabetisch
    await expect(p.getByTestId('suggestion')).toHaveText([/Brot/, /Kaffee/], {
      timeout: 15_000,
    });
  }
  await b.getByRole('button', { name: 'Kaffee auf den Zettel' }).click();
  await expect.poll(() => order(a)).toEqual(['Milch', 'Kaffee']); // hinten angefügt
  await expect(a.getByTestId('suggestion')).toHaveText([/Brot/]);

  expect(errors).toEqual([]);
  await Promise.all([ctxA.close(), ctxB.close()]);
});
