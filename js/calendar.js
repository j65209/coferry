/* coferry — 최하단 캘린더
   · 월간 뷰 · 수동 이벤트 CRUD · 블록 내용에서 날짜 자동 감지
   · 저장은 코어 큐(Q)로 → 실시간·오프라인 방어 동일 */
'use strict';

/* ===== 상태 ===== */
S.events = [];
S.calCursor = new Date();
S.calSelected = null;

/* ===== 날짜 유틸 ===== */
function ymd(d) {
  d = d instanceof Date ? d : new Date(d);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + dd;
}
function parseYmd(s) { return new Date(s + 'T00:00:00'); }
function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function isValidDate(y, m, d) {
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* ===== 블록 내용에서 날짜 뽑기 ===== */
/*  · 2026-09-25 / 2026.09.25 / 2026/09/25
    · 9월 25일 / 9월25일
    · 9/25 (년 미기재 → 반년 이상 지났으면 내년으로 간주)                 */
function extractDates(text) {
  if (!text) return [];
  const now = new Date();
  const curY = now.getFullYear();
  const cutoff = new Date(now.getTime() - 180 * 86400000);
  const seen = new Set(), out = [];
  const push = (y, mo, d, raw) => {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return;
    let yr = (y == null) ? curY : y;
    if (yr < 100) yr += 2000;
    let dt = new Date(yr, mo - 1, d);
    if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return; // 2/30 같은 존재 안 하는 날짜
    if (y == null && dt < cutoff) { yr = curY + 1; dt = new Date(yr, mo - 1, d); }
    const key = ymd(dt);
    if (seen.has(key)) return;
    seen.add(key); out.push({ date: key, raw: raw });
  };
  // ISO / 점 / 슬래시 (연도 포함)
  text.replace(/(\d{4})[\-.\/](\d{1,2})[\-.\/](\d{1,2})/g,
    (m, y, mo, d) => (push(+y, +mo, +d, m), m));
  // 한국어 M월 D일
  text.replace(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/g,
    (m, mo, d) => (push(null, +mo, +d, m), m));
  // 짧은 슬래시 M/D (연도 없음)
  text.replace(/(?<![\d\-.\/])(\d{1,2})\/(\d{1,2})(?![\d\-.\/])/g,
    (m, mo, d) => (push(null, +mo, +d, m), m));
  return out;
}

/* 이벤트 제목: 블록 내용에서 감지된 날짜 표현 제거 후 사용 */
function eventTitleFromBlock(b, rawDate) {
  let t = (b.content || '').trim();
  if (rawDate) t = t.replace(new RegExp(escRe(rawDate), 'g'), '').replace(/\s+/g, ' ').trim();
  if (!t) t = (b.content || '').trim();
  return t.slice(0, 80);
}

/* ===== 로드 ===== */
async function loadEvents() {
  try {
    const rows = await sb('cof_events?select=*' + ALIVE + '&order=event_date.asc&limit=3000');
    S.events = overlayPending('cof_events', (rows || []).filter(e => !isTomb(e.id)));
  } catch (e) { /* 실패해도 재시도 폴링 */ }
  renderCalendar();
}

/* 페이지 날짜 필드 → 가상 이벤트 (S.events 를 건드리지 않고 렌더 시점에 병합) */
function pageDateEvents() {
  if (!Array.isArray(S.pages)) return [];
  return S.pages
    .filter(p => p && p.event_date && !p.archived)
    .map(p => ({
      id: 'page:' + p.id,          // 렌더 key 용, 저장 X
      event_date: p.event_date,
      title: (p.icon ? p.icon + ' ' : '') + (p.title || '(제목 없음)'),
      color: '',
      source_page_id: p.id,
      source_block_id: null,
      _kind: 'page'                // 스타일 분기용
    }));
}
function allEvents() {
  const base = (S.events || []).filter(e => !e._deleted);
  return base.concat(pageDateEvents());
}

/* ===== 렌더 ===== */
function renderCalendar() {
  const grid = $('#calGrid'); if (!grid) return;
  const cur = S.calCursor;
  const y = cur.getFullYear(), m = cur.getMonth();
  const title = $('#calTitle'); if (title) title.textContent = y + '년 ' + (m + 1) + '월';

  grid.textContent = '';
  ['일','월','화','수','목','금','토'].forEach((d, i) => {
    const c = document.createElement('div');
    c.className = 'cal-dow' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '');
    c.textContent = d;
    grid.appendChild(c);
  });

  const startDow = new Date(y, m, 1).getDay();
  const dim = daysInMonth(y, m);
  const prevDim = daysInMonth(y, m - 1);
  const today = ymd(new Date());

  for (let i = 0; i < startDow; i++) {
    const c = document.createElement('div');
    c.className = 'cal-day muted';
    const d = prevDim - startDow + 1 + i;
    const n = document.createElement('span'); n.className = 'cal-num'; n.textContent = d; c.appendChild(n);
    grid.appendChild(c);
  }

  const merged = allEvents();
  for (let d = 1; d <= dim; d++) {
    const dateStr = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const dow = new Date(y, m, d).getDay();
    const c = document.createElement('div');
    c.className = 'cal-day'
      + (dateStr === today ? ' today' : '')
      + (S.calSelected === dateStr ? ' selected' : '')
      + (dow === 0 ? ' sun' : dow === 6 ? ' sat' : '');
    c.dataset.date = dateStr;

    const n = document.createElement('span'); n.className = 'cal-num'; n.textContent = d; c.appendChild(n);

    const evList = merged.filter(e => e.event_date === dateStr);
    evList.slice(0, 3).forEach(e => {
      const chip = document.createElement('div');
      chip.className = 'cal-chip'
        + (e._kind === 'page' ? ' page' : (e.source_block_id ? ' auto' : ''));
      chip.title = e.title || '(제목 없음)';
      chip.textContent = e.title || '(제목 없음)';
      if (e.color) chip.style.background = e.color;
      chip.onclick = ev => {
        ev.stopPropagation();
        if (e._kind === 'page') { openPage(e.source_page_id); return; }
        S.calSelected = dateStr; renderCalendar(); renderCalDayPanel(e.id);
      };
      c.appendChild(chip);
    });
    if (evList.length > 3) {
      const more = document.createElement('div');
      more.className = 'cal-more';
      more.textContent = '+' + (evList.length - 3);
      c.appendChild(more);
    }

    c.onclick = () => { S.calSelected = dateStr; renderCalendar(); renderCalDayPanel(); };
    c.ondblclick = () => addManualEvent(dateStr);
    grid.appendChild(c);
  }

  const total = startDow + dim;
  const trail = (7 - (total % 7)) % 7;
  for (let i = 1; i <= trail; i++) {
    const c = document.createElement('div');
    c.className = 'cal-day muted';
    const n = document.createElement('span'); n.className = 'cal-num'; n.textContent = i; c.appendChild(n);
    grid.appendChild(c);
  }

  renderCalDayPanel();
}

