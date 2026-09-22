/* coferry — 노션식 블록 에디터 (타이핑 즉시 저장 · 재렌더로 글자 안 삼킴) */
'use strict';

const TYPES = [
  { id: 'text',    icon: '¶',  label: '본문',        ph: "내용을 입력하세요.  '/' 로 블록 추가" },
  { id: 'h1',      icon: 'H1', label: '큰 제목',     ph: '큰 제목' },
  { id: 'h2',      icon: 'H2', label: '중간 제목',   ph: '중간 제목' },
  { id: 'h3',      icon: 'H3', label: '작은 제목',   ph: '작은 제목' },
  { id: 'todo',    icon: '☑',  label: '할 일',       ph: '할 일' },
  { id: 'bullet',  icon: '•',  label: '글머리 기호', ph: '목록' },
  { id: 'quote',   icon: '❝',  label: '인용',        ph: '인용' },
  { id: 'divider', icon: '—',  label: '구분선',      ph: '' }
];
const typeOf = id => TYPES.find(t => t.id === id) || TYPES[0];

function makeBlock(pageId, type, sort, extra) {
  const b = Object.assign({
    id: uid(), page_id: pageId, type: type || 'text', content: '',
    checked: false, size: 'md', indent: 0, meta: {}, sort: sort,
    updated_by: S.me, updated_at: nowISO()
  }, extra || {});
  Q.up('cof_blocks', b);
  return b;
}
function sortBetween(prev, next) {
  if (prev == null && next == null) return 1000;
  if (prev == null) return next - 1000;
  if (next == null) return prev + 1000;
  return (prev + next) / 2;
}
function blockIndex(id) { return S.blocks.findIndex(b => b.id === id); }

/* ===== 렌더 ===== */
let _renderPending = false;
function editorFocused() {
  const a = document.activeElement;
  return !!(a && (a.closest && a.closest('#editor') || a.id === 'pageTitle'));
}
// force: 페이지를 갈아끼울 때는 제목 칸에 커서가 있어도 본문을 반드시 그린다
function renderEditor(force) {
  if (!force && editorFocused()) { _renderPending = true; return; }
  _renderPending = false;
  const ed = $('#editor'); ed.textContent = '';
  S.blocks.sort((a, b) => (a.sort || 0) - (b.sort || 0));
  S.blocks.forEach(b => ed.appendChild(blockEl(b)));
  refreshCommentCounts();
}
document.addEventListener('focusout', () => {
  setTimeout(() => { if (_renderPending && !editorFocused()) renderEditor(); }, 120);
});

function blockEl(b) {
  const row = document.createElement('div');
  row.className = 'blk t-' + b.type + ' s-' + (b.size || 'md') + (b.checked ? ' checked' : '');
  row.dataset.id = b.id;
  row.style.marginLeft = ((b.indent || 0) * 26) + 'px';

  /* 좌측 도구 */
  const gut = document.createElement('div'); gut.className = 'blk-gut';
  const plus = document.createElement('button'); plus.className = 'gut-b'; plus.textContent = '＋';
  plus.title = '아래에 블록 추가';
  plus.onclick = () => insertAfter(b.id, 'text', true);
  gut.appendChild(plus);
  const menu = document.createElement('button'); menu.className = 'gut-b'; menu.textContent = '⋮⋮';
  menu.title = '블록 설정 (종류·글자 크기·삭제)';
  menu.onclick = e => openBlockMenu(b, e.currentTarget.getBoundingClientRect());
  gut.appendChild(menu);
  row.appendChild(gut);

  if (b.type === 'divider') {
    const hr = document.createElement('hr'); hr.className = 'hr'; row.appendChild(hr);
    return row;
  }
  if (b.type === 'image') { row.appendChild(imageNode(b)); row.appendChild(cbtn(b)); return row; }
  if (b.type === 'file')  { row.appendChild(fileNode(b));  row.appendChild(cbtn(b)); return row; }

  if (b.type === 'todo') {
    const c = document.createElement('input');
    c.type = 'checkbox'; c.className = 'blk-chk'; c.checked = !!b.checked;
    c.onchange = () => {
      b.checked = c.checked; saveBlock(b, ['checked']);
      row.classList.toggle('checked', b.checked);
      renderPageHead();
    };
    row.appendChild(c);
  } else if (b.type === 'bullet') {
    const m = document.createElement('span'); m.className = 'blk-mark'; m.textContent = '•';
    row.appendChild(m);
  }

  const c = document.createElement('div');
  c.className = 'blk-c';
  c.contentEditable = 'plaintext-only';
  if (c.contentEditable !== 'plaintext-only') c.contentEditable = 'true';
  c.dataset.ph = typeOf(b.type).ph;
  c.textContent = b.content || '';
  bindEditable(c, b);
  row.appendChild(c);
  row.appendChild(cbtn(b));
  return row;
}
function cbtn(b) {
  const btn = document.createElement('button');
  btn.className = 'blk-cbtn'; btn.dataset.cfor = b.id;
  btn.textContent = '💬'; btn.title = '이 줄에 피드백';
  btn.onclick = () => startComment(b);
  return btn;
}

