// Unit tests for comment fonts and migrating comments saved by older versions. Run: npm run test:unit
import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../extension/lib/notes.js';

const { DEFAULT_FONT, normalizeFont, stepSize, noteCss, migrateShape } = globalThis.PageReviewNotes;

// A comment as saved before fonts existed (v0.5.0).
const oldNote = { id: 'n1', type: 'text', ax: 570, ay: 530, text: 'Make font bigger', x: 570, y: 498, w: 190, h: 32 };

test('comments saved before fonts existed get the default font', () => {
  const s = migrateShape(oldNote);
  assert.deepEqual(s.font, DEFAULT_FONT);
  assert.equal(s.text, 'Make font bigger');
  assert.deepEqual({ ...s, font: undefined }, { ...oldNote, font: undefined }, 'nothing else changes');
  assert.equal(oldNote.font, undefined, 'input not mutated');
});

test('drawings pass through untouched', () => {
  const arrow = { id: 'a', type: 'arrow', color: '#e03131', x1: 1, y1: 2, x2: 3, y2: 4 };
  assert.equal(migrateShape(arrow), arrow);
});

test('a saved font round-trips through JSON', () => {
  const font = { family: 'serif', size: 20, weight: 700, color: '#1971c2' };
  const s = migrateShape(JSON.parse(JSON.stringify({ ...oldNote, font })));
  assert.deepEqual(s.font, font);
});

test('junk or partial fonts are repaired', () => {
  assert.deepEqual(normalizeFont({ family: 'comic', size: 'big', weight: 'heavy', color: 'red' }), DEFAULT_FONT);
  assert.deepEqual(normalizeFont({ size: 19 }), { ...DEFAULT_FONT, size: 20 });
  assert.deepEqual(normalizeFont({ weight: 600, color: '#ABCDEF' }), { ...DEFAULT_FONT, weight: 700, color: '#abcdef' });
  assert.deepEqual(normalizeFont(null), DEFAULT_FONT);
});

test('a comment with no text field gets an empty string', () => {
  assert.equal(migrateShape({ id: 'x', type: 'text', ax: 0, ay: 0 }).text, '');
});

test('size steps stay within range', () => {
  assert.equal(stepSize(14, 1), 16);
  assert.equal(stepSize(14, -1), 12);
  assert.equal(stepSize(12, -1), 12);
  assert.equal(stepSize(32, 1), 32);
});

test('noteCss maps the font to CSS', () => {
  const css = noteCss({ family: 'mono', size: 20, weight: 700, color: '#2f9e44' });
  assert.match(css.fontFamily, /monospace/);
  assert.equal(css.fontSize, '20px');
  assert.equal(css.lineHeight, '29px');
  assert.equal(css.fontWeight, '700');
  assert.equal(css.color, '#2f9e44');
  assert.equal(noteCss(undefined).fontSize, '14px');
});
