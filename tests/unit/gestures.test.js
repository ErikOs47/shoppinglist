import { describe, it, expect } from 'vitest';
import { swipeOffset, dropIndex, SWIPE_COMMIT } from '../../src/ui/gestures.js';

describe('Wischen mit Widerstand', () => {
  const width = 350;
  const commit = width * SWIPE_COMMIT; // 210 px Fingerweg

  it('Zeile folgt dem Finger nur gedämpft', () => {
    expect(swipeOffset(100, commit)).toBe(50);
  });
  it('nach der Schwelle kaum noch Bewegung', () => {
    const atCommit = swipeOffset(commit, commit);
    expect(swipeOffset(commit + 100, commit) - atCommit).toBeCloseTo(12);
  });
  it('Löschschwelle verlangt mehr als die halbe Zeilenbreite', () => {
    expect(commit).toBeGreaterThan(width / 2);
  });
});

describe('Zielposition beim Verschieben', () => {
  // vier Zeilen à 56 px, Mitten bei 28, 84, 140, 196
  const centers = [28, 84, 140, 196];
  it('kleine Bewegung: bleibt an Ort und Stelle', () => {
    expect(dropIndex(centers, 1, 84 + 20)).toBe(1);
  });
  it('nach unten über eine Mitte hinaus', () => {
    expect(dropIndex(centers, 0, 28 + 60)).toBe(1);
    expect(dropIndex(centers, 0, 400)).toBe(3);
  });
  it('nach oben an den Anfang', () => {
    expect(dropIndex(centers, 3, 0)).toBe(0);
  });
});