/* ===== 편집 바인딩 ===== */
function bindEditable(el, b) {
  el.addEventListener('input', () => {
    const raw = el.innerText.replace(/\n$/, '');
    if (mdShortcut(el, b, raw)) return;
    if (raw === '/' ) { openSlash(b, el); }
    b.content = raw;
    saveBlock(b, ['content']);
  });

  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      // 빈 목록/할 일에서 Enter → 목록 탈출 (노션과 동일)
      if ((b.type === 'todo' || b.type === 'bullet' || b.type === 'quote') && !el.innerText.trim()) {
        changeType(b, 'text'); return;
      }
      const tail = splitTail(el);
      b.content = el.innerText.replace(/\n$/, '');
      saveBlock(b, ['content']);
      const nt = (b.type === 'h1' || b.type === 'h2' || b.type === 'h3' || b.type === 'quote') ? 'text' : b.type;
      insertAfter(b.id, nt, true, tail, b.indent);
      return;
    }
    if (e.key === 'Backspace' && caretAtStart(el)) {
      const i = blockIndex(b.id);
      if (!el.innerText.trim() && S.blocks.length > 1) {
        e.preventDefault();
        removeBlock(b.id);
        const prev = S.blocks[Math.max(0, i - 1)];
        if (prev) focusBlock(prev.id, 'end');
        return;
      }
      if (b.type !== 'text' && !el.innerText.trim()) { e.preventDefault(); changeType(b, 'text'); return; }
      if (b.indent > 0 && !el.innerText.trim()) { e.preventDefault(); b.indent--; saveBlock(b, ['indent']); renderEditorKeepFocus(b.id); return; }
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      b.indent = Math.max(0, Math.min(4, (b.indent || 0) + (e.shiftKey ? -1 : 1)));
      saveBlock(b, ['indent']);
      const row = el.closest('.blk'); if (row) row.style.marginLeft = (b.indent * 26) + 'px';
      return;
    }
    if (e.key === 'ArrowUp' && caretAtStart(el)) {
      const i = blockIndex(b.id); if (i > 0) { e.preventDefault(); focusBlock(S.blocks[i - 1].id, 'end'); }
    }
    if (e.key === 'ArrowDown' && caretAtEnd(el)) {
      const i = blockIndex(b.id); if (i < S.blocks.length - 1) { e.preventDefault(); focusBlock(S.blocks[i + 1].id, 'end'); }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (b.type !== 'todo') changeType(b, 'todo');
      else { b.checked = !b.checked; saveBlock(b, ['checked']); el.closest('.blk').classList.toggle('checked', b.checked); renderPageHead(); }
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault(); moveBlock(b, e.key === 'ArrowUp' ? -1 : 1);
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === '.' )) { e.preventDefault(); cycleSize(b); }
  });

  el.addEventListener('paste', e => {
    const items = e.clipboardData && e.clipboardData.items;
    if (items) {
      const imgs = Array.from(items).filter(i => i.kind === 'file');
      if (imgs.length) {
        e.preventDefault();
        imgs.forEach(i => { const f = i.getAsFile(); if (f) uploadAndInsert(f, b.id); });
        return;
      }
    }
    e.preventDefault();
    const txt = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
    const lines = txt.split(/\r?\n/);
    if (lines.length > 1) {
      document.execCommand('insertText', false, lines[0]);
      b.content = el.innerText.replace(/\n$/, ''); saveBlock(b, ['content']);
      let anchor = b.id;
      lines.slice(1).forEach(l => { const nb = insertAfter(anchor, 'text', false, l, b.indent); anchor = nb.id; });
      renderEditorKeepFocus(anchor, 'end');
    } else {
      document.execCommand('insertText', false, txt);
      b.content = el.innerText.replace(/\n$/, ''); saveBlock(b, ['content']);
    }
  });
}

/* 마크다운 단축 */
function mdShortcut(el, b, raw) {
  const map = [['# ', 'h1'], ['## ', 'h2'], ['### ', 'h3'], ['- ', 'bullet'], ['* ', 'bullet'],
               ['[] ', 'todo'], ['[ ] ', 'todo'], ['> ', 'quote']];
  for (const [pre, t] of map) {
    if (raw === pre) { el.textContent = ''; b.content = ''; changeType(b, t); return true; }
  }
  if (raw === '---' || raw === '***') {
    el.textContent = ''; b.content = '';
    changeType(b, 'divider');
    insertAfter(b.id, 'text', true);
    return true;
  }
  return false;
}

