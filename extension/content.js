// Review overlay. Injected on demand by background.js; a second injection toggles it.
(() => {
  if (window.__pageReview) {
    window.__pageReview.toggle();
    return;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const COLORS = ['#e03131', '#f08c00', '#1971c2', '#2f9e44', '#1e1e1e'];
  // How far a comment card may be from a mark to count as that mark's comment.
  const ARROW_ATTACH_PX = 160;
  const BOX_ATTACH_PX = 80;
  // A comment written right after a mark is almost always about that mark.
  const PREVIOUS_ATTACH_PX = 240;
  const NOTE_MAX_W = 280;
  const EDGE_PX = 12;
  const HISTORY_LIMIT = 100;

  const ICONS = {
    grip: '<circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/>',
    select: '<path d="M5 3l6.5 17 2.4-7.1L21 10.5Z"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    arrow: '<path d="M5 19 19 5"/><path d="M9 5h10v10"/>',
    rect: '<rect x="4" y="5" width="16" height="14" rx="2"/>',
    text: '<path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 20.5l1.6-5.4A8.4 8.4 0 1 1 21 11.5Z"/>',
    eraser: '<path d="m7 20-4-4 10-10 7 7-7 7Z"/><path d="M7 20h13"/><path d="m8 11 6 6"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    clear: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m6 6 1 14h10l1-14"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
  };

  // Shortcuts use physical keys (e.code), so they also work with non-Latin layouts.
  const TOOLS = [
    { id: 'select', code: 'KeyV', title: 'Select & move (V)' },
    { id: 'pen', code: 'KeyP', title: 'Pen (P)' },
    { id: 'arrow', code: 'KeyA', title: 'Arrow (A)' },
    { id: 'rect', code: 'KeyR', title: 'Box (R)' },
    { id: 'text', code: 'KeyT', title: 'Comment (T)' },
    { id: 'eraser', code: 'KeyE', title: 'Eraser (E)' },
  ];

  const STYLES = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .stage { position: fixed; inset: 0; cursor: crosshair; touch-action: none; }
    :host([data-tool="select"]) .stage { cursor: default; }
    :host([data-tool="text"]) .stage { cursor: text; }
    :host([data-tool="eraser"]) .stage { cursor: cell; }
    .canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
    :host([data-tool="select"]) .canvas [data-id] { cursor: move; }
    .notes { position: absolute; inset: 0; pointer-events: none; }
    .frame { position: fixed; inset: 0; border: 3px solid #7048e8; pointer-events: none; }

    .note-card {
      position: absolute; pointer-events: auto; display: flex; align-items: flex-start; gap: 8px;
      max-width: ${NOTE_MAX_W}px; padding: 6px 14px 6px 6px; background: #fff; color: #1e1e1e;
      border-radius: 20px 20px 20px 4px; user-select: none; cursor: grab;
      box-shadow: 0 0 0 1px rgba(0,0,0,.06), 0 2px 6px rgba(0,0,0,.08), 0 10px 28px rgba(0,0,0,.18);
      font: 14px/20px Inter, "Segoe UI", system-ui, -apple-system, sans-serif; letter-spacing: -0.005em;
    }
    .note-card.flip-x { border-radius: 20px 20px 4px 20px; }
    .note-card.flip-y { border-radius: 4px 20px 20px 20px; }
    .note-card.flip-x.flip-y { border-radius: 20px 4px 20px 20px; }
    :host([data-tool="text"]) .note-card { cursor: text; }
    :host([data-tool="eraser"]) .note-card { cursor: cell; }
    .note-card.selected { box-shadow: 0 0 0 2px #7048e8, 0 10px 28px rgba(0,0,0,.2); }
    .note-card.editing { cursor: default; box-shadow: 0 0 0 1.5px #18181b, 0 10px 28px rgba(0,0,0,.2); }
    .note-card .avatar {
      flex: none; width: 28px; height: 28px; border-radius: 50%; background: #18181b; color: #fff;
      display: grid; place-items: center; font: 700 13px/1 Inter, "Segoe UI", system-ui, sans-serif;
      box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.35);
    }
    .note-card .avatar svg { width: 15px; height: 15px; fill: none; stroke: #fff; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
    .note-card .text { padding: 4px 0; max-width: ${NOTE_MAX_W - 54}px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .note-card textarea {
      all: unset; display: block; padding: 4px 0; min-width: 180px; max-width: ${NOTE_MAX_W - 54}px;
      field-sizing: content; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; color: inherit; cursor: text;
    }
    .note-card textarea::placeholder { color: #8a8a93; }

    .toolbar {
      position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
      display: flex; align-items: center; gap: 2px; padding: 6px;
      background: #1f1f24; color: #eee; border-radius: 12px;
      box-shadow: 0 8px 28px rgba(0,0,0,.28); font: 13px/1 system-ui, sans-serif; user-select: none;
    }
    .toolbar button {
      all: unset; box-sizing: border-box; height: 32px; min-width: 32px; padding: 0 7px;
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      border-radius: 8px; cursor: pointer; color: inherit;
    }
    .toolbar button:hover { background: rgba(255,255,255,.12); }
    .toolbar button:disabled { opacity: .35; cursor: default; background: none; }
    .toolbar button[aria-pressed="true"] { background: #5f3dc4; }
    .toolbar button.save { background: #7048e8; font-weight: 600; padding: 0 12px; margin-left: 2px; }
    .toolbar button.save:hover { background: #845ef7; }
    .toolbar svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .toolbar .grip { cursor: grab; min-width: 20px; padding: 0; opacity: .6; }
    .toolbar .grip svg { fill: currentColor; stroke: none; }
    .sep { width: 1px; height: 20px; background: rgba(255,255,255,.18); margin: 0 4px; }
    .swatch { width: 18px; height: 18px; border-radius: 50%; display: block; box-shadow: inset 0 0 0 1px rgba(255,255,255,.35); }
    .toolbar button.color { min-width: 26px; padding: 0; }
    .toolbar button.color[aria-pressed="true"] { background: none; box-shadow: inset 0 0 0 2px #fff; }

    .hint { position: fixed; border: 2px dashed #1971c2; background: rgba(25,113,194,.08); pointer-events: none; transition: opacity .4s; }
    .hint span {
      position: absolute; top: -22px; left: -2px; max-width: 60vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      background: #1971c2; color: #fff; font: 11px/1 ui-monospace, monospace; padding: 4px 6px; border-radius: 4px;
    }
    .toast {
      position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
      display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 10px;
      background: #1f1f24; color: #eee; font: 13px/1.3 system-ui, sans-serif; box-shadow: 0 8px 28px rgba(0,0,0,.28);
    }
    .toast[hidden] { display: none; }
    .toast button { all: unset; cursor: pointer; color: #b197fc; font-weight: 600; }
    :host(.capturing) .toolbar, :host(.capturing) .hints, :host(.capturing) .selection,
    :host(.capturing) .toast, :host(.capturing) .frame { display: none !important; }
  `;

  const state = {
    open: false,
    tool: 'arrow',
    color: COLORS[0],
    shapes: [],
    history: [], // JSON snapshots of `shapes` before each change
    future: [], // snapshots undone, for redo
    selected: null, // shape id
    drawing: null,
    drag: null,
    erasing: false,
    textInput: null,
    skipClick: false,
    dirty: false,
    saving: false,
  };
  const nodes = new Map(); // shape id -> <g> (drawings) or .note-card (comments)
  let host, shadow, stage, svg, shapesLayer, selectionLayer, badgeLayer, notesLayer, hintsEl, toolbar, toastEl, toastTimer;

  // ---------- lifecycle ----------

  function open() {
    host = document.createElement('page-review-overlay');
    host.style.cssText =
      'all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; display: block !important;';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${STYLES}</style>
      <div class="stage">
        <svg class="canvas" xmlns="${SVG_NS}"><g class="shapes"></g><g class="selection"></g><g class="badges"></g></svg>
        <div class="notes"></div>
      </div>
      <div class="frame"></div>
      <div class="hints"></div>
      <div class="toolbar" role="toolbar"></div>
      <div class="toast" hidden></div>
    `;
    stage = shadow.querySelector('.stage');
    svg = shadow.querySelector('.canvas');
    shapesLayer = shadow.querySelector('.shapes');
    selectionLayer = shadow.querySelector('.selection');
    badgeLayer = shadow.querySelector('.badges');
    notesLayer = shadow.querySelector('.notes');
    hintsEl = shadow.querySelector('.hints');
    toolbar = shadow.querySelector('.toolbar');
    toastEl = shadow.querySelector('.toast');
    buildToolbar();

    stage.addEventListener('pointerdown', onPointerDown);
    stage.addEventListener('pointermove', onPointerMove);
    stage.addEventListener('pointerup', onPointerUp);
    stage.addEventListener('click', onStageClick);
    stage.addEventListener('dblclick', onStageDblClick);
    // Drawings are tied to the viewport, so the page must not scroll under them.
    host.addEventListener('wheel', preventDefault, { passive: false });
    host.addEventListener('touchmove', preventDefault, { passive: false });
    window.addEventListener('keydown', onKeyDown, true);

    Object.assign(state, { open: true, shapes: [], history: [], future: [], selected: null, dirty: false });
    nodes.clear();
    document.documentElement.appendChild(host);
    setTool(state.tool);
    updateHistoryButtons();
    toast('Draw, add comments (T), move things (V). Ctrl+S saves, Esc exits.');
  }

  function close() {
    if (state.dirty && !confirm('Discard unsaved annotations?')) return;
    window.removeEventListener('keydown', onKeyDown, true);
    host.remove();
    state.open = false;
    state.textInput = null;
  }

  function toggle() {
    if (state.open) close();
    else open();
  }

  // ---------- toolbar ----------

  function icon(name) {
    return `<svg viewBox="0 0 24 24">${ICONS[name]}</svg>`;
  }

  function buildToolbar() {
    const parts = [`<button class="grip" title="Drag to move">${icon('grip')}</button>`];
    for (const t of TOOLS) {
      parts.push(`<button data-tool="${t.id}" title="${t.title}">${icon(t.id)}</button>`);
    }
    parts.push('<span class="sep"></span>');
    COLORS.forEach((c, i) => {
      parts.push(
        `<button class="color" data-color="${c}" title="Color (${i + 1})"><span class="swatch" style="background:${c}"></span></button>`,
      );
    });
    parts.push('<span class="sep"></span>');
    parts.push(`<button data-action="undo" title="Undo (Ctrl/Cmd+Z)">${icon('undo')}</button>`);
    parts.push(`<button data-action="redo" title="Redo (Ctrl/Cmd+Shift+Z)">${icon('redo')}</button>`);
    parts.push(`<button data-action="clear" title="Clear all">${icon('clear')}</button>`);
    parts.push(`<button data-action="reviews" title="Open saved reviews">${icon('folder')}</button>`);
    parts.push('<button data-action="save" class="save" title="Save (Ctrl/Cmd+S)">Save</button>');
    parts.push(`<button data-action="close" title="Exit (Esc)">${icon('close')}</button>`);
    toolbar.innerHTML = parts.join('');

    toolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const action = btn.dataset.action;
      if (btn.dataset.tool) setTool(btn.dataset.tool);
      else if (btn.dataset.color) setColor(btn.dataset.color);
      else if (action === 'undo') undo();
      else if (action === 'redo') redo();
      else if (action === 'clear') clearAll();
      else if (action === 'reviews') chrome.runtime.sendMessage({ type: 'open-reviews' });
      else if (action === 'save') save();
      else if (action === 'close') close();
    });
    enableToolbarDrag(toolbar.querySelector('.grip'));
    setColor(state.color);
  }

  function enableToolbarDrag(grip) {
    grip.addEventListener('pointerdown', (e) => {
      const rect = toolbar.getBoundingClientRect();
      const dx = e.clientX - rect.left;
      const dy = e.clientY - rect.top;
      grip.setPointerCapture(e.pointerId);
      const move = (ev) => {
        toolbar.style.transform = 'none';
        toolbar.style.left = `${clamp(ev.clientX - dx, 0, innerWidth - rect.width)}px`;
        toolbar.style.top = `${clamp(ev.clientY - dy, 0, innerHeight - rect.height)}px`;
      };
      const up = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
    });
  }

  function setTool(id) {
    commitText();
    state.tool = id;
    host.dataset.tool = id;
    if (id !== 'select') select(null);
    for (const b of toolbar.querySelectorAll('[data-tool]')) {
      b.setAttribute('aria-pressed', String(b.dataset.tool === id));
    }
  }

  // Also recolors the selected drawing. Comment cards are always neutral.
  function setColor(c) {
    state.color = c;
    for (const b of toolbar.querySelectorAll('[data-color]')) {
      b.setAttribute('aria-pressed', String(b.dataset.color === c));
    }
    const sel = selectedShape();
    if (sel && sel.type !== 'text' && sel.color !== c) {
      pushHistory();
      sel.color = c;
      renderShape(sel);
      state.dirty = true;
    }
  }

  function updateHistoryButtons() {
    toolbar.querySelector('[data-action="undo"]').disabled = !state.history.length;
    toolbar.querySelector('[data-action="redo"]').disabled = !state.future.length;
  }

  // ---------- history (snapshots, so moves, edits and deletes all undo the same way) ----------

  function pushHistory() {
    state.history.push(JSON.stringify(state.shapes));
    if (state.history.length > HISTORY_LIMIT) state.history.shift();
    state.future = [];
    updateHistoryButtons();
  }

  function undo() {
    commitText();
    if (!state.history.length) return;
    state.future.push(JSON.stringify(state.shapes));
    restore(state.history.pop());
  }

  function redo() {
    commitText();
    if (!state.future.length) return;
    state.history.push(JSON.stringify(state.shapes));
    restore(state.future.pop());
  }

  function restore(snapshot) {
    state.shapes = JSON.parse(snapshot);
    state.selected = null;
    state.dirty = state.shapes.length > 0;
    renderAll();
    updateHistoryButtons();
  }

  // ---------- pointer input ----------

  function shapeAt(target) {
    const el = target.closest?.('[data-id]');
    return el ? state.shapes.find((s) => s.id === el.dataset.id) : null;
  }

  function selectedShape() {
    return state.shapes.find((s) => s.id === state.selected) ?? null;
  }

  function onPointerDown(e) {
    if (e.button !== 0 || e.target.closest('textarea')) return;
    if (state.textInput) {
      commitText();
      state.skipClick = true;
      return;
    }
    const x = e.clientX;
    const y = e.clientY;
    const hit = shapeAt(e.target);
    if (state.tool === 'eraser') {
      state.erasing = true;
      if (hit) removeShape(hit);
      return;
    }
    // Anything can be dragged with the Select tool; comment cards with any tool but Comment.
    if (hit && (state.tool === 'select' || (hit.type === 'text' && state.tool !== 'text'))) {
      select(hit.id);
      state.drag = { shape: hit, x, y, moved: false };
      stage.setPointerCapture(e.pointerId);
      return;
    }
    if (state.tool === 'select') {
      select(null);
      return;
    }
    if (state.tool === 'text') return; // handled on click so the textarea keeps focus
    select(null);
    stage.setPointerCapture(e.pointerId);
    const base = { id: uid(), type: state.tool, color: state.color };
    if (state.tool === 'pen') state.drawing = { ...base, points: [[x, y]] };
    else if (state.tool === 'arrow') state.drawing = { ...base, x1: x, y1: y, x2: x, y2: y };
    else if (state.tool === 'rect') state.drawing = { ...base, x, y, w: 0, h: 0, ox: x, oy: y };
    renderShape(state.drawing);
  }

  function onPointerMove(e) {
    const x = e.clientX;
    const y = e.clientY;
    const drag = state.drag;
    if (drag) {
      if (!drag.moved) {
        if (Math.hypot(x - drag.x, y - drag.y) < 3) return; // a click, not a drag
        pushHistory();
        drag.moved = true;
      }
      translate(drag.shape, x - drag.x, y - drag.y);
      Object.assign(drag, { x, y });
      renderShape(drag.shape);
      renderSelection();
      return;
    }
    if (state.erasing && e.buttons & 1) {
      const hit = shapeAt(e.target);
      if (hit) removeShape(hit);
      return;
    }
    const s = state.drawing;
    if (!s) return;
    if (s.type === 'pen') s.points.push([x, y]);
    else if (s.type === 'arrow') Object.assign(s, { x2: x, y2: y });
    else if (s.type === 'rect') {
      Object.assign(s, { x: Math.min(s.ox, x), y: Math.min(s.oy, y), w: Math.abs(x - s.ox), h: Math.abs(y - s.oy) });
    }
    renderShape(s);
  }

  function onPointerUp() {
    state.erasing = false;
    if (state.drag) {
      if (state.drag.moved) {
        state.dirty = true;
        state.skipClick = true;
      }
      state.drag = null;
      return;
    }
    const s = state.drawing;
    if (!s) return;
    state.drawing = null;
    const tooSmall =
      (s.type === 'pen' && s.points.length < 3) ||
      (s.type === 'arrow' && Math.hypot(s.x2 - s.x1, s.y2 - s.y1) < 10) ||
      (s.type === 'rect' && (s.w < 6 || s.h < 6));
    nodes.get(s.id)?.remove();
    nodes.delete(s.id);
    if (tooSmall) return;
    delete s.ox;
    delete s.oy;
    addShape(s);
    showHint(s);
  }

  function onStageClick(e) {
    if (state.skipClick) {
      state.skipClick = false;
      return;
    }
    if (state.tool !== 'text' || e.target.closest('textarea')) return;
    const hit = shapeAt(e.target);
    if (hit?.type === 'text') openNoteEditor(hit);
    else openNoteEditor(null, e.clientX, e.clientY);
  }

  function onStageDblClick(e) {
    const hit = shapeAt(e.target);
    if (hit?.type === 'text' && !state.textInput) openNoteEditor(hit);
  }

  function translate(s, dx, dy) {
    if (s.type === 'pen') s.points = s.points.map(([px, py]) => [px + dx, py + dy]);
    else if (s.type === 'arrow') Object.assign(s, { x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy });
    else if (s.type === 'rect') Object.assign(s, { x: s.x + dx, y: s.y + dy });
    else if (s.type === 'text') Object.assign(s, { ax: s.ax + dx, ay: s.ay + dy });
  }

  function select(id) {
    state.selected = id;
    renderSelection();
  }

  // ---------- shapes ----------

  function addShape(shape) {
    pushHistory();
    state.shapes.push(shape);
    renderShape(shape);
    state.dirty = true;
  }

  function removeShape(shape) {
    if (!shape) return;
    pushHistory();
    state.shapes = state.shapes.filter((s) => s !== shape);
    nodes.get(shape.id)?.remove();
    nodes.delete(shape.id);
    if (state.selected === shape.id) select(null);
    state.dirty = state.shapes.length > 0;
  }

  function clearAll() {
    commitText();
    if (!state.shapes.length) return;
    pushHistory();
    state.shapes = [];
    state.selected = null;
    renderAll();
    state.dirty = false;
  }

  // ---------- comment cards ----------

  // A Figma-style comment: avatar pin + card, whose sharp corner sits on the clicked spot.
  function openNoteEditor(existing, ax, ay) {
    const shape = existing ? { ...existing } : { id: uid(), type: 'text', ax, ay, text: '' };
    if (existing) {
      nodes.get(existing.id)?.remove();
      nodes.delete(existing.id);
    }
    select(null);
    const el = noteCard(shape, true);
    const ta = el.querySelector('textarea');
    ta.value = shape.text;
    notesLayer.appendChild(el);
    placeNote(el, shape);
    // Keep the page's own keyboard shortcuts away from what the reviewer types.
    for (const type of ['keydown', 'keyup', 'keypress']) {
      ta.addEventListener(type, (e) => e.stopPropagation());
    }
    ta.addEventListener('input', () => placeNote(el, shape));
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commitText();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        commitText({ cancel: true });
      }
    });
    ta.addEventListener('blur', () => commitText());
    state.textInput = { el, ta, shape, original: existing };
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  function commitText({ cancel = false } = {}) {
    const edit = state.textInput;
    if (!edit) return;
    state.textInput = null;
    edit.el.remove();
    const { shape, original } = edit;
    const text = edit.ta.value.trim();
    const unchanged = original && text === original.text;
    if (cancel || unchanged || (!original && !text)) {
      if (original) renderShape(original);
      return;
    }
    pushHistory();
    if (original && !text) {
      state.shapes = state.shapes.filter((s) => s !== original);
    } else if (original) {
      original.text = text;
      renderShape(original);
    } else {
      shape.text = text;
      state.shapes.push(shape);
      renderShape(shape);
    }
    state.dirty = true;
  }

  function noteCard(s, editing) {
    const el = document.createElement('div');
    el.className = editing ? 'note-card editing' : 'note-card';
    el.dataset.id = s.id;
    el.dataset.type = 'text';
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.innerHTML = icon('text');
    const body = document.createElement(editing ? 'textarea' : 'div');
    if (editing) {
      body.rows = 1;
      body.placeholder = 'Add a comment';
    } else {
      body.className = 'text';
      body.textContent = s.text;
    }
    el.append(avatar, body);
    return el;
  }

  // Card grows up and to the right from its anchor; flips near the right/top edges.
  function placeNote(el, s) {
    const vw = host.clientWidth || innerWidth;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const flipX = s.ax + NOTE_MAX_W > vw - EDGE_PX;
    const flipY = s.ay - h < EDGE_PX;
    el.classList.toggle('flip-x', flipX);
    el.classList.toggle('flip-y', flipY);
    const left = Math.max(EDGE_PX, flipX ? s.ax - w : s.ax);
    const top = flipY ? s.ay : s.ay - h;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    // The card's box is what gets linked to nearby marks.
    Object.assign(s, { x: Math.round(left), y: Math.round(top), w: Math.round(w), h: Math.round(h) });
  }

  // ---------- rendering ----------

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  function renderAll() {
    shapesLayer.replaceChildren();
    notesLayer.replaceChildren();
    badgeLayer.replaceChildren();
    nodes.clear();
    state.shapes.forEach(renderShape);
    renderSelection();
  }

  function renderShape(s) {
    if (s.type === 'text') {
      let el = nodes.get(s.id);
      if (el) {
        el.querySelector('.text').textContent = s.text;
      } else {
        el = noteCard(s, false);
        notesLayer.appendChild(el);
        nodes.set(s.id, el);
      }
      placeNote(el, s);
      el.classList.toggle('selected', state.selected === s.id);
      return;
    }
    let g = nodes.get(s.id);
    if (!g) {
      g = svgEl('g', { 'data-id': s.id, 'data-type': s.type });
      nodes.set(s.id, g);
      shapesLayer.appendChild(g);
    }
    g.replaceChildren();
    const stroke = { fill: 'none', stroke: s.color, 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
    // Invisible wide stroke so thin lines are easy to grab and erase.
    const hit = { fill: 'none', stroke: 'transparent', 'stroke-width': 16, 'pointer-events': 'stroke' };
    if (s.type === 'pen') {
      const d = penPath(s.points);
      g.append(svgEl('path', { d, ...hit }), svgEl('path', { d, ...stroke }));
    } else if (s.type === 'arrow') {
      const d = arrowPath(s);
      g.append(svgEl('path', { d, ...hit }), svgEl('path', { d, ...stroke }));
    } else if (s.type === 'rect') {
      const r = { x: s.x, y: s.y, width: s.w, height: s.h, rx: 6 };
      g.append(svgEl('rect', { ...r, ...hit }), svgEl('rect', { ...r, ...stroke }));
    }
  }

  function renderSelection() {
    selectionLayer.replaceChildren();
    for (const el of notesLayer.querySelectorAll('.note-card.selected')) el.classList.remove('selected');
    const s = selectedShape();
    if (!s) return;
    if (s.type === 'text') {
      nodes.get(s.id)?.classList.add('selected');
      return;
    }
    const b = inflate(boxOf(s), 8);
    selectionLayer.appendChild(
      svgEl('rect', {
        x: b.x, y: b.y, width: b.w, height: b.h, rx: 4, fill: 'none',
        stroke: '#7048e8', 'stroke-width': 1.5, 'stroke-dasharray': '5 4', 'pointer-events': 'none',
      }),
    );
  }

  function penPath(points) {
    let d = `M${points[0][0]} ${points[0][1]}`;
    for (let i = 1; i < points.length - 1; i++) {
      const mx = (points[i][0] + points[i + 1][0]) / 2;
      const my = (points[i][1] + points[i + 1][1]) / 2;
      d += ` Q${points[i][0]} ${points[i][1]} ${mx} ${my}`;
    }
    const last = points[points.length - 1];
    return `${d} L${last[0]} ${last[1]}`;
  }

  function arrowPath({ x1, y1, x2, y2 }) {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const head = Math.min(18, Math.hypot(x2 - x1, y2 - y1) * 0.4);
    const ax = (a) => x2 - head * Math.cos(angle + a);
    const ay = (a) => y2 - head * Math.sin(angle + a);
    return `M${x1} ${y1} L${x2} ${y2} M${ax(0.45)} ${ay(0.45)} L${x2} ${y2} L${ax(-0.45)} ${ay(-0.45)}`;
  }

  // ---------- linking drawings to DOM elements ----------

  function boxOf(s) {
    if (s.type === 'rect' || s.type === 'text') return { x: s.x, y: s.y, w: s.w, h: s.h };
    if (s.type === 'arrow') {
      return { x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2), w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) };
    }
    const xs = s.points.map((p) => p[0]);
    const ys = s.points.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  function pointBoxDist(px, py, b) {
    const dx = Math.max(b.x - px, 0, px - (b.x + b.w));
    const dy = Math.max(b.y - py, 0, py - (b.y + b.h));
    return Math.hypot(dx, dy);
  }

  function boxDist(a, b) {
    const dx = Math.max(b.x - (a.x + a.w), 0, a.x - (b.x + b.w));
    const dy = Math.max(b.y - (a.y + a.h), 0, a.y - (b.y + b.h));
    return Math.hypot(dx, dy);
  }

  function elementsAt(x, y) {
    const cx = clamp(x, 0, innerWidth - 1);
    const cy = clamp(y, 0, innerHeight - 1);
    return document.elementsFromPoint(cx, cy).filter((el) => el !== host);
  }

  // Element whose box best overlaps a drawn region (a box or a circled area).
  function elementForRegion(b) {
    const candidates = elementsAt(b.x + b.w / 2, b.y + b.h / 2);
    let best = null;
    let bestScore = -1;
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      const ix = Math.max(0, Math.min(r.right, b.x + b.w) - Math.max(r.left, b.x));
      const iy = Math.max(0, Math.min(r.bottom, b.y + b.h) - Math.max(r.top, b.y));
      const inter = ix * iy;
      const union = r.width * r.height + b.w * b.h - inter;
      const score = union ? inter / union : 0;
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }
    return best;
  }

  // Where a mark points: arrow tip (or tail when the note sits at the tip), or the region.
  function targetOf(mark, reversed) {
    if (mark.type === 'arrow') return arrowTarget(mark, reversed);
    const b = boxOf(mark);
    // A flat freehand line is an underline: it refers to the text just above it.
    if (mark.type === 'pen' && b.h < 16 && b.w > b.h * 4) return elementsAt(b.x + b.w / 2, b.y - 6)[0] ?? null;
    return elementForRegion(b);
  }

  function arrowTarget(mark, reversed) {
    const [fx, fy, tx, ty] = reversed ? [mark.x2, mark.y2, mark.x1, mark.y1] : [mark.x1, mark.y1, mark.x2, mark.y2];
    const atTip = elementsAt(tx, ty)[0] ?? null;
    if (!atTip) return null;
    // Hand-drawn arrows tend to stop just short of what they point at. If the tip is on a
    // container, look a little further along the arrow for something inside it.
    const len = Math.hypot(tx - fx, ty - fy) || 1;
    for (const step of [6, 12, 18, 24]) {
      const el = elementsAt(tx + ((tx - fx) / len) * step, ty + ((ty - fy) / len) * step)[0];
      if (el && el !== atTip && atTip.contains(el)) return el;
    }
    return atTip;
  }

  function buildComments() {
    const marks = state.shapes.filter((s) => s.type !== 'text');
    const texts = state.shapes.filter((s) => s.type === 'text');
    const groups = marks.map((m) => ({ marks: [m], texts: [], reversed: new Set() }));
    const groupOf = (m) => groups.find((g) => g.marks.includes(m));
    const loose = [];

    for (const t of texts) {
      const tb = boxOf(t);
      // People draw a mark and then write its note, so the mark drawn right
      // before this note wins over a slightly closer one, if it's in range.
      const order = state.shapes.indexOf(t);
      const previous = state.shapes.slice(0, order).reverse().find((s) => s.type !== 'text');
      let best = null;
      for (const m of marks) {
        let d;
        let reversed = false;
        let limit;
        if (m.type === 'arrow') {
          const tail = pointBoxDist(m.x1, m.y1, tb);
          const tip = pointBoxDist(m.x2, m.y2, tb);
          // A note next to the tip means the arrow was drawn from the target to the note.
          reversed = tip < tail;
          d = Math.min(tail, tip);
          limit = ARROW_ATTACH_PX;
        } else {
          d = boxDist(boxOf(m), tb);
          limit = BOX_ATTACH_PX;
        }
        if (d > (m === previous ? PREVIOUS_ATTACH_PX : limit)) continue;
        if (m === previous) {
          best = { m, d: -1, reversed };
          break;
        }
        if (!best || d < best.d) best = { m, d, reversed };
      }
      if (best) {
        const group = groupOf(best.m);
        group.texts.push(t);
        if (best.reversed) group.reversed.add(best.m.id);
      } else {
        loose.push({ marks: [], texts: [t], reversed: new Set() });
      }
    }

    // Marks that touch (a circle plus an underline, an arrow pointing into a circle)
    // describe one thing, so they become one comment, unless both already have notes.
    for (let merged = true; merged; ) {
      merged = false;
      for (let i = 0; i < groups.length && !merged; i++) {
        for (let j = i + 1; j < groups.length && !merged; j++) {
          const [a, b] = [groups[i], groups[j]];
          if (a.texts.length && b.texts.length) continue;
          if (!a.marks.some((m) => b.marks.some((n) => marksTouch(m, n)))) continue;
          a.marks.push(...b.marks);
          a.texts.push(...b.texts);
          b.reversed.forEach((id) => a.reversed.add(id));
          groups.splice(j, 1);
          merged = true;
        }
      }
    }

    const comments = [...groups, ...loose].map(toComment);
    comments.sort((a, b) => a.badge.y - b.badge.y || a.badge.x - b.badge.x);
    comments.forEach((c, i) => (c.n = i + 1));
    return comments;
  }

  const TOUCH_PX = 16;

  function inflate(b, by) {
    return { x: b.x - by, y: b.y - by, w: b.w + by * 2, h: b.h + by * 2 };
  }

  function marksTouch(a, b) {
    const arrowInto = (arrow, other) =>
      other.type !== 'arrow' &&
      [[arrow.x1, arrow.y1], [arrow.x2, arrow.y2]].some(([x, y]) => pointBoxDist(x, y, inflate(boxOf(other), TOUCH_PX)) === 0);
    if (a.type === 'arrow' || b.type === 'arrow') {
      return a.type === 'arrow' ? arrowInto(a, b) : arrowInto(b, a);
    }
    return boxDist(boxOf(a), boxOf(b)) <= TOUCH_PX;
  }

  function unionBox(boxes) {
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    const r = Math.max(...boxes.map((b) => b.x + b.w));
    const btm = Math.max(...boxes.map((b) => b.y + b.h));
    return { x, y, w: r - x, h: btm - y };
  }

  function toComment({ marks, texts, reversed }) {
    texts.sort((a, b) => a.y - b.y || a.x - b.x);
    const text = texts.map((t) => t.text).join('\n');
    const firstText = texts[0] && boxOf(texts[0]);
    const regions = marks.filter((m) => m.type !== 'arrow');
    const arrow = marks.find((m) => m.type === 'arrow');
    let kind;
    let target;
    let region;
    let badge;
    if (regions.length) {
      // A drawn region says most precisely what is meant; arrows into it just point at it.
      kind = regions.some((m) => m.type === 'rect') ? 'box' : 'freehand';
      region = unionBox(regions.map(boxOf));
      target = regions.length === 1 ? targetOf(regions[0]) : elementForRegion(region);
      if (!firstText) badge = { x: region.x, y: region.y };
    } else if (arrow) {
      kind = 'arrow';
      const rev = reversed.has(arrow.id);
      const [x, y] = rev ? [arrow.x1, arrow.y1] : [arrow.x2, arrow.y2];
      region = { x, y, w: 0, h: 0 };
      target = targetOf(arrow, rev);
      if (!firstText) badge = rev ? { x: arrow.x2, y: arrow.y2 } : { x: arrow.x1, y: arrow.y1 };
    } else {
      // A comment on its own points where its pin (the card's sharp corner) sits.
      kind = 'text';
      region = firstText;
      target = elementsAt(texts[0].ax, texts[0].ay)[0] ?? null;
    }
    badge ??= { x: texts[0].ax, y: texts[0].ay };
    return {
      n: 0,
      text,
      kind,
      marks: marks.map((m) => m.type),
      region: roundBox(region),
      badge: { x: Math.round(badge.x), y: Math.round(badge.y) },
      shapeIds: [...marks, ...texts].map((s) => s.id),
      target: target ? describe(target) : null,
    };
  }

  function describe(el) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const styles = {};
    for (const p of [
      'display', 'position', 'font-family', 'font-size', 'font-weight', 'line-height',
      'color', 'background-color', 'padding', 'margin', 'gap', 'border-radius', 'width', 'height',
    ]) {
      styles[p] = cs.getPropertyValue(p);
    }
    const ancestors = [];
    for (let p = el.parentElement; p && p !== document.documentElement && ancestors.length < 5; p = p.parentElement) {
      ancestors.push(shortName(p));
    }
    return {
      selector: cssPath(el),
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: [...el.classList],
      role: el.getAttribute('role'),
      ariaLabel: el.getAttribute('aria-label'),
      text: (el.innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
      rect: roundBox({ x: r.left, y: r.top, w: r.width, h: r.height }),
      styles,
      ancestors,
      html: truncate(el.outerHTML, 800),
    };
  }

  function shortName(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    const cls = usableClasses(el);
    if (cls.length) s += `.${cls.join('.')}`;
    return s;
  }

  function usableClasses(el) {
    // Skip utility/hashed classes that make selectors brittle (e.g. "md:flex", "css-1x2y3z").
    return [...el.classList].filter((c) => /^[A-Za-z_-][\w-]*$/.test(c) && !/\d{3,}/.test(c)).slice(0, 2);
  }

  function cssPath(el) {
    const isUnique = (parts) => {
      try {
        return document.querySelectorAll(parts.join(' > ')).length === 1;
      } catch {
        return false;
      }
    };
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && node !== document.documentElement; node = node.parentElement) {
      if (node.id && /^[A-Za-z][\w-]*$/.test(node.id)) {
        parts.unshift(`#${node.id}`);
        if (isUnique(parts)) break;
        continue;
      }
      let part = node.tagName.toLowerCase();
      const testId = node.getAttribute('data-testid');
      if (testId) part += `[data-testid="${testId.replace(/"/g, '\\"')}"]`;
      else {
        const cls = usableClasses(node);
        if (cls.length) part += `.${cls.map((c) => CSS.escape(c)).join('.')}`;
      }
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      if (isUnique(parts)) break;
    }
    return parts.join(' > ');
  }

  function showHint(mark) {
    const el = targetOf(mark, false);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const hint = document.createElement('div');
    hint.className = 'hint';
    Object.assign(hint.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const label = document.createElement('span');
    label.textContent = shortName(el);
    hint.appendChild(label);
    hintsEl.appendChild(hint);
    setTimeout(() => (hint.style.opacity = '0'), 1200);
    setTimeout(() => hint.remove(), 1700);
  }

  // ---------- save ----------

  async function save() {
    commitText();
    if (state.saving) return;
    if (!state.shapes.length) {
      toast('Nothing to save yet — draw something first.');
      return;
    }
    state.saving = true;
    select(null);
    const comments = buildComments();
    drawBadges(comments);
    hintsEl.replaceChildren();
    host.classList.add('capturing');
    await nextFrames(2);
    try {
      const review = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        url: location.href,
        title: document.title,
        createdAt: new Date().toISOString(),
        viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
        scroll: { x: Math.round(scrollX), y: Math.round(scrollY) },
        comments,
        shapes: state.shapes,
      };
      const res = await chrome.runtime.sendMessage({ type: 'save', review });
      if (!res?.ok) throw new Error(res?.error ?? 'no response');
      state.dirty = false;
      host.classList.remove('capturing');
      const n = comments.length;
      const what = `${n} comment${n === 1 ? '' : 's'}`;
      const message =
        res.synced === true
          ? `Saved ${what} and sent to Claude.`
          : res.synced === false
            ? `Saved ${what}. Claude gets it automatically once a Claude Code session is open.`
            : `Saved ${what}.`; // agent sync off
      toast(message, {
        label: 'Open reviews',
        onClick: () => chrome.runtime.sendMessage({ type: 'open-reviews' }),
      });
    } catch (err) {
      host.classList.remove('capturing');
      toast(`Save failed: ${err.message}`);
    } finally {
      renderAll(); // drops the numbers again
      state.saving = false;
    }
  }

  // Numbers in the screenshot match the comment numbers in the review: a comment card
  // shows its number in its avatar pin; drawings without a card get a numbered badge.
  function drawBadges(comments) {
    badgeLayer.replaceChildren();
    for (const c of comments) {
      const noteId = c.shapeIds.find((id) => state.shapes.find((sh) => sh.id === id)?.type === 'text');
      const avatar = noteId && nodes.get(noteId)?.querySelector('.avatar');
      if (avatar) {
        avatar.textContent = String(c.n);
        continue;
      }
      const x = clamp(c.badge.x - 14, 14, innerWidth - 14);
      const y = clamp(c.badge.y - 14, 14, innerHeight - 14);
      const g = svgEl('g', {});
      g.append(svgEl('circle', { cx: x, cy: y, r: 13, fill: '#18181b', stroke: '#fff', 'stroke-width': 2 }));
      const t = svgEl('text', {
        x,
        y,
        fill: '#fff',
        'font-family': 'Inter, "Segoe UI", system-ui, sans-serif',
        'font-size': 13,
        'font-weight': 700,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
      });
      t.textContent = String(c.n);
      g.appendChild(t);
      badgeLayer.appendChild(g);
    }
  }

  // ---------- keyboard ----------

  const SCROLL_KEYS = new Set([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']);

  const NUDGE = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

  // Uses e.code (physical key), so Ctrl+Z etc. also work with e.g. a Russian layout,
  // where e.key would be "я".
  function onKeyDown(e) {
    if (state.textInput && e.composedPath().includes(state.textInput.ta)) return;
    const mod = e.ctrlKey || e.metaKey;
    const plain = !mod && !e.altKey;
    const sel = selectedShape();
    const tool = plain && TOOLS.find((t) => t.code === e.code);
    let handled = true;
    if (mod && e.code === 'KeyZ') e.shiftKey ? redo() : undo();
    else if (mod && e.code === 'KeyY') redo();
    else if (mod && e.code === 'KeyS') save();
    else if (e.key === 'Escape') sel ? select(null) : close();
    else if (sel && (e.key === 'Delete' || e.key === 'Backspace')) removeShape(sel);
    else if (sel && NUDGE[e.key]) {
      const step = e.shiftKey ? 10 : 1;
      pushHistory();
      translate(sel, NUDGE[e.key][0] * step, NUDGE[e.key][1] * step);
      renderShape(sel);
      renderSelection();
      state.dirty = true;
    } else if (sel && plain && e.key === 'Enter' && sel.type === 'text') openNoteEditor(sel);
    else if (tool) setTool(tool.id);
    else if (plain && /^Digit[1-5]$/.test(e.code)) setColor(COLORS[Number(e.code.slice(5)) - 1]);
    else handled = SCROLL_KEYS.has(e.key);
    if (handled) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  // ---------- helpers ----------

  function toast(message, action) {
    clearTimeout(toastTimer);
    toastEl.replaceChildren(document.createTextNode(message));
    if (action) {
      const btn = document.createElement('button');
      btn.textContent = action.label;
      btn.addEventListener('click', action.onClick);
      toastEl.appendChild(btn);
    }
    toastEl.hidden = false;
    toastTimer = setTimeout(() => (toastEl.hidden = true), action ? 6000 : 3500);
  }

  function nextFrames(n) {
    return new Promise((resolve) => {
      const step = () => (n-- <= 0 ? setTimeout(resolve, 30) : requestAnimationFrame(step));
      step();
    });
  }

  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function roundBox(b) {
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) };
  }

  function truncate(s, n) {
    return s.length > n ? `${s.slice(0, n)}…` : s;
  }

  function preventDefault(e) {
    e.preventDefault();
  }

  window.__pageReview = { toggle };
  open();
})();
