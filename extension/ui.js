// Small DOM helpers shared by the reviews page modules.
const toastEl = document.getElementById('toast');
let toastTimer;

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

export function button(label, cls, onClick) {
  const b = h('button', cls ? { class: cls, type: 'button' } : { type: 'button' }, label);
  b.addEventListener('click', onClick);
  return b;
}

export function toast(message) {
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.hidden = false;
  toastTimer = setTimeout(() => (toastEl.hidden = true), 3000);
}

export function loadImage(src, crossOrigin) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load image`));
    img.src = src;
  });
}

export function saveFile(href, filename) {
  const a = h('a', { href, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
}
