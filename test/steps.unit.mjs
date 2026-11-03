// Unit tests for steps: numbering by creation order, renumbering after a delete, undo/redo,
// and how they are written to review.md. Run: npm run test:unit
import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../extension/lib/notes.js';

const { stepNumbers, nextStepNumber } = globalThis.PageReviewNotes;
const { toMarkdown } = await import('../extension/lib/format.js');

const step = (id, text = id) => ({ id, type: 'step', ax: 0, ay: 0, text });
const numbers = (shapes) => Object.fromEntries(stepNumbers(shapes));

test('the first step is 1, each new one the highest + 1; other shapes do not count', () => {
  const shapes = [];
  assert.equal(nextStepNumber(shapes), 1);
  shapes.push(step('a'), { id: 'n', type: 'text', text: 'a comment' }, { id: 'r', type: 'rect' });
  assert.equal(nextStepNumber(shapes), 2);
  shapes.push(step('b'), step('c'));
  assert.deepEqual(numbers(shapes), { a: 1, b: 2, c: 3 });
  assert.equal(nextStepNumber(shapes), 4);
});

test('numbers follow creation order, not position or text', () => {
  const shapes = [step('a', '3'), step('b', '1')];
  shapes[0].ax = 900; // moved to the right of b
  assert.deepEqual(numbers(shapes), { a: 1, b: 2 });
});

test('deleting a step renumbers the rest in order (1, 2, 4 -> 1, 2, 3)', () => {
  let shapes = [step('a'), step('b'), step('c'), step('d')];
  shapes = shapes.filter((s) => s.id !== 'c');
  assert.deepEqual(numbers(shapes), { a: 1, b: 2, d: 3 });
  assert.equal(nextStepNumber(shapes), 4);
});

test('undo and redo restore the numbers (the editor snapshots the shapes list)', () => {
  const history = [];
  const future = [];
  let shapes = [step('a'), step('b'), step('c')];
  history.push(JSON.stringify(shapes)); // pushHistory() before the delete
  shapes = shapes.filter((s) => s.id !== 'b');
  assert.deepEqual(numbers(shapes), { a: 1, c: 2 });
  future.push(JSON.stringify(shapes)); // undo
  shapes = JSON.parse(history.pop());
  assert.deepEqual(numbers(shapes), { a: 1, b: 2, c: 3 });
  history.push(JSON.stringify(shapes)); // redo
  shapes = JSON.parse(future.pop());
  assert.deepEqual(numbers(shapes), { a: 1, c: 2 });
  // Editing a step's text in place keeps its number.
  shapes[1].text = 'changed';
  assert.deepEqual(numbers(shapes), { a: 1, c: 2 });
});

test('review.md lists steps as their own ordered list, after the comments', () => {
  const md = toMarkdown({
    url: 'https://example.com/',
    title: 'Shop',
    createdAt: '2026-11-03T10:00:00Z',
    viewport: { width: 1280, height: 800, devicePixelRatio: 1 },
    scroll: { x: 0, y: 0 },
    comments: [{ n: 1, text: 'Too small', kind: 'text', marks: [], target: null }],
    steps: [
      { n: 1, kind: 'step', text: 'Open the menu', target: { selector: 'nav > button', text: 'Menu' } },
      { n: 2, kind: 'step', text: 'Pick a plan', target: null },
    ],
  });
  const steps = md.slice(md.indexOf('## Steps (2)'));
  assert.ok(md.indexOf('## Comments') < md.indexOf('## Steps'));
  assert.match(steps, /^1\. Open the menu\n {3}- \*\*Target:\*\* `nav > button` "Menu"$/m);
  assert.match(steps, /^2\. Pick a plan\n {3}- \*\*Target:\*\* none found$/m);
  assert.doesNotMatch(toMarkdown({ url: 'u', createdAt: '2026-11-03T10:00:00Z', viewport: { width: 1, height: 1, devicePixelRatio: 1 }, scroll: { x: 0, y: 0 }, comments: [] }), /## Steps/, 'no section without steps');
});
