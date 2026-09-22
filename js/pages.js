/* coferry — 페이지 트리 / 상태 / 검색 / 보관함 */
'use strict';

const EMOJIS = ['📄','🎨','🖼','✏️','📐','🧵','👜','👕','🧢','👟','💡','🔥','⭐️','📦','🚚','🧪','📊','📌','✅','🗓','🏷','🎯','💬','🔧','🌈','🧷','📷','🖌','🪡','🧶','🛍','💎'];

function pageById(id) { return S.pages.find(p => p.id === id); }
function childrenOf(pid) {
  return S.pages.filter(p => !p.archived && (p.parent_id || null) === (pid || null))
    .sort((a, b) => (a.sort || 0) - (b.sort || 0));
}
function nextSort(pid) {
  const c = childrenOf(pid); return c.length ? (c[c.length - 1].sort || 0) + 1000 : 1000;
}

/* ===== 사이드바 ===== */
function renderFilter() {
  const box = $('#statusFilter'); box.textContent = '';
  const mk = (id, label, color) => {
    const b = document.createElement('button');
    b.className = 'fpill' + (S.filter === id ? ' on' : '');
    b.textContent = label;
    if (S.filter === id && color) { b.style.background = color; b.style.borderColor = color; }
    b.onclick = () => { S.filter = id; saveUI(); renderFilter(); renderTree(); };
    box.appendChild(b);
  };
  mk('all', '전체');
  CF.STATUS.forEach(s => mk(s.id, s.label, s.color));
}

function renderTree() {
  const nav = $('#pageTree'); nav.textContent = '';
  const ui = lsGet(K.ui, {}); const collapsed = ui.collapsed || {};
  const match = p => S.filter === 'all' || p.status === S.filter;
  const hasMatchingDesc = p => childrenOf(p.id).some(c => match(c) || hasMatchingDesc(c));

  const walk = (pid, depth) => {
    childrenOf(pid).forEach(p => {
      if (!match(p) && !hasMatchingDesc(p)) return;
      const kids = childrenOf(p.id);
      const row = document.createElement('div');
      row.className = 't-item' + (p.id === S.pageId ? ' on' : '') + (p.status === 'done' ? ' done' : '');
      row.dataset.pid = p.id;
      row.style.paddingLeft = (8 + depth * 13) + 'px';

      const tw = document.createElement('span');
      tw.className = 'tw';
      tw.textContent = kids.length ? (collapsed[p.id] ? '▸' : '▾') : '';
      tw.onclick = e => {
        e.stopPropagation();
        if (!kids.length) return;
        collapsed[p.id] = !collapsed[p.id];
        const u = lsGet(K.ui, {}); u.collapsed = collapsed; lsSet(K.ui, u);
        renderTree();
      };
      row.appendChild(tw);

      const ic = document.createElement('span'); ic.textContent = p.icon || '📄'; row.appendChild(ic);

      const tt = document.createElement('span');
      tt.className = 'tt'; tt.textContent = p.title || '제목 없음'; row.appendChild(tt);

      const dot = document.createElement('span');
      dot.className = 't-dot'; dot.style.background = statusOf(p.status).color;
      dot.title = statusOf(p.status).label; row.appendChild(dot);

      const add = document.createElement('button');
      add.className = 't-add'; add.textContent = '＋'; add.title = '하위 페이지';
      add.onclick = e => { e.stopPropagation(); newPage(p.id); };
      row.appendChild(add);

      const del = document.createElement('button');
      del.className = 't-del'; del.textContent = '✕'; del.title = '보관함으로 이동';
      del.onclick = e => {
        e.stopPropagation();
        if (confirm('"' + (p.title || '제목 없음') + '" 을(를) 보관함으로 옮길까요?')) archivePage(p);
      };
      row.appendChild(del);

      row.onclick = () => openPage(p.id);
      nav.appendChild(row);
      if (!collapsed[p.id]) walk(p.id, depth + 1);
    });
  };
  walk(null, 0);
  if (!nav.childNodes.length) {
    const d = document.createElement('div');
    d.style.cssText = 'color:var(--fg3);font-size:12px;padding:10px 8px';
    d.textContent = S.filter === 'all' ? '아직 페이지가 없습니다' : '해당 상태의 페이지가 없습니다';
    nav.appendChild(d);
  }
}

