import { describe, it, expect } from 'vitest';
import { swipeOffset, dropIndex, SWIPE_COMMIT, dayDropTarget } from '../../src/ui/gestures.js';

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

describe('Wochenplan: Zieltag beim Verschieben', () => {
  // Mo mit zwei Gerichten, Di leer, Mi mit einem Gericht (Seitenkoordinaten)
  const layout = [
    { day: 'mo', top: 0, rows: [{ id: 'a', top: 40, bottom: 100 }, { id: 'b', top: 100, bottom: 160 }] },
    { day: 'di', top: 190, rows: [] },
    { day: 'mi', top: 250, rows: [{ id: 'c', top: 290, bottom: 350 }] },
  ];
  it('innerhalb des Tages nach unten', () => {
    expect(dayDropTarget(layout, 150, 'a')).toEqual({ day: 'mo', index: 1 });
  });
  it('auf einen leeren Tag', () => {
    expect(dayDropTarget(layout, 210, 'a')).toEqual({ day: 'di', index: 0 });
  });
  it('vor bzw. hinter ein Gericht eines anderen Tages', () => {
    expect(dayDropTarget(layout, 300, 'a')).toEqual({ day: 'mi', index: 0 });
    expect(dayDropTarget(layout, 340, 'a')).toEqual({ day: 'mi', index: 1 });
  });
  it('Abstand über einem Tag gehört zum Tag darüber, oberhalb von allem zum ersten', () => {
    expect(dayDropTarget(layout, 175, 'a')).toEqual({ day: 'mo', index: 1 });
    expect(dayDropTarget(layout, -50, 'b')).toEqual({ day: 'mo', index: 0 });
  });
});