function renderCalDayPanel(focusEventId) {
  const panel = $('#calDayPanel'); if (!panel) return;
  panel.textContent = '';
  if (!S.calSelected) {
    panel.classList.add('empty');
    const h = document.createElement('div'); h.className = 'cdp-hint';
    h.textContent = '날짜를 눌러 일정을 추가하거나 확인하세요.';
    panel.appendChild(h);
    return;
  }
  panel.classList.remove('empty');

  const head = document.createElement('div'); head.className = 'cdp-head';
  const d = parseYmd(S.calSelected);
  const dowKor = '일월화수목금토'[d.getDay()];
  head.textContent = d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + dowKor + ')';
  const add = document.createElement('button'); add.className = 'cdp-add';
  add.textContent = '＋ 일정 추가';
  add.onclick = () => addManualEvent(S.calSelected);
  head.appendChild(add);
  panel.appendChild(head);

  const list = allEvents()
    .filter(e => e.event_date === S.calSelected)
    .sort((a, b) => {
      const r = k => k._kind === 'page' ? 0 : (k.source_block_id ? 2 : 1);
      return r(a) - r(b);
    });

  if (!list.length) {
    const empty = document.createElement('div'); empty.className = 'cdp-empty';
    empty.textContent = '아직 일정이 없습니다.';
    panel.appendChild(empty);
    return;
  }

  list.forEach(e => {
    const row = document.createElement('div'); row.className = 'cdp-row';
    row.dataset.id = e.id;

    if (e._kind === 'page') {
      const tag = document.createElement('span'); tag.className = 'cdp-tag page'; tag.textContent = '페이지';
      tag.title = '이 페이지가 일정 날짜로 등록됨';
      row.appendChild(tag);
      const t = document.createElement('a'); t.className = 'cdp-title link';
      t.textContent = e.title || '(제목 없음)';
      t.onclick = () => { if (e.source_page_id) openPage(e.source_page_id); };
      row.appendChild(t);
      const del = document.createElement('button'); del.className = 'cdp-del'; del.textContent = '✕';
      del.title = '이 페이지의 일정 지우기';
      del.onclick = () => {
        const p = pageById(e.source_page_id); if (!p) return;
        p.event_date = null; savePage(p, ['event_date']);
        renderCalendar();
        if (p.id === S.pageId) renderPageHead();
      };
      row.appendChild(del);
      panel.appendChild(row);
      return;
    }

    if (e.source_block_id) {
      const tag = document.createElement('span'); tag.className = 'cdp-tag auto'; tag.textContent = '자동';
      tag.title = '페이지 본문에서 자동 감지된 일정';
      row.appendChild(tag);
      const t = document.createElement('a'); t.className = 'cdp-title link';
      t.textContent = e.title || '(제목 없음)';
      t.onclick = () => { if (e.source_page_id) openPage(e.source_page_id); };
      row.appendChild(t);
    } else {
      const tag = document.createElement('span'); tag.className = 'cdp-tag'; tag.textContent = '수동';
      row.appendChild(tag);
      const inp = document.createElement('input'); inp.className = 'cdp-title-in';
      inp.value = e.title || ''; inp.placeholder = '일정 제목';
      inp.oninput = () => {
        e.title = inp.value;
        e.updated_at = nowISO(); e.updated_by = S.me;
        Q.up('cof_events', { id: e.id, event_date: e.event_date, title: e.title,
          color: e.color || '', source_page_id: null, source_block_id: null,
          updated_at: e.updated_at, updated_by: e.updated_by });
        // 캘린더 그리드는 재렌더 없이 칩 텍스트만
        updateGridChip(e);
      };
      row.appendChild(inp);
    }

    const del = document.createElement('button'); del.className = 'cdp-del'; del.textContent = '✕';
    del.title = e.source_block_id ? '이 자동 일정 지우기 (본문의 날짜를 지우면 자동으로 사라져요)' : '삭제';
    del.onclick = () => {
      const snap = Object.assign({}, e);
      e._deleted = true;
      Q.del('cof_events', e.id, snap);
      S.events = S.events.filter(x => x.id !== e.id);
      renderCalendar();
    };
    row.appendChild(del);

    panel.appendChild(row);
    if (focusEventId && e.id === focusEventId) {
      const inp = row.querySelector('.cdp-title-in');
      if (inp) setTimeout(() => { inp.focus(); inp.select(); }, 20);
    }
  });
}