function saveUI() {
  const u = lsGet(K.ui, {});
  u.filter = S.filter; u.fs = S.fs; u.showComments = S.showComments; u.sideOpen = S.sideOpen;
  lsSet(K.ui, u);
}

/* ===== 페이지 CRUD ===== */
function newPage(parentId) {
  const p = {
    id: uid(), parent_id: parentId || null, title: '', icon: '📄',
    status: 'todo', sort: nextSort(parentId || null), archived: false,
    created_by: S.me, updated_by: S.me, created_at: nowISO(), updated_at: nowISO()
  };
  S.pages.push(p);
  Q.up('cof_pages', p);
  if (parentId) { const u = lsGet(K.ui, {}); u.collapsed = u.collapsed || {}; u.collapsed[parentId] = false; lsSet(K.ui, u); }
  renderTree();
  openPage(p.id, true);
}

async function openPage(id, focusTitle) {
  const p = pageById(id); if (!p) return;
  S.pageId = id; S.view = 'page'; S.cTarget = null;
  lsSet(K.last, id);
  $('#emptyState').classList.add('hidden');
  $('#filesView').classList.add('hidden');
  $('#archiveView').classList.add('hidden');
  $('#pageWrap').classList.remove('hidden');
  $('#sidebar').classList.remove('open');
  renderTree();
  renderPageHead();

  $('#editor').textContent = '';
  let rows = null;
  try {
    rows = await sb('cof_blocks?select=*&page_id=eq.' + id + ALIVE + '&order=sort.asc&limit=3000');
  } catch (e) { toast('블록을 불러오지 못했습니다'); }
  if (S.pageId !== id) return;              // 그 사이 다른 페이지로 옮겼으면 버린다
  S.blocks = overlayPending('cof_blocks', (rows || []).filter(b => !isTomb(b.id)), id)
    .filter(b => b.type)
    .sort((a, b) => (a.sort || 0) - (b.sort || 0));
  if (!S.blocks.length) S.blocks = [makeBlock(id, 'text', 1000)];
  renderEditor(true);
  renderPageHead();                       // 블록 로드 후 ✅ N/M 카운터 최신화
  loadComments(id);
  if (typeof syncCurrentPageEvents === 'function') try { syncCurrentPageEvents(); } catch (e) {}
  if (focusTitle) setTimeout(() => { const t = $('#pageTitle'); t.focus(); }, 40);
}

