import { describe, it, expect } from 'vitest';
import { ingredientName, ingredientsFromText, decodeEntities } from '../../src/core/recipe.js';

// Schreibweisen wie in Rezepten und Chat-Antworten üblich (nachgebaut, nicht
// aus einer echten ChatGPT-Antwort kopiert).

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

describe('ingredientsFromText: eingefügter Text', () => {
  it('Antwort im Stil eines Chat-Assistenten mit Überschriften und Zubereitung', () => {
    const text = `Hier ist ein einfaches Rezept für Spaghetti Bolognese (4 Portionen):

**Zutaten:**
- 500 g Hackfleisch (gemischt)
- 1 Zwiebel, fein gehackt
- 2 Knoblauchzehen
- 1 Dose gehackte Tomaten (400 g)
- 2 EL Tomatenmark
- Salz und Pfeffer nach Geschmack

**Für das Topping:**
* 50 g Parmesan, gerieben

### Zubereitung
1. Zwiebel und Knoblauch anbraten.
2. Hackfleisch dazugeben und krümelig braten.`;
    expect(ingredientsFromText(text)).toEqual([
      'Hackfleisch',
      'Zwiebel',
      'Knoblauchzehen',
      'Gehackte Tomaten',
      'Tomatenmark',
      'Salz und Pfeffer',
      'Parmesan',
    ]);
  });

  it('nummerierte Liste, Kästchen, Aufzählungszeichen, Windows-Zeilenenden', () => {
    expect(ingredientsFromText('1. 200 g Mehl\r\n2) 3 Eier\r\n• Milch\r\n- [ ] 1 Prise Salz\r\n☐ Butter')).toEqual([
      'Mehl',
      'Eier',
      'Milch',
      'Salz',
      'Butter',
    ]);
  });

  it('englisch und portugiesisch, Abbruch bei „Instructions“ / „Modo de preparação“', () => {
    expect(ingredientsFromText('Ingredients:\n- 2 cups flour\n- 1 tsp salt\nInstructions:\n1. Mix everything')).toEqual(['Flour', 'Salt']);
    expect(ingredientsFromText('Ingredientes:\n- 500 g de bacalhau\n- 2 dentes de alho\nModo de preparação:\n1. Cozer')).toEqual(['Bacalhau', 'Alho']);
  });

  it('doppelte Zutaten nur einmal, leere Zeilen und reine Mengen ignoriert', () => {
    expect(ingredientsFromText('Zwiebel\n\n1 Zwiebel(n)\n200 g\n  ')).toEqual(['Zwiebel']);
  });

  it('lange Sätze werden übersprungen, leerer Text ergibt nichts', () => {
    const satz = 'Dieses Gericht schmeckt am besten, wenn man es am Vortag zubereitet und über Nacht ziehen lässt';
    expect(ingredientsFromText(`${satz}\n- Reis`)).toEqual(['Reis']);
    expect(ingredientsFromText('')).toEqual([]);
    expect(ingredientsFromText(undefined)).toEqual([]);
  });

  it('eine einzelne Zeile ohne Zeilenumbruch', () => {
    expect(ingredientsFromText('3 Karotten')).toEqual(['Karotten']);
  });
});
