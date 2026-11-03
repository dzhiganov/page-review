// Unit tests for comment fonts, including comments saved before fonts existed. Run: npm run test:unit
import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../extension/lib/notes.js';

const { DEFAULT_FONT, normalizeFont, stepSize, noteCss } = globalThis.PageReviewNotes;

// A comment as saved before fonts existed (v0.5.0).
const oldNote = { id: 'n1', type: 'text', ax: 570, ay: 530, text: 'Make font bigger', x: 570, y: 498, w: 190, h: 32 };

test('comments saved before fonts existed render with the default font', () => {
  assert.deepEqual(normalizeFont(oldNote.font), DEFAULT_FONT);
  assert.deepEqual(noteCss(oldNote.font), noteCss(DEFAULT_FONT));
});

test('a saved font round-trips through JSON', () => {
  const font = { family: 'serif', size: 20, weight: 700, color: '#1971c2' };
  const stored = JSON.parse(JSON.stringify({ ...oldNote, font }));
  assert.deepEqual(normalizeFont(stored.font), font);
});

test('junk or partial fonts are repaired', () => {
  assert.deepEqual(normalizeFont({ family: 'comic', size: 'big', weight: 'heavy', color: 'red' }), DEFAULT_FONT);
  assert.deepEqual(normalizeFont({ size: 19 }), { ...DEFAULT_FONT, size: 20 });
  assert.deepEqual(normalizeFont({ weight: 600, color: '#ABCDEF' }), { ...DEFAULT_FONT, weight: 700, color: '#abcdef' });
  assert.deepEqual(normalizeFont(null), DEFAULT_FONT);
});

test('size steps stay within range', () => {
  assert.equal(stepSize(14, 1), 16);
  assert.equal(stepSize(14, -1), 12);
  assert.equal(stepSize(12, -1), 12);
  assert.equal(stepSize(32, 1), 32);
});

test('every palette colour is a valid comment colour (grey included)', () => {
  for (const color of ['#e03131', '#f08c00', '#1971c2', '#2f9e44', '#868e96', '#1e1e1e']) {
    assert.equal(normalizeFont({ color }).color, color);
  }
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