function updateGridChip(e) {
  const cell = document.querySelector('.cal-day[data-date="' + e.event_date + '"]');
  if (!cell) return;
  const chips = cell.querySelectorAll('.cal-chip');
  // 재렌더가 무겁지 않으니 간단히 전체 재렌더 (칩 순서 유지 위해)
  renderCalendar();
}

/* ===== 수동 이벤트 추가 ===== */
function addManualEvent(dateStr) {
  const e = {
    id: uid(),
    event_date: dateStr,
    title: '',
    color: '',
    source_page_id: null,
    source_block_id: null,
    updated_by: S.me,
    updated_at: nowISO()
  };
  S.events.push(e);
  Q.up('cof_events', e);
  S.calSelected = dateStr;
  renderCalendar();
  renderCalDayPanel(e.id);
}

/* ===== 블록 ↔ 자동 이벤트 동기화 ===== */
function syncBlockEvents(b) {
  if (!b || !b.id) return;
  // 파일·이미지·구분선은 텍스트가 없음 → 기존 자동 이벤트 정리만
  const skip = (b.type === 'divider' || b.type === 'image' || b.type === 'file');
  const dates = skip ? [] : extractDates(b.content || '');

  const existing = S.events.filter(e => e.source_block_id === b.id && !e._deleted);
  const wanted = new Map(); // date -> raw
  dates.forEach(d => { if (!wanted.has(d.date)) wanted.set(d.date, d.raw); });

  // 사라진 날짜 삭제
  existing.forEach(e => {
    if (!wanted.has(e.event_date)) {
      const snap = Object.assign({}, e);
      e._deleted = true;
      Q.del('cof_events', e.id, snap);
      S.events = S.events.filter(x => x.id !== e.id);
    }
  });

  // 새로 감지된 날짜 upsert
  wanted.forEach((raw, date) => {
    const title = eventTitleFromBlock(b, raw) || '(제목 없음)';
    const cur = existing.find(e => e.event_date === date);
    if (cur) {
      if (cur.title !== title || cur.source_page_id !== b.page_id) {
        cur.title = title; cur.source_page_id = b.page_id;
        cur.updated_at = nowISO(); cur.updated_by = S.me;
        Q.up('cof_events', {
          id: cur.id, event_date: cur.event_date, title: cur.title, color: cur.color || '',
          source_page_id: cur.source_page_id, source_block_id: b.id,
          updated_at: cur.updated_at, updated_by: cur.updated_by
        });
      }
    } else {
      const e = {
        id: uid(),
        event_date: date,
        title: title,
        color: '',
        source_page_id: b.page_id,
        source_block_id: b.id,
        updated_by: S.me,
        updated_at: nowISO()
      };
      S.events.push(e);
      Q.up('cof_events', e);
    }
  });

  if (dates.length || existing.length) renderCalendar();
}
function removeAutoEventsForBlock(blockId) {
  if (!blockId) return;
  const evts = S.events.filter(e => e.source_block_id === blockId);
  if (!evts.length) return;
  evts.forEach(e => {
    const snap = Object.assign({}, e);
    e._deleted = true;
    Q.del('cof_events', e.id, snap);
  });
  S.events = S.events.filter(e => e.source_block_id !== blockId);
  renderCalendar();
}

