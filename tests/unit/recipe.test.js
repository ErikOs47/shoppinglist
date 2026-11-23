import { describe, it, expect } from 'vitest';
import { ingredientName, recipeFromJsonLd, decodeEntities } from '../../src/core/recipe.js';

// Die Beispieldaten sind nach dem schema.org/Recipe-Format nachgebaut, nicht
// von echten Seiten kopiert (Rezeptseiten waren aus der Testumgebung nicht
// erreichbar).

describe('ingredientName: Menge entfernen', () => {
  const cases = [
    // Deutsch (Schreibweisen wie auf deutschen Rezeptseiten üblich)
    ['500 g Hackfleisch, gemischt', 'Hackfleisch'],
    ['500g Mehl', 'Mehl'],
    ['1 Zwiebel(n)', 'Zwiebel'],
    ['2 Ei(er)', 'Ei'],
    ['1 EL Tomatenmark', 'Tomatenmark'],
    ['2 TL Zucker', 'Zucker'],
    ['1 Dose Tomaten, gehackt (400 g)', 'Tomaten'],
    ['1 Pck. Backpulver', 'Backpulver'],
    ['200 ml Sahne', 'Sahne'],
    ['1,5 kg Kartoffeln, festkochend', 'Kartoffeln'],
    ['2-3 Zehen Knoblauch', 'Knoblauch'],
    ['ca. 100 g Parmesan', 'Parmesan'],
    ['½ Bund Petersilie', 'Petersilie'],
    ['1 Prise Salz', 'Salz'],
    ['Salz und Pfeffer', 'Salz und Pfeffer'],
    ['Pfeffer, schwarz, aus der Mühle', 'Pfeffer'],
    ['etwas Öl', 'Öl'],
    ['Muskat nach Belieben', 'Muskat'],
    ['Mehl (Type 405)', 'Mehl'],
    ['Lachsfilet', 'Lachsfilet'],
    ['Glasnudeln', 'Glasnudeln'],
    // Englisch
    ['2 cups all-purpose flour', 'All-purpose flour'],
    ['1/2 tsp salt', 'Salt'],
    ['1 1/2 cups milk', 'Milk'],
    ['1 (14 oz) can diced tomatoes', 'Diced tomatoes'],
    ['3 cloves garlic, minced', 'Garlic'],
    ['1 large onion, chopped', 'Onion'],
    ['Salt to taste', 'Salt'],
    // Portugiesisch
    ['200 g de farinha', 'Farinha'],
    ['2 colheres de sopa de azeite', 'Azeite'],
    ['1 dente de alho', 'Alho'],
    ['sal q.b.', 'Sal'],
    ['500 g de bacalhau demolhado', 'Bacalhau demolhado'],
  ];
  for (const [input, expected] of cases) {
    it(`${input} → ${expected}`, () => expect(ingredientName(input)).toBe(expected));
  }
  it('HTML-Entitäten und Tags werden aufgelöst', () => {
    expect(ingredientName('&frac12; TL Salz')).toBe('Salz');
    expect(ingredientName('<b>2</b> Eier')).toBe('Eier');
    expect(decodeEntities('M&amp;M&#39;s &#x2013; x')).toBe("M&M's – x");
  });
  it('reine Mengenangabe ergibt leeren Namen', () => {
    expect(ingredientName('200 g')).toBe('');
  });
});

describe('recipeFromJsonLd', () => {
  const recipe = {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: 'Spaghetti Bolognese',
    recipeIngredient: ['500 g Hackfleisch', '1 Zwiebel(n)', '400 g Spaghetti', '1 Zwiebel, rot'],
  };

  it('Rezept als einzelnes Objekt', () => {
    const r = recipeFromJsonLd([JSON.stringify(recipe)]);
    expect(r.name).toBe('Spaghetti Bolognese');
    // doppelte „Zwiebel“ nur einmal
    expect(r.ingredients).toEqual(['Hackfleisch', 'Zwiebel', 'Spaghetti']);
    expect(r.raw).toHaveLength(4);
  });

  it('Rezept in @graph neben anderen Objekten (WordPress-Seiten)', () => {
    const page = { '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage', name: 'x' }, { ...recipe, '@type': ['Recipe', 'NewsArticle'] }] };
    expect(recipeFromJsonLd([JSON.stringify(page)]).name).toBe('Spaghetti Bolognese');
  });

  it('Rezept in einem Array, kaputte Blöcke werden übersprungen', () => {
    const blocks = ['{kaputt', JSON.stringify({ '@type': 'Organization', name: 'Seite' }), JSON.stringify([{ '@type': 'BreadcrumbList' }, recipe])];
    expect(recipeFromJsonLd(blocks).ingredients).toContain('Hackfleisch');
  });

  it('ältere Eigenschaft „ingredients“ und Entitäten im Namen', () => {
    const r = recipeFromJsonLd([JSON.stringify({ '@type': 'Recipe', name: 'Mac &amp; Cheese', ingredients: ['2 cups macaroni'] })]);
    expect(r).toEqual({ name: 'Mac & Cheese', ingredients: ['Macaroni'], raw: ['2 cups macaroni'] });
  });

  it('keine Rezeptdaten → null', () => {
    expect(recipeFromJsonLd([JSON.stringify({ '@type': 'WebPage' })])).toBeNull();
    expect(recipeFromJsonLd([])).toBeNull();
  });
});