function renderPageHead() {
  const p = pageById(S.pageId); if (!p) return;
  $('#pageIcon').textContent = p.icon || '📄';
  const t = $('#pageTitle');
  // 다른 페이지로 옮겼으면 제목 칸에 커서가 있어도 반드시 갈아끼운다
  // (안 그러면 이전 페이지 제목이 남아 다음 타이핑이 새 페이지 제목을 덮어쓴다)
  if (t.dataset.pid !== p.id) { t.dataset.pid = p.id; t.textContent = p.title || ''; }
  else if (document.activeElement !== t) t.textContent = p.title || '';

  const meta = $('#pageMeta'); meta.textContent = '';
  const st = statusOf(p.status);
  const chip = document.createElement('button');
  chip.className = 'status-chip'; chip.style.background = st.color;
  chip.textContent = st.label; chip.title = '상태 변경';
  chip.onclick = () => openStatusMenu(p, chip);
  meta.appendChild(chip);

  // 📅 날짜 필드 — 설정하면 최하단 캘린더에 자동 등록
  const dateWrap = document.createElement('label');
  dateWrap.className = 'page-date' + (p.event_date ? ' set' : '');
  dateWrap.title = '이 페이지의 일정 · 캘린더에 자동 등록';
  const dateIc = document.createElement('span'); dateIc.className = 'pd-ic'; dateIc.textContent = '🗓';
  dateWrap.appendChild(dateIc);
  const dateInp = document.createElement('input');
  dateInp.type = 'date'; dateInp.className = 'pd-in';
  dateInp.value = p.event_date || '';
  dateInp.onchange = () => {
    p.event_date = dateInp.value || null;
    savePage(p, ['event_date']);
    dateWrap.classList.toggle('set', !!p.event_date);
    if (dateClear) dateClear.classList.toggle('hidden', !p.event_date);
  };
  dateWrap.appendChild(dateInp);
  const dateClear = document.createElement('button');
  dateClear.type = 'button'; dateClear.className = 'pd-clear' + (p.event_date ? '' : ' hidden');
  dateClear.textContent = '✕'; dateClear.title = '일정 지우기';
  dateClear.onclick = e => {
    e.preventDefault();
    p.event_date = null; savePage(p, ['event_date']);
    dateInp.value = ''; dateWrap.classList.remove('set'); dateClear.classList.add('hidden');
  };
  dateWrap.appendChild(dateClear);
  meta.appendChild(dateWrap);

  const info = document.createElement('span');
  const done = S.blocks.filter(b => b.type === 'todo' && b.checked).length;
  const todo = S.blocks.filter(b => b.type === 'todo').length;
  info.textContent = ago(p.updated_at) + ' · ' + (p.updated_by || '-')
    + (todo ? '   ✅ ' + done + '/' + todo : '');
  meta.appendChild(info);
}

function openStatusMenu(p, anchor) {
  const box = $('#blockMenu'); box.textContent = '';
  CF.STATUS.forEach(s => {
    const b = document.createElement('button');
    if (p.status === s.id) b.className = 'on';
    const dot = document.createElement('span'); dot.className = 'si-dot'; dot.style.background = s.color;
    b.appendChild(dot);
    const lbl = document.createElement('span'); lbl.textContent = s.label; b.appendChild(lbl);
    b.onclick = () => {
      p.status = s.id; savePage(p, ['status']);
      renderPageHead(); renderTree();
      box.classList.add('hidden');
    };
    box.appendChild(b);
  });
  popAt(box, anchor.getBoundingClientRect());
}

function archivePage(p) {
  p.archived = true; savePage(p, ['archived']);
  toast('"' + (p.title || '제목 없음') + '" 보관함으로 이동', '되돌리기', () => {
    p.archived = false; savePage(p, ['archived']); renderTree();
  });
  if (S.pageId === p.id) { S.pageId = null; $('#pageWrap').classList.add('hidden'); $('#emptyState').classList.remove('hidden'); }
  renderTree();
}

async function deletePage(p) {
  // soft delete — deleted_at 만 세팅. cof_history 트리거가 스냅샷 자동 보관.
  // 되돌리기 5초 유예 (Undo 스낵바). 블록·피드백은 pages.id 참조라 페이지가 살면 자동 복원.
  const snap = Object.assign({}, p);
  const wasPage = S.pageId === p.id;
  S.pages = S.pages.filter(x => x.id !== p.id);
  if (Array.isArray(S.events)) S.events = S.events.filter(e => e.source_page_id !== p.id);
  if (typeof renderCalendar === 'function') renderCalendar();
  Q.del('cof_pages', p.id, snap);
  if (wasPage) { S.pageId = null; $('#pageWrap').classList.add('hidden'); $('#emptyState').classList.remove('hidden'); }
  renderTree();
  toast('"' + (p.title || '제목 없음') + '" 삭제됨 · 5초 안에 되돌릴 수 있어요', '되돌리기', () => {
    delTomb(p.id);
    const row = Object.assign({}, snap, { deleted_at: null, updated_at: nowISO(), updated_by: S.me });
    Q.up('cof_pages', row);
    S.pages.push(Object.assign({}, snap, { deleted_at: null }));
    renderTree();
    if (typeof renderCalendar === 'function') renderCalendar();
    toast('페이지 복원됨');
  }, 5000);
}

