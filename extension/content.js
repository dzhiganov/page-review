// Review overlay. Injected on demand by background.js; a second injection toggles it.
(() => {
  if (window.__pageReview) {
    window.__pageReview.toggle();
    return;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const { DEFAULT_FONT, normalizeFont, stepSize, noteCss, stepNumbers, nextStepNumber } = globalThis.PageReviewNotes;
  const { isCurved, defaultBend, midpoint: arrowMidpoint, bendThrough, tailForCard, arrowPathData, relativeBend, applyRelativeBend } =
    globalThis.PageReviewArrows;
  const { frameFrom, isFrame, moveFrame, fitFrame, itemsInFrame, cropItems } = globalThis.PageReviewFrame;
  const COLORS = ['#e03131', '#f08c00', '#1971c2', '#2f9e44', '#868e96', '#1e1e1e'];
  const COLOR_NAMES = ['Red', 'Orange', 'Blue', 'Green', 'Grey', 'Black'];
  const NOTE_MAX_W = 280;
  const STROKE_PX = 3; // drawings' stroke width
  const NOTE_TOOLS_GAP = 12; // between a comment card and its style bar
  const NOTE_TOOLS_MARGIN = 8; // between the style bar and the edge of the window
  const AVATAR_PX = 24;
  const CARD_RADIUS = 16; // .note-card border-radius; the corner at the pin is CARD_PIN_RADIUS
  const CARD_PIN_RADIUS = 4;
  const TEXT_PAD_Y = 4; // .text / textarea vertical padding
  const NOTE_CHROME_W = 10 + AVATAR_PX + 8 + 14; // card padding + avatar + gap
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
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    outlines: '<path d="M4 8V5a1 1 0 0 1 1-1h3"/><path d="M16 4h3a1 1 0 0 1 1 1v3"/><path d="M20 16v3a1 1 0 0 1-1 1h-3"/><path d="M8 20H5a1 1 0 0 1-1-1v-3"/><rect x="8" y="9" width="8" height="6" rx="1"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    clear: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m6 6 1 14h10l1-14"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    edit: '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    step: '<circle cx="12" cy="12" r="9"/><path d="M10.5 9 12.5 7.5V16.5"/>',
    frame: '<path d="M7 3v14h14"/><path d="M3 7h14v14"/>',
    reset: '<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/>',
  };

  // Shortcuts use physical keys (e.code), so they also work with non-Latin layouts.
  const TOOLS = [
    { id: 'select', code: 'KeyV', title: 'Select & move (V)' },
    { id: 'pen', code: 'KeyP', title: 'Pen (P)' },
    { id: 'arrow', code: 'KeyA', title: 'Arrow (A)' },
    { id: 'rect', code: 'KeyR', title: 'Box (R)' },
    { id: 'text', code: 'KeyT', title: 'Comment (T)' },
    { id: 'step', code: 'KeyS', title: 'Step (S)', label: 'Step' },
    { id: 'eraser', code: 'KeyE', title: 'Eraser (E)' },
    { id: 'frame', code: 'KeyF', title: 'Frame (F)', label: 'Frame' },
  ];

  const STYLES = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .stage { position: fixed; inset: 0; cursor: crosshair; touch-action: none; }
    :host([data-tool="select"]) .stage { cursor: default; }
    :host([data-tool="text"]) .stage, :host([data-tool="step"]) .stage { cursor: text; }
    :host([data-tool="eraser"]) .stage { cursor: cell; }
    .canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
    :host([data-tool="select"]) .canvas [data-id] { cursor: move; }
    :host([data-tool="select"]) .canvas .hit-area { pointer-events: all; } /* grab a box anywhere inside */
    .canvas .handle { pointer-events: all; fill: #fff; stroke: #7048e8; stroke-width: 1.5; cursor: grab; }
    .canvas .handle[data-handle="nw"], .canvas .handle[data-handle="se"] { cursor: nwse-resize; }
    .canvas .handle[data-handle="ne"], .canvas .handle[data-handle="sw"] { cursor: nesw-resize; }
    .notes { position: absolute; inset: 0; pointer-events: none; }
    .frame { position: fixed; inset: 0; border: 3px solid #7048e8; pointer-events: none; }

    /* The capture area: everything outside it is dimmed. Movable and resizable with the Frame tool. */
    .crop { position: fixed; pointer-events: none; box-shadow: 0 0 0 1.5px #7048e8, 0 0 0 100vmax rgba(15,15,20,.45); }
    .crop[hidden] { display: none; }
    :host([data-tool="frame"]) .crop { pointer-events: auto; cursor: move; }
    .crop .handle { position: absolute; width: 9px; height: 9px; margin: -4.5px; background: #fff; border: 1.5px solid #7048e8; border-radius: 2px; }
    :host(:not([data-tool="frame"])) .crop .handle { display: none; }
    .crop .handle[data-crop="nw"] { left: 0; top: 0; cursor: nwse-resize; }
    .crop .handle[data-crop="ne"] { left: 100%; top: 0; cursor: nesw-resize; }
    .crop .handle[data-crop="se"] { left: 100%; top: 100%; cursor: nwse-resize; }
    .crop .handle[data-crop="sw"] { left: 0; top: 100%; cursor: nesw-resize; }
    .crop .reset {
      all: unset; position: absolute; right: 0; top: -34px; width: 28px; height: 28px; display: grid; place-items: center;
      border-radius: 8px; background: #1f1f24; color: #eee; cursor: pointer; pointer-events: auto; box-shadow: 0 4px 14px rgba(0,0,0,.25);
    }
    .crop.reset-inside .reset { top: 6px; right: 6px; }
    .crop .reset:hover { background: #34343c; }
    .crop .reset svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

    .note-card {
      position: absolute; pointer-events: auto; display: flex; align-items: flex-start; gap: 8px;
      max-width: ${NOTE_MAX_W}px; padding: 8px 14px 8px 10px; background: #fff; color: #1e1e1e;
      border-radius: 16px 16px 16px 4px; user-select: none; cursor: grab;
      box-shadow: 0 0 0 1px rgba(0,0,0,.06), 0 2px 6px rgba(0,0,0,.08), 0 10px 28px rgba(0,0,0,.18);
      font: 14px/20px Inter, "Segoe UI", system-ui, -apple-system, sans-serif; letter-spacing: -0.005em;
    }
    .note-card.flip-x { border-radius: 16px 16px 4px 16px; }
    .note-card.flip-y { border-radius: 4px 16px 16px 16px; }
    .note-card.flip-x.flip-y { border-radius: 16px 4px 16px 16px; }
    :host([data-tool="text"]) .note-card, :host([data-tool="step"]) .note-card { cursor: text; }
    :host([data-tool="eraser"]) .note-card { cursor: cell; }
    .note-card.selected { box-shadow: 0 0 0 2px #7048e8, 0 10px 28px rgba(0,0,0,.2); }
    .note-card.editing { cursor: default; box-shadow: 0 0 0 1.5px #18181b, 0 10px 28px rgba(0,0,0,.2); }
    .note-card .avatar {
      flex: none; width: ${AVATAR_PX}px; height: ${AVATAR_PX}px; border-radius: 50%; background: #18181b; color: #fff;
      display: grid; place-items: center; font: 700 12px/1 Inter, "Segoe UI", system-ui, sans-serif;
      box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.35);
    }
    /* A step's number: the avatar's circle, filled with the accent so steps stand apart from comments. */
    .note-card .avatar.step { background: #7048e8; font-variant-numeric: tabular-nums; }
    .note-card .avatar svg { width: 13px; height: 13px; fill: none; stroke: #fff; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
    .note-card .avatar.photo { position: relative; }
    .note-card .avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: block; }
    .note-card .avatar .n {
      position: absolute; right: -6px; bottom: -6px; min-width: 18px; height: 18px; padding: 0 4px; box-sizing: border-box;
      border-radius: 9px; background: #18181b; color: #fff; font: 700 11px/18px Inter, "Segoe UI", system-ui, sans-serif;
      text-align: center; box-shadow: 0 0 0 1.5px #fff;
    }
    .note-card .text { padding: 4px 0; max-width: ${NOTE_MAX_W - NOTE_CHROME_W}px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .note-card textarea {
      all: unset; display: block; padding: 4px 0; min-width: 180px; max-width: ${NOTE_MAX_W - NOTE_CHROME_W}px;
      field-sizing: content; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; color: inherit; cursor: text;
    }
    .note-card textarea::placeholder { color: #8a8a93; font-weight: 400; }
    .note-card.new { animation: note-in .14s cubic-bezier(.2,.9,.3,1.15); transform-origin: 0 100%; }
    .note-card.flip-x.new { transform-origin: 100% 100%; }
    .note-card.flip-y.new { transform-origin: 0 0; }
    .note-card.flip-x.flip-y.new { transform-origin: 100% 0; }
    .note-card.leaving { animation: note-out .12s ease-in forwards; pointer-events: none; }
    @keyframes note-in { from { opacity: 0; transform: scale(.9); } }
    @keyframes note-out { to { opacity: 0; transform: scale(.94); } }

    .note-tools {
      position: fixed; display: flex; align-items: center; gap: 1px; padding: 4px;
      background: #1f1f24; color: #eee; border-radius: 10px; user-select: none;
      box-shadow: 0 6px 20px rgba(0,0,0,.25); font: 13px/1 system-ui, sans-serif;
    }
    .note-tools[hidden] { display: none; }
    .note-tools button {
      all: unset; box-sizing: border-box; height: 26px; min-width: 26px; padding: 0 5px;
      display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; cursor: pointer;
    }
    .note-tools button:hover { background: rgba(255,255,255,.12); }
    .note-tools button[aria-pressed="true"] { background: #5f3dc4; }
    .note-tools button.color { min-width: 22px; padding: 0; }
    .note-tools button.color[aria-pressed="true"] { background: none; box-shadow: inset 0 0 0 2px #fff; }
    .note-tools .swatch { width: 14px; height: 14px; }
    .note-tools .size { min-width: 20px; text-align: center; font-variant-numeric: tabular-nums; opacity: .8; }
    .note-tools .sep { height: 16px; margin: 0 3px; }
    .note-tools.editing [data-note="edit"], .note-tools.editing [data-note="edit"] + .sep { display: none; }
    .note-tools svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

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
    .toolbar button:focus-visible { outline: 2px solid #b197fc; outline-offset: -2px; }
    .toolbar .copy-wrap { position: relative; display: inline-flex; }
    .toolbar .menu {
      position: absolute; top: calc(100% + 10px); right: 0; display: flex; flex-direction: column; gap: 2px; padding: 4px;
      background: #1f1f24; border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.28);
    }
    .toolbar .menu[hidden] { display: none; }
    .toolbar .menu button { justify-content: flex-start; height: 30px; padding: 0 10px; white-space: nowrap; }
    .toolbar .menu button:focus { background: rgba(255,255,255,.12); outline: none; }
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
    .outlines { position: fixed; inset: 0; pointer-events: none; }
    .outline { position: fixed; border: 1.5px dashed var(--c); background: color-mix(in srgb, var(--c) 6%, transparent); pointer-events: none; }
    .outline span {
      position: absolute; top: -21px; left: -1.5px; right: auto; bottom: auto; max-width: 60vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      background: var(--c); color: #fff; font: 11px/1 ui-monospace, monospace; padding: 4px 6px; border-radius: 4px;
    }
    .outline span.right { left: auto; right: -1.5px; }
    .outline span.below { top: auto; bottom: -21px; }
    .toast {
      position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
      display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 10px;
      background: #1f1f24; color: #eee; font: 13px/1.3 system-ui, sans-serif; box-shadow: 0 8px 28px rgba(0,0,0,.28);
    }
    .toast[hidden] { display: none; }
    .toast button { all: unset; cursor: pointer; color: #b197fc; font-weight: 600; }
    :host(.capturing) .toolbar, :host(.capturing) .hints, :host(.capturing) .outlines, :host(.capturing) .selection,
    :host(.capturing) .toast, :host(.capturing) .frame, :host(.capturing) .crop, :host(.capturing) .note-tools,
    :host(.capturing) .note-card.leaving { display: none !important; }
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
    outlines: false, // keep linked elements outlined and outline the one under the cursor
    hover: null, // { x, y } of the cursor while outlines are on
    handleDrag: null, // dragging a handle of the selected mark: arrow tail/head/bend, box corner
    erasing: false,
    textInput: null,
    skipClick: false,
    pressedNote: null, // comment just clicked; pointer capture retargets the click to the stage
    dirty: false,
    saving: false,
    noteFont: { ...DEFAULT_FONT }, // font for new comments: the last one picked in this session
    crop: null, // capture area { x, y, w, h } in viewport CSS px; null: the whole viewport
    cropDrag: null, // drawing, moving or resizing the capture area
    saved: null, // { id, snapshot } of the last save, for "Copy for agent"
  };
  const nodes = new Map(); // shape id -> <g> (drawings) or .note-card (comments)
  let avatarSrc = null; // the user's avatar (Settings on the reviews page), shown on comment cards
  let avatarBlocked = false; // the page refused to load it once (e.g. its CSP): use the icon from then on
  let host, shadow, stage, svg, shapesLayer, selectionLayer, badgeLayer, notesLayer, hintsEl, outlinesEl, cropEl, toolbar, noteTools, toastEl, toastTimer;

  // ---------- lifecycle ----------

  function open() {
    host = document.createElement('page-review-overlay');
    host.style.cssText =
      'all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; display: block !important;';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${STYLES}</style>
      <div class="hints"></div>
      <div class="outlines"></div>
      <div class="stage">
        <svg class="canvas" xmlns="${SVG_NS}"><g class="shapes"></g><g class="selection"></g><g class="badges"></g></svg>
        <div class="notes"></div>
      </div>
      <div class="crop" hidden>
        <span class="handle" data-crop="nw"></span><span class="handle" data-crop="ne"></span>
        <span class="handle" data-crop="se"></span><span class="handle" data-crop="sw"></span>
        <button class="reset" title="Full page (Esc)" aria-label="Reset frame to the full page">${icon('reset')}</button>
      </div>
      <div class="frame"></div>
      <div class="toolbar" role="toolbar"></div>
      <div class="note-tools" role="toolbar" hidden></div>
      <div class="toast" hidden></div>
    `;
    stage = shadow.querySelector('.stage');
    svg = shadow.querySelector('.canvas');
    shapesLayer = shadow.querySelector('.shapes');
    selectionLayer = shadow.querySelector('.selection');
    badgeLayer = shadow.querySelector('.badges');
    notesLayer = shadow.querySelector('.notes');
    hintsEl = shadow.querySelector('.hints');
    outlinesEl = shadow.querySelector('.outlines');
    cropEl = shadow.querySelector('.crop');
    toolbar = shadow.querySelector('.toolbar');
    noteTools = shadow.querySelector('.note-tools');
    toastEl = shadow.querySelector('.toast');
    buildToolbar();
    buildNoteTools();

    stage.addEventListener('pointerdown', onPointerDown);
    stage.addEventListener('pointermove', onPointerMove);
    stage.addEventListener('pointerup', onPointerUp);
    stage.addEventListener('click', onStageClick);
    stage.addEventListener('dblclick', onStageDblClick);
    stage.addEventListener('pointermove', onHover);
    stage.addEventListener('pointerleave', onHover);
    cropEl.addEventListener('pointerdown', onCropPointerDown);
    cropEl.addEventListener('pointermove', onPointerMove);
    cropEl.addEventListener('pointerup', onPointerUp);
    cropEl.querySelector('.reset').addEventListener('click', () => setCrop(null));
    window.addEventListener('scroll', scheduleOutlines, true);
    window.addEventListener('resize', onResize);
    // Drawings are tied to the viewport, so the page must not scroll under them.
    host.addEventListener('wheel', preventDefault, { passive: false });
    host.addEventListener('touchmove', preventDefault, { passive: false });
    window.addEventListener('keydown', onKeyDown, true);
    loadPrefs();

    // Ready long before the first comment; a re-render here could drop an open comment editor.
    chrome.storage.local.get('settings').then(({ settings }) => {
      avatarSrc = avatarBlocked ? null : (settings?.avatar ?? null);
    });
    Object.assign(state, {
      open: true, shapes: [], history: [], future: [], selected: null, dirty: false, noteFont: { ...DEFAULT_FONT }, crop: null, cropDrag: null, saved: null,
    });
    nodes.clear();
    document.documentElement.appendChild(host);
    setTool(state.tool);
    updateHistoryButtons();
    toast('Draw, add comments (T), move things (V). Ctrl+S saves, Esc exits.');
  }

  function close() {
    if (state.dirty && !confirm('Discard unsaved annotations?')) return;
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', scheduleOutlines, true);
    window.removeEventListener('resize', onResize);
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
      const label = t.label ? ` aria-label="${t.label}"` : '';
      parts.push(`<button data-tool="${t.id}" title="${t.title}"${label}>${icon(t.id)}</button>`);
    }
    parts.push(`<button data-action="outlines" title="Show elements" aria-label="Show elements">${icon('outlines')}</button>`);
    parts.push('<span class="sep"></span>');
    COLORS.forEach((c, i) => {
      parts.push(
        `<button class="color" data-color="${c}" title="Color (${i + 1})" aria-label="${COLOR_NAMES[i]} (${i + 1})"><span class="swatch" style="background:${c}"></span></button>`,
      );
    });
    parts.push('<span class="sep"></span>');
    parts.push(`<button data-action="undo" title="Undo (Ctrl/Cmd+Z)">${icon('undo')}</button>`);
    parts.push(`<button data-action="redo" title="Redo (Ctrl/Cmd+Shift+Z)">${icon('redo')}</button>`);
    parts.push(`<button data-action="clear" title="Clear all">${icon('clear')}</button>`);
    parts.push(`<button data-action="reviews" title="Open saved reviews">${icon('folder')}</button>`);
    parts.push(
      '<span class="copy-wrap">' +
        `<button data-action="copy" title="Copy" aria-label="Copy" aria-haspopup="menu" aria-expanded="false" aria-controls="copy-menu">${icon('copy')}</button>` +
        '<div class="menu" id="copy-menu" role="menu" aria-label="Copy" hidden>' +
        '<button role="menuitem" tabindex="-1" data-copy="image">Copy image</button>' +
        '<button role="menuitem" tabindex="-1" data-copy="agent">Copy for agent</button>' +
        '</div></span>',
    );
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
      else if (action === 'copy') setCopyMenu(copyMenu.hidden);
      else if (btn.dataset.copy) {
        setCopyMenu(false);
        toolbar.querySelector('[data-action="copy"]').focus();
        if (btn.dataset.copy === 'image') copyImage();
        else copyForAgent();
      }
      else if (action === 'close') close();
      else if (action === 'outlines') setOutlines(!state.outlines, true);
    });
    enableToolbarDrag(toolbar.querySelector('.grip'));
    setColor(state.color);
    copyMenu = toolbar.querySelector('.menu');
    // A press anywhere else closes the copy menu.
    shadow.addEventListener('pointerdown', (e) => !e.composedPath().includes(copyMenu.parentElement) && setCopyMenu(false), true);
  }

  // ---------- copy menu (Copy image / Copy for agent) ----------

  let copyMenu;

  function setCopyMenu(open, focusLast = false) {
    if (open) commitText();
    copyMenu.hidden = !open;
    toolbar.querySelector('[data-action="copy"]').setAttribute('aria-expanded', String(open));
    if (open) menuItems().at(focusLast ? -1 : 0).focus();
  }

  function menuItems() {
    return [...copyMenu.querySelectorAll('[role="menuitem"]')];
  }

  // Keys while the copy menu is open, or on its button. Returns true when handled.
  function onCopyMenuKey(e) {
    const button = toolbar.querySelector('[data-action="copy"]');
    const focused = shadow.activeElement;
    if (copyMenu.hidden) {
      if (focused !== button || !['ArrowDown', 'ArrowUp', ' ', 'Enter'].includes(e.key)) return false;
      setCopyMenu(true, e.key === 'ArrowUp');
      return true;
    }
    const items = menuItems();
    const i = items.indexOf(focused);
    if (e.key === 'Escape') {
      setCopyMenu(false);
      button.focus();
    } else if (e.key === 'ArrowDown') items[(i + 1) % items.length].focus();
    else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length].focus();
    else if (e.key === 'Home') items[0].focus();
    else if (e.key === 'End') items.at(-1).focus();
    else if (e.key === 'Enter' || e.key === ' ') (items[i] ?? items[0]).click();
    else {
      setCopyMenu(false); // any other key (Tab, a shortcut) closes it and does its usual thing
      return false;
    }
    return true;
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
    if (sel && !isCard(sel) && sel.color !== c) {
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
    state.pressedNote = null;
    if (state.textInput) {
      commitText();
      // With the Comment tool a click elsewhere just finishes the comment; other tools carry on.
      if (isCardTool(state.tool)) {
        state.skipClick = true;
        return;
      }
    }
    const x = e.clientX;
    const y = e.clientY;
    const handle = e.target.closest?.('[data-handle]');
    if (handle && selectedShape()) {
      const shape = selectedShape();
      const kind = handle.dataset.handle;
      // A box corner resizes against the opposite corner, which stays put.
      const fixed = shape.type === 'rect' && [kind.includes('w') ? shape.x + shape.w : shape.x, kind.includes('n') ? shape.y + shape.h : shape.y];
      state.handleDrag = { shape, kind, fixed, x, y, moved: false };
      stage.setPointerCapture(e.pointerId);
      return;
    }
    if (state.tool === 'frame') {
      // Outside the current frame: draw a new one.
      startCropDrag(e, stage, 'new');
      return;
    }
    const hit = shapeAt(e.target);
    if (state.tool === 'eraser') {
      state.erasing = true;
      if (hit) removeShape(hit);
      return;
    }
    // Anything can be dragged with the Select tool; comment cards with any tool
    // (with the Comment tool, a click without dragging edits the comment).
    if (hit && (state.tool === 'select' || isCard(hit))) {
      select(hit.id);
      state.drag = { shape: hit, x, y, moved: false };
      stage.setPointerCapture(e.pointerId);
      return;
    }
    if (state.tool === 'select') {
      select(null);
      return;
    }
    if (isCardTool(state.tool)) return; // handled on click so the textarea keeps focus
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
    if (state.cropDrag) return dragCrop(x, y);
    if (state.handleDrag) {
      const hd = state.handleDrag;
      if (!hd.moved) {
        if (Math.hypot(x - hd.x, y - hd.y) < 2) return;
        pushHistory();
        hd.moved = true;
      }
      dragHandle(hd, x, y);
      renderSelection();
      return;
    }
    const drag = state.drag;
    if (drag) {
      if (!drag.moved) {
        if (Math.hypot(x - drag.x, y - drag.y) < 3) return; // a click, not a drag
        pushHistory();
        drag.moved = true;
      }
      move(drag.shape, x - drag.x, y - drag.y);
      Object.assign(drag, { x, y });
      if (isCard(drag.shape)) updatePinHint(drag.shape);
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
    else if (s.type === 'arrow') {
      Object.assign(s, { x2: x, y2: y });
      setBend(s, defaultBend(s)); // drawn with a gentle curve; short ones stay straight
    }
    else if (s.type === 'rect') {
      Object.assign(s, { x: Math.min(s.ox, x), y: Math.min(s.oy, y), w: Math.abs(x - s.ox), h: Math.abs(y - s.oy) });
    }
    renderShape(s);
  }

  function onPointerUp() {
    state.erasing = false;
    if (state.cropDrag) return endCropDrag();
    if (state.handleDrag) {
      if (state.handleDrag.moved) {
        state.dirty = true;
        state.skipClick = true;
        showHint(state.handleDrag.shape); // which element it points at now
      }
      state.handleDrag = null;
      return;
    }
    if (state.drag) {
      if (state.drag.moved) {
        state.dirty = true;
        state.skipClick = true;
        if (!isCard(state.drag.shape)) showHint(state.drag.shape);
        else endPinHint();
      } else if (isCard(state.drag.shape)) {
        state.pressedNote = state.drag.shape.id;
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
    // An arrow or a box is almost always followed by a comment about it: start one right away.
    if (s.type === 'arrow' || s.type === 'rect') {
      const [ax, ay] = s.type === 'arrow' ? [s.x1, s.y1] : [s.x + s.w, s.y];
      openNoteEditor(null, ax, ay, s.id);
    }
  }

  function onStageClick(e) {
    if (state.skipClick) {
      state.skipClick = false;
      return;
    }
    if (!isCardTool(state.tool) || e.target.closest('textarea')) return;
    const hit = clickedShape(e);
    if (isCard(hit)) openNoteEditor(hit);
    else openNoteEditor(null, e.clientX, e.clientY, null, state.tool);
  }

  function onStageDblClick(e) {
    const hit = clickedShape(e);
    if (isCard(hit) && !state.textInput) openNoteEditor(hit);
  }

  // A comment pressed without dragging captured the pointer, so its click lands on the stage.
  function clickedShape(e) {
    return shapeAt(e.target) ?? state.shapes.find((s) => s.id === state.pressedNote) ?? null;
  }

  function translate(s, dx, dy) {
    if (s.type === 'pen') s.points = s.points.map(([px, py]) => [px + dx, py + dy]);
    else if (s.type === 'arrow') {
      Object.assign(s, { x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy });
      if (isCurved(s)) Object.assign(s, { cx: s.cx + dx, cy: s.cy + dy });
    }
    else if (s.type === 'rect') Object.assign(s, { x: s.x + dx, y: s.y + dy });
    else if (isCard(s)) Object.assign(s, { ax: s.ax + dx, ay: s.ay + dy });
  }

  // One step of dragging a handle: an arrow's tail, head or bend, or a box corner.
  function dragHandle({ shape: s, kind, fixed }, x, y) {
    if (kind === 'bend') {
      setBend(s, bendThrough(s, x, y));
    } else if (kind === 'tail' || kind === 'head') {
      const rel = relativeBend(s); // the bend keeps its proportion as the arrow changes
      const [ex, ey] = kind === 'tail' ? ['x1', 'y1'] : ['x2', 'y2'];
      const [dx, dy] = [x - s[ex], y - s[ey]];
      Object.assign(s, { [ex]: x, [ey]: y });
      if (rel) Object.assign(s, applyRelativeBend(s, rel));
      if (kind === 'tail') {
        // The comment pinned at the tail comes along (and re-aims the tail at itself).
        for (const note of state.shapes) {
          if (note.type === 'text' && note.mark === s.id) {
            translate(note, dx, dy);
            renderShape(note);
          }
        }
      }
    } else if (fixed) {
      const [fx, fy] = fixed;
      Object.assign(s, { x: Math.min(fx, x), y: Math.min(fy, y), w: Math.max(6, Math.abs(x - fx)), h: Math.max(6, Math.abs(y - fy)) });
    }
    renderShape(s);
    if (s.type === 'arrow') reattachNotes(s);
  }

  // Moves a shape and re-renders it; comments attached to a mark travel with it. (A moved
  // comment re-aims its arrow's tail when it is placed: see attachTail.)
  function move(s, dx, dy) {
    translate(s, dx, dy);
    renderShape(s);
    if (isCard(s)) return;
    for (const note of state.shapes) {
      if (note.type === 'text' && note.mark === s.id) {
        translate(note, dx, dy);
        renderShape(note);
      }
    }
  }

  // Sets an arrow's control point, or makes it straight when `c` is null.
  function setBend(s, c) {
    if (c) Object.assign(s, c);
    else {
      delete s.cx;
      delete s.cy;
    }
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
    scheduleOutlines();
    pushHistory();
    state.shapes = state.shapes.filter((s) => s !== shape);
    nodes.get(shape.id)?.remove();
    nodes.delete(shape.id);
    renumberSteps();
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

  // ---------- frame (capture area) ----------

  // Inside the frame: move it; on a corner handle: resize it against the opposite corner.
  function onCropPointerDown(e) {
    if (e.button !== 0 || state.tool !== 'frame' || e.target.closest('.reset')) return;
    e.stopPropagation();
    startCropDrag(e, cropEl, e.target.dataset?.crop ?? 'move');
  }

  function startCropDrag(e, el, kind) {
    const f = state.crop;
    const fixed = f && kind.length === 2 && [kind.includes('w') ? f.x + f.w : f.x, kind.includes('n') ? f.y + f.h : f.y];
    state.cropDrag = { kind, fixed, x: e.clientX, y: e.clientY, original: f };
    el.setPointerCapture(e.pointerId);
  }

  function dragCrop(x, y) {
    const d = state.cropDrag;
    const [vw, vh] = [innerWidth, innerHeight];
    if (d.kind === 'new') state.crop = frameFrom(d.x, d.y, x, y, vw, vh);
    else if (d.kind === 'move') state.crop = moveFrame(d.original, x - d.x, y - d.y, vw, vh);
    else state.crop = frameFrom(d.fixed[0], d.fixed[1], x, y, vw, vh);
    renderCrop();
  }

  function endCropDrag() {
    const d = state.cropDrag;
    state.cropDrag = null;
    // A click (or a frame too small to mean anything) leaves the frame as it was.
    if (!isFrame(state.crop)) state.crop = d.original;
    state.crop = state.crop && roundBox(state.crop);
    renderCrop();
  }

  function setCrop(frame) {
    state.crop = frame;
    renderCrop();
  }

  function renderCrop() {
    const f = state.crop;
    cropEl.hidden = !f;
    if (!f) return;
    Object.assign(cropEl.style, { left: `${f.x}px`, top: `${f.y}px`, width: `${f.w}px`, height: `${f.h}px` });
    cropEl.classList.toggle('reset-inside', f.y < 40); // no room for the reset button above the frame
  }

  function onResize() {
    if (state.crop) setCrop(fitFrame(state.crop, innerWidth, innerHeight));
    scheduleOutlines();
  }

  // What the capture covers, for the service worker: the frame, or null for the whole viewport.
  function cropSpec() {
    return state.crop && { frame: roundBox(state.crop), viewport: { width: innerWidth, height: innerHeight } };
  }

  // ---------- comment cards ----------

  // Comment cards and step cards: the same card, with an avatar or a step number.
  function isCard(s) {
    return s?.type === 'text' || s?.type === 'step';
  }

  function isCardTool(tool) {
    return tool === 'text' || tool === 'step';
  }

  // Number shown on a step card: its place among the steps, or the next one for a new step.
  function stepNumber(s) {
    return stepNumbers(state.shapes).get(s.id) ?? nextStepNumber(state.shapes);
  }

  function renumberSteps() {
    for (const [id, n] of stepNumbers(state.shapes)) {
      const badge = nodes.get(id)?.querySelector('.avatar.step');
      if (badge) badge.textContent = String(n);
    }
  }

  // A Figma-style comment: avatar pin + card, whose sharp corner sits on the clicked spot.
  // `mark` attaches a new comment to the arrow or box it was started from. `type` 'step'
  // makes a step card instead.
  function openNoteEditor(existing, ax, ay, mark, type = 'text') {
    const shape = existing
      ? { ...existing, font: normalizeFont(existing.font) }
      : { id: uid(), type, ax, ay, text: '', font: { ...state.noteFont }, ...(mark ? { mark } : {}) };
    if (existing) {
      nodes.get(existing.id)?.remove();
      nodes.delete(existing.id);
    }
    select(null);
    const el = noteCard(shape, true);
    if (!existing) el.classList.add('new');
    const ta = el.querySelector('textarea');
    ta.value = shape.text;
    // The card re-aims its arrow's tail as it's placed; a cancelled comment puts it back.
    const arrow = !existing && mark && state.shapes.find((m) => m.id === mark);
    const drawn = arrow && { x1: arrow.x1, y1: arrow.y1, cx: arrow.cx, cy: arrow.cy };
    notesLayer.appendChild(el);
    placeNote(el, shape);
    // Keep the page's own keyboard shortcuts away from what the reviewer types.
    for (const type of ['keydown', 'keyup', 'keypress']) {
      ta.addEventListener(type, (e) => e.stopPropagation());
    }
    ta.addEventListener('input', () => {
      placeNote(el, shape);
      updateNoteTools();
    });
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
    state.textInput = { el, ta, shape, original: existing, arrow, drawn };
    updateNoteTools();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  function commitText({ cancel = false } = {}) {
    const edit = state.textInput;
    if (!edit) return;
    state.textInput = null;
    const { el, shape, original } = edit;
    const text = edit.ta.value.trim();
    const unchanged = original && text === original.text && sameFont(original.font, shape.font);
    if (edit.drawn) {
      // Back to the arrow as drawn: either it stays that way, or the history entry below
      // records it before the comment re-aims it again.
      Object.assign(edit.arrow, edit.drawn);
      if (edit.drawn.cx === undefined) setBend(edit.arrow, null);
      renderShape(edit.arrow);
    }
    if (cancel || unchanged || (!original && !text)) {
      if (original) {
        el.remove();
        renderShape(original);
      } else {
        dismiss(el);
      }
      updateNoteTools();
      return;
    }
    el.remove();
    pushHistory();
    if (original && !text) {
      state.shapes = state.shapes.filter((s) => s !== original);
    } else if (original) {
      Object.assign(original, { text, font: shape.font });
      renderShape(original);
    } else {
      shape.text = text;
      state.shapes.push(shape);
      renderShape(shape);
      showHint(shape); // a standalone comment: the element under its pin
    }
    renumberSteps();
    state.dirty = true;
    updateNoteTools();
  }

  // A cancelled new comment fades out instead of vanishing.
  function dismiss(el) {
    el.classList.remove('new');
    el.classList.add('leaving');
    el.querySelector('textarea')?.blur();
    setTimeout(() => el.remove(), 150);
  }

  function sameFont(a, b) {
    return JSON.stringify(normalizeFont(a)) === JSON.stringify(normalizeFont(b));
  }

  // Wider cards for bigger text, so a large comment doesn't wrap every other word.
  function noteMaxWidth(font) {
    return NOTE_MAX_W + Math.max(0, normalizeFont(font).size - DEFAULT_FONT.size) * 12;
  }

  // ---------- comment tools (popover over the selected or edited comment) ----------

  const FAMILY_NAMES = { sans: 'Sans', serif: 'Serif', mono: 'Mono' };

  function buildNoteTools() {
    const parts = [`<button data-note="edit" title="Edit (Enter)">${icon('edit')}</button><span class="sep"></span>`];
    for (const [f, name] of Object.entries(FAMILY_NAMES)) parts.push(`<button data-family="${f}" title="${name}">Aa</button>`);
    parts.push('<span class="sep"></span>');
    parts.push('<button data-size="-1" title="Smaller">−</button><span class="size"></span><button data-size="1" title="Larger">+</button>');
    parts.push('<button data-note="bold" title="Bold"><b>B</b></button>');
    parts.push('<span class="sep"></span>');
    COLORS.forEach((c, i) => {
      parts.push(
        `<button class="color" data-note-color="${c}" title="Text color" aria-label="Text color: ${COLOR_NAMES[i]}"><span class="swatch" style="background:${c}"></span></button>`,
      );
    });
    parts.push('<span class="sep"></span>');
    parts.push(`<button data-note="delete" title="Delete (Del)">${icon('clear')}</button>`);
    noteTools.innerHTML = parts.join('');
    for (const b of noteTools.querySelectorAll('[data-family]')) b.style.fontFamily = globalThis.PageReviewNotes.FAMILIES[b.dataset.family];
    // Clicking a tool must not take the focus from the comment being typed.
    noteTools.addEventListener('mousedown', preventDefault);
    noteTools.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      const s = noteToolsTarget();
      if (!btn || !s) return;
      const d = btn.dataset;
      const font = normalizeFont(s.font);
      if (d.note === 'edit') openNoteEditor(s);
      else if (d.note === 'delete') deleteNote(s);
      else if (d.family) setNoteFont(s, { family: d.family });
      else if (d.size) setNoteFont(s, { size: stepSize(font.size, Number(d.size)) });
      else if (d.note === 'bold') setNoteFont(s, { weight: font.weight === 700 ? 400 : 700 });
      else if (d.noteColor) setNoteFont(s, { color: d.noteColor });
    });
  }

  function noteToolsTarget() {
    if (state.textInput) return state.textInput.shape;
    const sel = selectedShape();
    return isCard(sel) ? sel : null;
  }

  // The bar follows its card's size: a new card scales in, its avatar image loads, its text
  // wraps. Each of those re-measures it.
  let toolsCard = null;
  const toolsObserver = new ResizeObserver(() => updateNoteTools());
  function watchToolsCard(card) {
    if (card === toolsCard) return;
    toolsObserver.disconnect();
    toolsCard = card;
    if (!card) return;
    toolsObserver.observe(card);
    card.addEventListener('animationend', updateNoteTools, { once: true });
    card.querySelector('.avatar img')?.addEventListener('load', updateNoteTools, { once: true });
  }

  function updateNoteTools() {
    if (!noteTools) return;
    const s = noteToolsTarget();
    const card = s && (state.textInput?.el ?? nodes.get(s.id));
    noteTools.hidden = !card;
    watchToolsCard(card ?? null);
    if (!card) return;
    const f = normalizeFont(s.font);
    noteTools.classList.toggle('editing', !!state.textInput);
    for (const b of noteTools.querySelectorAll('[data-family]')) b.setAttribute('aria-pressed', String(b.dataset.family === f.family));
    for (const b of noteTools.querySelectorAll('[data-note-color]')) b.setAttribute('aria-pressed', String(b.dataset.noteColor === f.color));
    noteTools.querySelector('[data-note="bold"]').setAttribute('aria-pressed', String(f.weight === 700));
    noteTools.querySelector('.size').textContent = String(f.size);
    // Below the card, left-aligned with it; above only when there's no room below; shifted
    // sideways only as far as needed to stay on screen. Measured from the card's layout box,
    // not getBoundingClientRect: a new card is still scaling in when this first runs.
    const r = { left: card.offsetLeft, top: card.offsetTop, bottom: card.offsetTop + card.offsetHeight };
    const t = { width: noteTools.offsetWidth, height: noteTools.offsetHeight };
    const below = r.bottom + NOTE_TOOLS_GAP;
    const above = r.top - NOTE_TOOLS_GAP - t.height;
    const fitsBelow = below + t.height <= innerHeight - NOTE_TOOLS_MARGIN;
    const top = fitsBelow || above < NOTE_TOOLS_MARGIN ? below : above;
    const left = Math.max(NOTE_TOOLS_MARGIN, Math.min(r.left, innerWidth - NOTE_TOOLS_MARGIN - t.width));
    noteTools.style.left = `${left}px`;
    noteTools.style.top = `${top}px`;
  }

  // The picked font also becomes the font for new comments, until the overlay closes.
  function setNoteFont(s, patch) {
    const font = normalizeFont({ ...normalizeFont(s.font), ...patch });
    state.noteFont = font;
    if (state.textInput) {
      const { el, shape } = state.textInput;
      shape.font = font;
      styleNoteBody(el, shape);
      placeNote(el, shape);
    } else {
      pushHistory();
      s.font = font;
      renderShape(s);
      state.dirty = true;
    }
    updateNoteTools();
  }

  function deleteNote(s) {
    if (!state.textInput) return removeShape(s);
    const { original } = state.textInput;
    commitText({ cancel: true });
    if (original) removeShape(original);
  }

  function styleNoteBody(el, s) {
    const body = el.querySelector('textarea, .text');
    Object.assign(body.style, noteCss(s.font), { maxWidth: `${noteMaxWidth(s.font) - NOTE_CHROME_W}px` });
    // Centre the avatar on the first line of text, whichever of the two is taller.
    const line = parseFloat(noteCss(s.font).lineHeight) + TEXT_PAD_Y * 2;
    el.querySelector('.avatar').style.marginTop = `${Math.max(0, (line - AVATAR_PX) / 2)}px`;
    body.style.marginTop = `${Math.max(0, (AVATAR_PX - line) / 2)}px`;
    el.style.maxWidth = `${noteMaxWidth(s.font)}px`;
  }

  function noteCard(s, editing) {
    const el = document.createElement('div');
    el.className = editing ? 'note-card editing' : 'note-card';
    el.dataset.id = s.id;
    el.dataset.type = s.type;
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.innerHTML = icon('text');
    if (s.type === 'step') {
      avatar.classList.add('step');
      avatar.textContent = String(stepNumber(s));
    } else if (avatarSrc) {
      const img = document.createElement('img');
      img.alt = '';
      img.onerror = () => {
        avatarBlocked = true; // e.g. the page's CSP blocks data: images
        avatarSrc = null;
        const n = avatar.querySelector('.n')?.textContent; // drawBadges may already have numbered it
        avatar.classList.remove('photo');
        if (n) avatar.textContent = n;
        else avatar.innerHTML = icon('text');
      };
      img.src = avatarSrc;
      avatar.classList.add('photo');
      avatar.replaceChildren(img);
    }
    const body = document.createElement(editing ? 'textarea' : 'div');
    if (editing) {
      body.rows = 1;
      body.placeholder = 'Add a comment';
    } else {
      body.className = 'text';
      body.textContent = s.text;
    }
    el.append(avatar, body);
    styleNoteBody(el, s);
    return el;
  }

  // Card grows up and to the right from its anchor; flips near the right/top edges.
  // A comment attached to an arrow opens away from the arrow, so it doesn't cover it.
  function placeNote(el, s) {
    const vw = host.clientWidth || innerWidth;
    const vh = host.clientHeight || innerHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const fitsRight = s.ax + noteMaxWidth(s.font) <= vw - EDGE_PX;
    const fitsAbove = s.ay - h >= EDGE_PX;
    let flipX = !fitsRight;
    let flipY = !fitsAbove;
    const arrow = s.mark && state.shapes.find((m) => m.id === s.mark && m.type === 'arrow');
    if (arrow) {
      // Measured from the pin, which stays put while the tail is re-aimed below.
      if (arrow.x2 > s.ax && s.ax - w >= EDGE_PX) flipX = true;
      if (arrow.y2 < s.ay && s.ay + h <= vh - EDGE_PX) flipY = true;
    }
    el.classList.toggle('flip-x', flipX);
    el.classList.toggle('flip-y', flipY);
    const left = Math.max(EDGE_PX, flipX ? s.ax - w : s.ax);
    const top = flipY ? s.ay : s.ay - h;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    // The card's box is what gets linked to nearby marks.
    Object.assign(s, { x: Math.round(left), y: Math.round(top), w: Math.round(w), h: Math.round(h) });
    attachTail(s);
    scheduleOutlines(); // badges keep clear of the card
  }

  // An attached arrow's tail points into the middle of its comment card and stops a few px
  // short of it. Recomputed whenever the card is placed (moved, edited, restyled) or the
  // arrow's bend changes, so the saved shapes carry the same geometry.
  function attachTail(note) {
    const arrow = note.mark && state.shapes.find((m) => m.id === note.mark && m.type === 'arrow');
    if (!arrow || !Number.isFinite(note.w)) return;
    const tail = tailForCard(arrow, boxOf(note), cardRadii(note));
    if (!tail || Object.entries(tail).every(([k, v]) => arrow[k] === v)) return;
    Object.assign(arrow, tail);
    renderShape(arrow);
    if (state.selected === arrow.id) renderSelection();
  }

  function reattachNotes(arrow) {
    const card = state.textInput?.shape;
    if (card?.mark === arrow.id) attachTail(card);
    for (const note of state.shapes) if (note.type === 'text' && note.mark === arrow.id) attachTail(note);
  }

  // Corner radii of a comment card, [top-left, top-right, bottom-right, bottom-left]: the
  // corner at its pin is the sharp one (see .note-card in STYLES).
  function cardRadii(note) {
    const left = Math.abs(note.ax - note.x) < Math.abs(note.ax - (note.x + note.w));
    const top = Math.abs(note.ay - note.y) < Math.abs(note.ay - (note.y + note.h));
    const pin = top ? (left ? 0 : 1) : left ? 3 : 2;
    return [0, 1, 2, 3].map((i) => (i === pin ? CARD_PIN_RADIUS : CARD_RADIUS));
  }

  // ---------- rendering ----------

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  function renderAll() {
    scheduleOutlines();
    shapesLayer.replaceChildren();
    notesLayer.replaceChildren();
    badgeLayer.replaceChildren();
    nodes.clear();
    state.shapes.forEach(renderShape);
    renderSelection();
  }

  function renderShape(s) {
    scheduleOutlines();
    if (isCard(s)) {
      let el = nodes.get(s.id);
      if (el) {
        el.querySelector('.text').textContent = s.text;
        if (s.type === 'step') el.querySelector('.avatar').textContent = String(stepNumber(s));
        styleNoteBody(el, s);
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
    const stroke = { fill: 'none', stroke: s.color, 'stroke-width': STROKE_PX, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
    // Invisible wide stroke so thin lines are easy to grab and erase.
    // Invisible wide stroke: grab or erase a mark up to 6px off its line.
    const hit = { fill: 'none', stroke: 'transparent', 'stroke-width': 12 + STROKE_PX, 'pointer-events': 'stroke' };
    if (s.type === 'pen') {
      const d = penPath(s.points);
      g.append(svgEl('path', { d, ...hit }), svgEl('path', { d, ...stroke }));
    } else if (s.type === 'arrow') {
      const d = arrowPath(s);
      g.append(svgEl('path', { d, ...hit }), svgEl('path', { d, ...stroke }));
    } else if (s.type === 'rect') {
      const r = { x: s.x, y: s.y, width: s.w, height: s.h, rx: 6 };
      g.append(svgEl('rect', { ...r, ...hit, class: 'hit-area' }), svgEl('rect', { ...r, ...stroke }));
    }
  }

  function renderSelection() {
    selectionLayer.replaceChildren();
    for (const el of notesLayer.querySelectorAll('.note-card.selected')) el.classList.remove('selected');
    updateNoteTools();
    const s = selectedShape();
    if (!s) return;
    if (isCard(s)) {
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
    // Arrows: drag either end, or the midpoint to change the bend (onto the straight line to
    // straighten). Boxes: drag a corner to resize.
    const dot = (name, cx, cy) => svgEl('circle', { cx, cy, r: 5, class: 'handle', 'data-handle': name });
    const square = (name, cx, cy) => svgEl('rect', { x: cx - 4.5, y: cy - 4.5, width: 9, height: 9, rx: 2, class: 'handle', 'data-handle': name });
    if (s.type === 'arrow') {
      selectionLayer.append(dot('tail', s.x1, s.y1), dot('head', s.x2, s.y2), dot('bend', ...arrowMidpoint(s)));
    } else if (s.type === 'rect') {
      selectionLayer.append(
        square('nw', s.x, s.y), square('ne', s.x + s.w, s.y), square('se', s.x + s.w, s.y + s.h), square('sw', s.x, s.y + s.h),
      );
    }
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

  // Straight, or a quadratic curve when the arrow has a control point (cx, cy); open chevron head.
  function arrowPath(s) {
    return arrowPathData(s, STROKE_PX);
  }

  function curvePoints(s, n = 16) {
    return Array.from({ length: n + 1 }, (_, i) => {
      const t = i / n;
      const u = 1 - t;
      return [u * u * s.x1 + 2 * u * t * s.cx + t * t * s.x2, u * u * s.y1 + 2 * u * t * s.cy + t * t * s.y2];
    });
  }

  // ---------- linking drawings to DOM elements ----------

  function boxOf(s) {
    if (s.type === 'rect' || isCard(s)) return { x: s.x, y: s.y, w: s.w, h: s.h };
    if (s.type === 'arrow' && !isCurved(s)) {
      return { x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2), w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) };
    }
    const points = s.type === 'arrow' ? curvePoints(s) : s.points;
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
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
    let [fx, fy, tx, ty] = reversed ? [mark.x2, mark.y2, mark.x1, mark.y1] : [mark.x1, mark.y1, mark.x2, mark.y2];
    if (isCurved(mark)) [fx, fy] = [mark.cx, mark.cy]; // a curve arrives along its last tangent
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
    const marks = state.shapes.filter((s) => !isCard(s));
    const texts = state.shapes.filter((s) => s.type === 'text');
    const groups = marks.map((m) => ({ marks: [m], texts: [], reversed: new Set() }));
    const groupOf = (m) => groups.find((g) => g.marks.includes(m));
    const loose = [];

    // A comment belongs to a mark only when it was started from it (`mark`); then it is about
    // that mark's element wherever the card is moved. Any other comment is about the element
    // under its pin.
    for (const t of texts) {
      const m = t.mark && marks.find((mk) => mk.id === t.mark);
      if (!m) {
        loose.push({ marks: [], texts: [t], reversed: new Set() });
        continue;
      }
      const group = groupOf(m);
      group.texts.push(t);
      // A card next to the tip means the arrow was drawn from the target to the comment.
      if (m.type === 'arrow' && pointBoxDist(m.x2, m.y2, boxOf(t)) < pointBoxDist(m.x1, m.y1, boxOf(t))) group.reversed.add(m.id);
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

    let comments = [...groups, ...loose].map(toComment);
    // With a frame, only what shows in it is captured, so only that is numbered.
    if (state.crop) comments = itemsInFrame(state.crop, comments, state.shapes, boxOf);
    comments.sort((a, b) => a.badge.y - b.badge.y || a.badge.x - b.badge.x);
    comments.forEach((c, i) => (c.n = i + 1));
    return comments;
  }

  // Steps, in order, each with the element under its pin (like a standalone comment). With a
  // frame, steps outside it are left out; the rest keep the number shown on their card.
  function buildSteps() {
    const numbers = stepNumbers(state.shapes);
    const steps = state.shapes
      .filter((s) => s.type === 'step')
      .map((s) => {
        const el = linkedElement(s);
        return {
          n: numbers.get(s.id),
          kind: 'step',
          text: s.text,
          region: roundBox(boxOf(s)),
          badge: { x: Math.round(s.ax), y: Math.round(s.ay) },
          shapeIds: [s.id],
          target: el ? describe(el) : null,
        };
      });
    return state.crop ? itemsInFrame(state.crop, steps, state.shapes, boxOf) : steps;
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
      label: globalThis.PageReviewLabel.elementLabel({
        tag: el.tagName,
        role: el.getAttribute('role'),
        type: el.getAttribute('type'),
        value: el.value,
        classes: [...el.classList],
        text: el.innerText ?? el.textContent,
        placeholder: el.getAttribute('placeholder'),
        alt: el.getAttribute('alt'),
        ariaLabel: el.getAttribute('aria-label'),
      }),
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

  // The element a shape is about: under an arrow's head, inside a box or freehand mark, under a
  // standalone comment's pin. A comment attached to a mark has none of its own: it is about
  // its mark's element, never what happens to sit under the card.
  function linkedElement(s) {
    if (!isCard(s)) return targetOf(s, false);
    return s.mark ? null : (elementsAt(s.ax, s.ay)[0] ?? null);
  }

  // Briefly outlines the element a shape links to (after drawing, moving or placing it).
  function showHint(shape) {
    const hint = hintFor(linkedElement(shape));
    if (!hint) return;
    hintsEl.appendChild(hint);
    fadeHint(hint);
  }

  function hintFor(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const hint = document.createElement('div');
    hint.className = 'hint';
    Object.assign(hint.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const label = document.createElement('span');
    label.textContent = shortName(el);
    hint.appendChild(label);
    return hint;
  }

  function fadeHint(hint, after = 1200) {
    setTimeout(() => (hint.style.opacity = '0'), after);
    setTimeout(() => hint.remove(), after + 500);
  }

  // While a standalone comment is dragged, the element under its pin stays outlined.
  let pinHint = null;
  function updatePinHint(note) {
    pinHint?.remove();
    pinHint = note && !note.mark ? hintFor(linkedElement(note)) : null;
    if (pinHint) hintsEl.appendChild(pinHint);
  }

  function endPinHint() {
    if (pinHint) fadeHint(pinHint, 600);
    pinHint = null;
  }

  // ---------- element outlines ("Show elements") ----------

  // Editor preferences, kept apart from the reviews page's `settings`.
  const PREFS_KEY = 'editorPrefs';

  async function loadPrefs() {
    try {
      const { [PREFS_KEY]: prefs } = await chrome.storage.local.get(PREFS_KEY);
      setOutlines(prefs?.outlines === true, false);
    } catch {} // storage unavailable: defaults
  }

  async function setOutlines(on, remember) {
    state.outlines = on;
    toolbar.querySelector('[data-action="outlines"]').setAttribute('aria-pressed', String(on));
    if (!on) state.hover = null;
    scheduleOutlines();
    if (!remember) return;
    try {
      const { [PREFS_KEY]: prefs } = await chrome.storage.local.get(PREFS_KEY);
      await chrome.storage.local.set({ [PREFS_KEY]: { ...prefs, outlines: on } });
    } catch {}
  }

  function onHover(e) {
    if (!state.outlines) return;
    // Nothing under a comment card lights up, not even while the card is dragged.
    const draggingNote = isCard(state.drag?.shape);
    const over = e.type === 'pointermove' && !draggingNote && !e.target.closest?.('.note-card');
    state.hover = over ? { x: e.clientX, y: e.clientY } : null;
    scheduleOutlines();
  }

  // One redraw per frame at most, however many shapes, moves or scroll events come in.
  let outlinesFrame = 0;
  function scheduleOutlines() {
    if (outlinesFrame || !outlinesEl) return;
    outlinesFrame = requestAnimationFrame(() => {
      outlinesFrame = 0;
      drawOutlines();
    });
  }

  // Every element a mark or comment points at, in that mark's colour, plus the one under the
  // cursor. Only these: outlining the whole page would be noise.
  function drawOutlines() {
    if (!state.open) return;
    const found = new Map(); // element -> colour (the first mark wins)
    if (state.outlines) {
      for (const s of state.shapes) {
        const el = linkedElement(s);
        if (el && !found.has(el)) found.set(el, isCard(s) ? HOVER_COLOR : s.color);
      }
      const hovered = state.hover && !isCard(state.drag?.shape) && elementsAt(state.hover.x, state.hover.y)[0];
      if (hovered && !found.has(hovered)) found.set(hovered, HOVER_COLOR);
    }
    outlinesEl.replaceChildren(
      ...[...found].map(([el, color]) => {
        const r = el.getBoundingClientRect();
        const box = document.createElement('div');
        box.className = 'outline';
        box.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;--c:${color}`;
        const label = document.createElement('span');
        label.textContent = shortName(el);
        box.appendChild(label);
        return box;
      }),
    );
    avoidCards();
  }

  // A tag badge that would cover a comment card moves to another corner of its outline.
  function avoidCards() {
    const cards = [...notesLayer.querySelectorAll('.note-card')].map((c) => c.getBoundingClientRect());
    if (!cards.length) return;
    const hits = (r) => cards.some((c) => r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top);
    for (const label of outlinesEl.querySelectorAll('.outline span')) {
      for (const [right, below] of [[false, false], [true, false], [false, true], [true, true]]) {
        label.classList.toggle('right', right);
        label.classList.toggle('below', below);
        if (!hits(label.getBoundingClientRect())) break;
      }
    }
  }

  const HOVER_COLOR = '#1971c2';

  // ---------- save ----------

  // Shows the page the way it is captured: editor UI hidden, comments numbered.
  // renderAll() (plus removing the "capturing" class) brings the editor back.
  async function enterCapture() {
    select(null);
    const comments = buildComments();
    drawBadges(comments);
    hintsEl.replaceChildren();
    host.classList.add('capturing');
    await nextFrames(2);
    return comments;
  }

  // Copies exactly what Save would capture to the clipboard, without saving a review.
  function copyImage() {
    commitText();
    if (state.saving) return;
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      toast("Can't copy images on this page: the browser only allows it on https pages.");
      return;
    }
    state.saving = true;
    const png = (async () => {
      await enterCapture();
      try {
        const res = await chrome.runtime.sendMessage({ type: 'capture', crop: cropSpec() });
        if (!res?.ok) throw new Error(res?.error ?? 'no response');
        return dataUrlToBlob(res.dataUrl);
      } finally {
        host.classList.remove('capturing');
        renderAll();
      }
    })();
    png.catch(() => {}); // reported through the clipboard write below
    // Written right away, still inside the click, with the image to follow: browsers only
    // let a page write to the clipboard as a direct result of the user's action.
    navigator.clipboard
      .write([new ClipboardItem({ 'image/png': png })])
      .then(() => toast('Screenshot copied.'), copyFailed)
      .finally(() => (state.saving = false));
  }

  // A review as saved (without the screenshot). With a frame the image is cropped to it: marks
  // outside it are left out, and the coordinates are moved to match the image.
  function reviewData(comments, steps, crop) {
    const items = [...comments, ...steps];
    const framed = crop ? cropItems(crop.frame, items, state.shapes, boxOf) : { items, shapes: state.shapes };
    return {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      url: location.href,
      title: document.title,
      createdAt: new Date().toISOString(),
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      scroll: { x: Math.round(scrollX), y: Math.round(scrollY) },
      ...(crop ? { frame: crop.frame } : {}),
      comments: framed.items.filter((c) => c.kind !== 'step'),
      steps: framed.items.filter((c) => c.kind === 'step'),
      shapes: framed.shapes,
    };
  }

  // What a save records, to tell whether anything changed since the last one.
  function editSnapshot() {
    return JSON.stringify([state.shapes, state.crop]);
  }

  // The review as Markdown for an AI agent (comments with their elements, then the steps),
  // from the same generator as review.md. Saves nothing. When the review was saved since the
  // last change and its files were written (Downloads or the local server), the text names
  // the screenshot file; otherwise it says the screenshot isn't attached.
  function copyForAgent() {
    commitText();
    if (state.saving) return;
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      toast("Can't copy on this page: the browser only allows it on https pages.");
      return;
    }
    const savedId = state.saved?.snapshot === editSnapshot() ? state.saved.id : null;
    const review = reviewData(buildComments(), buildSteps(), cropSpec());
    const text = chrome.runtime.sendMessage({ type: 'agent-markdown', review, savedId }).then((res) => {
      if (!res?.ok) throw new Error(res?.error ?? 'no response');
      return new Blob([res.markdown], { type: 'text/plain' });
    });
    text.catch(() => {}); // reported through the clipboard write below
    // Written right away, still inside the click, with the text to follow (see copyImage).
    navigator.clipboard.write([new ClipboardItem({ 'text/plain': text })]).then(() => toast('Markdown for the agent copied.'), copyFailed);
  }

  function copyFailed(err) {
    toast(
      err?.name === 'NotAllowedError'
        ? "Couldn't copy: the browser blocked the clipboard. Click the page and try again."
        : `Couldn't copy: ${err?.message ?? err}`,
    );
  }

  function dataUrlToBlob(url) {
    const [meta, data] = url.split(',');
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    return new Blob([bytes], { type: meta.slice(5).split(';')[0] });
  }

  async function save() {
    commitText();
    if (state.saving) return;
    if (!state.shapes.length) {
      toast('Nothing to save yet — draw something first.');
      return;
    }
    state.saving = true;
    const crop = cropSpec();
    const steps = buildSteps();
    const comments = await enterCapture();
    try {
      const review = reviewData(comments, steps, crop);
      const res = await chrome.runtime.sendMessage({ type: 'save', review, crop });
      if (!res?.ok) throw new Error(res?.error ?? 'no response');
      state.dirty = false;
      state.saved = { id: review.id, snapshot: editSnapshot() };
      host.classList.remove('capturing');
      const n = comments.length;
      const what = `${n} comment${n === 1 ? '' : 's'}${steps.length ? `, ${steps.length} step${steps.length === 1 ? '' : 's'}` : ''}`;
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
      if (avatar?.classList.contains('photo')) {
        const n = document.createElement('span');
        n.className = 'n';
        n.textContent = String(c.n);
        avatar.append(n);
        continue;
      }
      if (avatar) {
        avatar.textContent = String(c.n);
        continue;
      }
      const area = state.crop ?? { x: 0, y: 0, w: innerWidth, h: innerHeight }; // badges stay inside the image
      const x = clamp(c.badge.x - 14, area.x + 14, area.x + area.w - 14);
      const y = clamp(c.badge.y - 14, area.y + 14, area.y + area.h - 14);
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
    const mod = e.ctrlKey || e.metaKey;
    if (onCopyMenuKey(e)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (state.textInput && e.composedPath().includes(state.textInput.ta)) {
      // Typing a comment: saving still works (it keeps what was typed), and so does undo/redo
      // while a new comment is still empty, e.g. right after drawing an arrow.
      const blank = !state.textInput.original && !state.textInput.ta.value.trim();
      const history = mod && (e.code === 'KeyZ' || e.code === 'KeyY');
      if (!(mod && e.code === 'KeyS') && !(history && blank)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === 'KeyS') save();
      else {
        commitText({ cancel: true });
        if (e.code === 'KeyY' || e.shiftKey) redo();
        else undo();
      }
      return;
    }
    const plain = !mod && !e.altKey;
    const sel = selectedShape();
    const tool = plain && TOOLS.find((t) => t.code === e.code);
    let handled = true;
    if (mod && e.code === 'KeyZ') e.shiftKey ? redo() : undo();
    else if (mod && e.code === 'KeyY') redo();
    else if (mod && e.code === 'KeyS') save();
    else if (e.key === 'Escape') {
      if (state.tool === 'frame' && state.crop) setCrop(null); // back to the full page
      else if (sel) select(null);
      else close();
    }
    else if (sel && (e.key === 'Delete' || e.key === 'Backspace')) removeShape(sel);
    else if (sel && NUDGE[e.key]) {
      const step = e.shiftKey ? 10 : 1;
      pushHistory();
      move(sel, NUDGE[e.key][0] * step, NUDGE[e.key][1] * step);
      renderSelection();
      state.dirty = true;
    } else if (sel && plain && e.key === 'Enter' && isCard(sel)) openNoteEditor(sel);
    else if (tool) setTool(tool.id);
    else if (plain && /^Digit[1-6]$/.test(e.code)) setColor(COLORS[Number(e.code.slice(5)) - 1]);
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