/* ===== 구조 변경 ===== */
function insertAfter(afterId, type, focus, content, indent) {
  const i = blockIndex(afterId);
  const prev = S.blocks[i], next = S.blocks[i + 1];
  const b = makeBlock(S.pageId, type, sortBetween(prev ? prev.sort : null, next ? next.sort : null),
    { content: content || '', indent: indent || 0 });
  S.blocks.splice(i + 1, 0, b);
  renderEditorKeepFocus(focus ? b.id : null, 'start');
  return b;
}
function removeBlock(id) {
  const i = blockIndex(id); if (i < 0) return;
  const b = S.blocks[i];
  S.blocks.splice(i, 1);
  Q.del('cof_blocks', id);
  const row = $('#editor').querySelector('.blk[data-id="' + id + '"]');
  if (row) row.remove();
  renderPageHead();
  if (typeof removeAutoEventsForBlock === 'function') try { removeAutoEventsForBlock(id); } catch (e) {}
}
function changeType(b, t) {
  b.type = t;
  if (t === 'divider') b.content = '';
  saveBlock(b, ['type', 'content']);
  renderEditorKeepFocus(t === 'divider' ? null : b.id, 'end');
  renderPageHead();
}
function cycleSize(b) {
  b.size = b.size === 'sm' ? 'md' : b.size === 'md' ? 'lg' : 'sm';
  saveBlock(b, ['size']);
  const row = $('#editor').querySelector('.blk[data-id="' + b.id + '"]');
  if (row) row.className = row.className.replace(/ s-\w+/, ' s-' + b.size);
  toast('글자 크기: ' + (b.size === 'sm' ? '작게' : b.size === 'lg' ? '크게' : '보통'));
}
function moveBlock(b, dir) {
  const i = blockIndex(b.id), j = i + dir;
  if (j < 0 || j >= S.blocks.length) return;
  const other = S.blocks[j];
  const t = b.sort; b.sort = other.sort; other.sort = t;
  saveBlock(b, ['sort']); saveBlock(other, ['sort']);
  renderEditorKeepFocus(b.id, 'end');
}

/* 포커스 보존 재렌더 */
function renderEditorKeepFocus(focusId, pos) {
  const ed = $('#editor'); ed.textContent = '';
  S.blocks.sort((a, b) => (a.sort || 0) - (b.sort || 0));
  S.blocks.forEach(b => ed.appendChild(blockEl(b)));
  refreshCommentCounts();
  if (focusId) focusBlock(focusId, pos || 'end');
}
function focusBlock(id, pos) {
  if (!id) return;
  const row = $('#editor').querySelector('.blk[data-id="' + id + '"]');
  if (!row) return;
  const c = row.querySelector('.blk-c'); if (!c) return;
  c.focus();
  const r = document.createRange(), sel = getSelection();
  r.selectNodeContents(c); r.collapse(pos !== 'end' ? true : false);
  sel.removeAllRanges(); sel.addRange(r);
  c.scrollIntoView({ block: 'nearest' });
}
function caretAtStart(el) {
  const s = getSelection(); if (!s.rangeCount) return false;
  const r = s.getRangeAt(0).cloneRange(); r.selectNodeContents(el);
  r.setEnd(s.getRangeAt(0).startContainer, s.getRangeAt(0).startOffset);
  return r.toString().length === 0;
}
function caretAtEnd(el) {
  const s = getSelection(); if (!s.rangeCount) return false;
  const r = s.getRangeAt(0).cloneRange(); r.selectNodeContents(el);
  r.setStart(s.getRangeAt(0).endContainer, s.getRangeAt(0).endOffset);
  return r.toString().length === 0;
}
function splitTail(el) {
  const s = getSelection(); if (!s.rangeCount) return '';
  const r = s.getRangeAt(0).cloneRange();
  r.setEndAfter(el.lastChild || el);
  const tail = r.toString();
  if (tail) r.deleteContents();
  return tail;
}