/* ===== 제목 / 아이콘 ===== */
function bindPageHead() {
  const t = $('#pageTitle');
  t.addEventListener('input', () => {
    const p = pageById(S.pageId); if (!p) return;
    p.title = t.textContent.replace(/\n+$/, '');
    savePage(p, ['title']);
    renderTreeTitleOnly(p);
  });
  t.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); focusBlock(S.blocks[0] && S.blocks[0].id, 'end'); }
  });

  $('#pageMenu').onclick = e => {
    const p = pageById(S.pageId); if (!p) return;
    const box = $('#blockMenu'); box.textContent = '';
    const mk = (icon, label, action, danger) => {
      const b = document.createElement('button');
      const ic = document.createElement('span'); ic.className = 'si'; ic.textContent = icon; b.appendChild(ic);
      const lb = document.createElement('span'); lb.textContent = label; b.appendChild(lb);
      if (danger) lb.style.color = 'var(--err)';
      b.onclick = () => { box.classList.add('hidden'); action(); };
      box.appendChild(b);
    };
    mk('📎', '파일 올리기', () => pickFiles(null));
    mk('🎨', '아이콘 변경', () => $('#pageIcon').click());
    const sep = document.createElement('div'); sep.className = 'sep'; box.appendChild(sep);
    mk('🗄', '보관함으로 이동', () => archivePage(p));
    mk('🗑', '완전 삭제', () => deletePage(p), true);
    popAt(box, e.currentTarget.getBoundingClientRect());
  };

  $('#pageIcon').onclick = e => {
    const box = $('#emojiPick'); box.textContent = '';
    EMOJIS.forEach(em => {
      const b = document.createElement('button'); b.textContent = em;
      b.onclick = () => {
        const p = pageById(S.pageId); if (p) { p.icon = em; savePage(p, ['icon']); renderPageHead(); renderTree(); }
        box.classList.add('hidden');
      };
      box.appendChild(b);
    });
    popAt(box, e.currentTarget.getBoundingClientRect());
  };
}
function renderTreeTitleOnly(p) {
  // 타이핑 중 트리 전체 재렌더 대신 해당 줄 텍스트만 교체
  const rows = $$('#pageTree .t-item.on .tt');
  if (rows[0]) rows[0].textContent = p.title || '제목 없음';
}
function popAt(box, rect) {
  box.classList.remove('hidden');
  const w = box.offsetWidth, h = box.offsetHeight;
  let x = rect.left, y = rect.bottom + 6;
  if (x + w > innerWidth - 12) x = innerWidth - w - 12;
  if (y + h > innerHeight - 12) y = Math.max(12, rect.top - h - 6);
  box.style.left = x + 'px'; box.style.top = y + 'px';
  setTimeout(() => {
    const off = ev => { if (!box.contains(ev.target)) { box.classList.add('hidden'); document.removeEventListener('mousedown', off); } };
    document.addEventListener('mousedown', off);
  }, 0);
}

/* ===== 검색 ===== */
let _searchT = null;
function bindSearch() {
  const box = $('#searchBox'), out = $('#searchResult');
  box.addEventListener('input', () => {
    clearTimeout(_searchT);
    const q = box.value.trim();
    if (!q) { out.classList.add('hidden'); out.textContent = ''; return; }
    _searchT = setTimeout(async () => {
      out.textContent = ''; out.classList.remove('hidden');
      const hits = [];
      S.pages.filter(p => !p.archived && (p.title || '').toLowerCase().includes(q.toLowerCase()))
        .slice(0, 8).forEach(p => hits.push({ pid: p.id, title: p.title || '제목 없음', sub: '제목' }));
      try {
        const rows = await sb('cof_blocks?select=page_id,content&content=ilike.'
          + encodeURIComponent('*' + q + '*') + '&limit=20');
        (rows || []).forEach(r => {
          const p = pageById(r.page_id); if (!p || p.archived) return;
          hits.push({ pid: r.page_id, title: p.title || '제목 없음', sub: r.content.slice(0, 70) });
        });
      } catch (e) {}
      if (!hits.length) { out.textContent = ''; const d = document.createElement('div'); d.className = 'sr-item'; d.textContent = '결과 없음'; out.appendChild(d); return; }
      const seen = new Set();
      hits.slice(0, 16).forEach(h => {
        const key = h.pid + h.sub; if (seen.has(key)) return; seen.add(key);
        const d = document.createElement('div'); d.className = 'sr-item';
        const b = document.createElement('b'); b.textContent = h.title; d.appendChild(b);
        const s = document.createElement('small'); s.textContent = h.sub; d.appendChild(s);
        d.onclick = () => { out.classList.add('hidden'); box.value = ''; openPage(h.pid); };
        out.appendChild(d);
      });
    }, 220);
  });
}