/* ===== 원격 반영 ===== */
function onRemoteEvent(payload) {
  const r = payload.new || payload.old; if (!r) return;
  if (payload.eventType === 'DELETE' || r.deleted_at) {
    S.events = S.events.filter(e => e.id !== r.id);
    renderCalendar();
    return;
  }
  if (isTomb(r.id)) return;
  if (Q.pendingIds().has(r.id)) return;
  const i = S.events.findIndex(e => e.id === r.id);
  if (i < 0) S.events.push(r); else S.events[i] = r;
  renderCalendar();
}

/* ===== 바인딩 ===== */
function bindCalendar() {
  $('#calPrev').onclick = () => {
    S.calCursor = new Date(S.calCursor.getFullYear(), S.calCursor.getMonth() - 1, 1);
    renderCalendar();
  };
  $('#calNext').onclick = () => {
    S.calCursor = new Date(S.calCursor.getFullYear(), S.calCursor.getMonth() + 1, 1);
    renderCalendar();
  };
  $('#calToday').onclick = () => {
    S.calCursor = new Date();
    S.calSelected = ymd(new Date());
    renderCalendar();
  };
  const toggle = $('#calToggle');
  if (toggle) toggle.onclick = () => {
    const sec = $('#calendarSection');
    sec.classList.toggle('collapsed');
    toggle.textContent = sec.classList.contains('collapsed') ? '펼치기 ▾' : '접기 ▴';
    const ui = lsGet(K.ui, {});
    ui.calCollapsed = sec.classList.contains('collapsed');
    lsSet(K.ui, ui);
  };
}

/* 열려있는 페이지의 블록 전부에 대해 한 번씩 sync — 최초 로딩용 */
function syncCurrentPageEvents() {
  if (!Array.isArray(S.blocks)) return;
  S.blocks.forEach(b => syncBlockEvents(b));
}