/* ===== 슬래시 / 블록 메뉴 ===== */
function openSlash(b, el) {
  const box = $('#slashMenu'); box.textContent = '';
  TYPES.forEach(t => {
    const btn = document.createElement('button');
    const i = document.createElement('span'); i.className = 'si'; i.textContent = t.icon; btn.appendChild(i);
    btn.appendChild(document.createTextNode(t.label));
    btn.onclick = () => { el.textContent = ''; b.content = ''; box.classList.add('hidden'); changeType(b, t.id); };
    box.appendChild(btn);
  });
  const sep = document.createElement('div'); sep.className = 'sep'; box.appendChild(sep);
  const up = document.createElement('button');
  const ui = document.createElement('span'); ui.className = 'si'; ui.textContent = '📎'; up.appendChild(ui);
  up.appendChild(document.createTextNode('파일 · 이미지 올리기'));
  up.onclick = () => { el.textContent = ''; b.content = ''; saveBlock(b, ['content']); box.classList.add('hidden'); pickFiles(b.id); };
  box.appendChild(up);

  const rect = el.getBoundingClientRect();
  popAt(box, { left: rect.left, bottom: rect.bottom, top: rect.top });
}
function openBlockMenu(b, rect) {
  const box = $('#blockMenu'); box.textContent = '';
  const add = (icon, label, hint, fn) => {
    const btn = document.createElement('button');
    const i = document.createElement('span'); i.className = 'si'; i.textContent = icon; btn.appendChild(i);
    btn.appendChild(document.createTextNode(label));
    if (hint) { const d = document.createElement('span'); d.className = 'sd'; d.textContent = hint; btn.appendChild(d); }
    btn.onclick = () => { box.classList.add('hidden'); fn(); };
    box.appendChild(btn);
  };
  if (b.type !== 'image' && b.type !== 'file' && b.type !== 'divider') {
    TYPES.forEach(t => { if (t.id !== b.type) add(t.icon, t.label, '', () => changeType(b, t.id)); });
    const sep = document.createElement('div'); sep.className = 'sep'; box.appendChild(sep);
    add('🔡', '글자 작게', b.size === 'sm' ? '현재' : '', () => { b.size = 'sm'; saveBlock(b, ['size']); renderEditorKeepFocus(b.id); });
    add('🔤', '글자 보통', b.size === 'md' ? '현재' : '', () => { b.size = 'md'; saveBlock(b, ['size']); renderEditorKeepFocus(b.id); });
    add('🔠', '글자 크게', b.size === 'lg' ? '현재' : '', () => { b.size = 'lg'; saveBlock(b, ['size']); renderEditorKeepFocus(b.id); });
    const sep2 = document.createElement('div'); sep2.className = 'sep'; box.appendChild(sep2);
  }
  add('💬', '피드백 달기', '', () => startComment(b));
  add('⬆️', '위로 이동', '⌘⇧↑', () => moveBlock(b, -1));
  add('⬇️', '아래로 이동', '⌘⇧↓', () => moveBlock(b, 1));
  add('🗑', '삭제', '', () => {
    const snap = Object.assign({}, b), idx = blockIndex(b.id);
    removeBlock(b.id);
    toast('블록 삭제', '되돌리기', () => {
      delete tombs()[snap.id];
      const t = lsGet(K.tomb, {}); delete t[snap.id]; lsSet(K.tomb, t);
      S.blocks.splice(idx, 0, snap); Q.up('cof_blocks', snap); renderEditorKeepFocus(snap.id);
    });
  });
  popAt(box, rect);
}

/* ===== 원격 블록 반영 ===== */
function onRemoteBlock(payload) {
  const r = payload.new || payload.old; if (!r) return;
  if (r.page_id !== S.pageId) return;
  if (isTomb(r.id)) return;
  if (Q.pendingIds().has(r.id)) return;               // 내 미저장 편집 보호

  if (payload.eventType === 'DELETE') {
    const i = blockIndex(r.id);
    if (i >= 0) { S.blocks.splice(i, 1); const row = $('#editor').querySelector('.blk[data-id="' + r.id + '"]'); if (row) row.remove(); }
    if (typeof removeAutoEventsForBlock === 'function') try { removeAutoEventsForBlock(r.id); } catch (e) {}
    return;
  }
  if (r.updated_by === S.me) return;

  const i = blockIndex(r.id);
  if (i < 0) {
    S.blocks.push(r);
    if (editorFocused()) { _renderPending = true; return; }
    renderEditor();
    flash(r.id);
    return;
  }
  const old = S.blocks[i];
  S.blocks[i] = r;
  const row = $('#editor').querySelector('.blk[data-id="' + r.id + '"]');
  const c = row && row.querySelector('.blk-c');
  const structural = old.type !== r.type || old.indent !== r.indent || old.sort !== r.sort;
  if (structural || !row) {
    if (editorFocused()) { _renderPending = true; return; }
    renderEditor(); flash(r.id); return;
  }
  if (c && document.activeElement !== c && c.textContent !== r.content) c.textContent = r.content;
  if (row) {
    row.classList.toggle('checked', !!r.checked);
    const chk = row.querySelector('.blk-chk'); if (chk) chk.checked = !!r.checked;
    row.className = row.className.replace(/ s-\w+/, ' s-' + (r.size || 'md'));
  }
  flash(r.id);
  renderPageHead();
  if (typeof syncBlockEvents === 'function') try { syncBlockEvents(r); } catch (e) {}
}
function flash(id) {
  const row = $('#editor').querySelector('.blk[data-id="' + id + '"]');
  if (!row) return;
  row.classList.add('flash');
  setTimeout(() => row.classList.remove('flash'), 1200);
}