/* ===== 보관함 ===== */
function showArchive() {
  S.view = 'archive';
  $('#pageWrap').classList.add('hidden'); $('#emptyState').classList.add('hidden');
  $('#filesView').classList.add('hidden');
  const v = $('#archiveView'); v.classList.remove('hidden'); v.textContent = '';
  const h = document.createElement('h2'); h.textContent = '🗄 보관함'; v.appendChild(h);
  const s = document.createElement('div'); s.className = 'sub';
  s.textContent = '삭제한 페이지 · 여기서 복원하거나 완전히 지울 수 있어요.'; v.appendChild(s);
  const list = S.pages.filter(p => p.archived);
  if (!list.length) { const e = document.createElement('div'); e.className = 'c-empty'; e.textContent = '비어 있습니다'; v.appendChild(e); return; }
  list.forEach(p => {
    const row = document.createElement('div'); row.className = 'arow';
    const i = document.createElement('span'); i.textContent = p.icon || '📄'; row.appendChild(i);
    const b = document.createElement('b'); b.textContent = p.title || '제목 없음'; row.appendChild(b);
    const t = document.createElement('span'); t.style.cssText = 'color:var(--fg3);font-size:12px';
    t.textContent = ago(p.updated_at); row.appendChild(t);
    const r = document.createElement('button'); r.textContent = '복원';
    r.onclick = () => { p.archived = false; savePage(p, ['archived']); renderTree(); showArchive(); };
    row.appendChild(r);
    const d = document.createElement('button'); d.textContent = '완전삭제';
    d.onclick = async () => {
      if (!confirm('"' + (p.title || '제목 없음') + '" 을(를) 블록·피드백까지 완전히 지울까요?\n(cof_history 이력만 남고 실제 행은 삭제됩니다)')) return;
      const snap = Object.assign({}, p);
      S.pages = S.pages.filter(x => x.id !== p.id);
      try {
        await sb('cof_blocks?page_id=eq.' + p.id, { method: 'DELETE' });
        await sb('cof_comments?page_id=eq.' + p.id, { method: 'DELETE' });
      } catch (e) {}
      Q.hardDel('cof_pages', p.id, snap);
      renderTree(); showArchive();
    };
    row.appendChild(d);
    v.appendChild(row);
  });
}

/* ===== 원격 반영 ===== */
function onRemotePage(payload) {
  const r = payload.new || payload.old; if (!r) return;
  if (payload.eventType === 'DELETE' || r.deleted_at) { S.pages = S.pages.filter(p => p.id !== r.id); renderTree(); return; }
  if (isTomb(r.id)) return;
  if (Q.pendingIds().has(r.id)) return;          // 내가 방금 고친 건 원격이 덮지 않게
  const i = S.pages.findIndex(p => p.id === r.id);
  if (i < 0) S.pages.push(r); else S.pages[i] = r;
  renderTree();
  if (r.id === S.pageId && document.activeElement !== $('#pageTitle')) renderPageHead();
}
function onRemoteSetting(payload) {
  const r = payload.new; if (!r) return;
  S.settings[r.key] = r.value;
  if (r.key === 'logo') applyLogo();
}
