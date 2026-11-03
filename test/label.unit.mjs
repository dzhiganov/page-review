// Unit tests for element labels (role word + visible text) used in Copy for agent and review.md.
// Run: npm run test:unit
import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../extension/lib/label.js';

const { elementLabel, shortText, labelText } = globalThis.PageReviewLabel;

test('role word from the tag or the role attribute', () => {
  assert.equal(elementLabel({ tag: 'A', text: 'Pricing' }).role, 'Link');
  assert.equal(elementLabel({ tag: 'button', text: 'Buy' }).role, 'Button');
  assert.equal(elementLabel({ tag: 'div', role: 'button', text: 'Buy' }).role, 'Button');
  assert.equal(elementLabel({ tag: 'input', type: 'submit', value: 'Send' }).role, 'Button');
  assert.equal(elementLabel({ tag: 'h2', text: 'Plans' }).role, 'Heading');
  assert.equal(elementLabel({ tag: 'div', classes: ['card'], text: 'API Layer' }).role, 'Card');
  assert.equal(elementLabel({ tag: 'span', classes: ['btn', 'primary'], text: 'Start' }).role, 'Button', 'a styled span');
  assert.equal(elementLabel({ tag: 'div', classes: ['nav-button'], text: 'Menu' }).role, 'Button');
  assert.equal(elementLabel({ tag: 'span', classes: ['subtitle'], text: 'x' }).role, 'Element', 'not just any "bt"');
  assert.equal(elementLabel({ tag: 'section', text: 'x' }).role, 'Section');
  assert.equal(elementLabel({ tag: 'span', text: 'x' }).role, 'Element');
  assert.equal(elementLabel({}).role, 'Element');
});

test('long text is cut at a word boundary to about 60 characters', () => {
  const long = 'Analytics that small teams actually understand and use every single day of the week';
  const { text } = elementLabel({ tag: 'h1', text: long });
  assert.equal(text, 'Analytics that small teams actually understand and use every…');
  assert.ok(text.length <= 61);
  assert.equal(shortText('x'.repeat(80)), `${'x'.repeat(60)}…`, 'no space: a hard cut');
  assert.equal(shortText('Short enough'), 'Short enough');
});

test('nested whitespace collapses to single spaces', () => {
  assert.equal(elementLabel({ tag: 'div', text: '  Pro\n\n  $29\t / month \n' }).text, 'Pro $29 / month');
});

test('no text: the role word alone, without quotes', () => {
  const label = elementLabel({ tag: 'div', text: '  \n ' });
  assert.deepEqual(label, { role: 'Element', text: '' });
  assert.equal(labelText(label), 'Element');
});

test('inputs use their placeholder, then aria-label; never what was typed', () => {
  assert.deepEqual(elementLabel({ tag: 'input', type: 'email', placeholder: 'you@company.com', value: 'secret' }), { role: 'Input', text: 'you@company.com' });
  assert.equal(elementLabel({ tag: 'textarea', ariaLabel: 'Message' }).text, 'Message');
  assert.equal(elementLabel({ tag: 'input', value: 'typed' }).text, '');
});

test('images use their alt', () => {
  assert.deepEqual(elementLabel({ tag: 'img', alt: 'Team photo' }), { role: 'Image', text: 'Team photo' });
});

test('aria-label when there is no visible text', () => {
  assert.equal(labelText(elementLabel({ tag: 'button', text: '', ariaLabel: 'Close dialog' })), 'Button "Close dialog"');
  assert.equal(elementLabel({ tag: 'button', text: 'Save', ariaLabel: 'Save draft' }).text, 'Save', 'visible text wins');
});
