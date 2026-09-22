/* coferry design center — core: 설정 / 인증 / 상태 / 즉시저장 엔진 / 실시간 */
'use strict';

const CF = {
  VER: '2',
  PIN: '2580',
  URL: 'https://ckyjkxbqsyjoqpuqwoce.supabase.co',
  KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNreWpreGJxc3lqb3FwdXF3b2NlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0MjI2NzEsImV4cCI6MjA5Mzk5ODY3MX0.C8WIGqf-zIYkCq0dGWTMjIYuPM-IVInMn1p6FaWbVKA',
  BUCKET: 'coferry',
  MEMBERS: [
    { id: 'osy', name: '오수영', role: '과장',     color: '#4f46e5' },
    { id: 'psh', name: '박시호', role: '디자이너', color: '#e0508f' },
    { id: 'jsh', name: '전승훈', role: '대표',     color: '#0ea5e9' },
    { id: 'jsb', name: '전수빈', role: '대표',     color: '#f97316' },
    { id: 'ceo', name: '대표',   role: '',         color: '#0ea5e9' }   // 이전 호환 (오피스앱에서 me 미지정 폴백)
  ],
  STATUS: [
    { id: 'todo',     label: '대기',   color: '#8b8a85' },
    { id: 'progress', label: '진행중', color: '#2f6df6' },
    { id: 'review',   label: '검토',   color: '#b45bd8' },
    { id: 'done',     label: '완료',   color: '#0f9d58' },
    { id: 'hold',     label: '보류',   color: '#e08a1e' }
  ],
  MAX_MB: 50                 // Supabase 무료 플랜 하드 캡 (Pro 로 올리면 50 GB 까지)
};
const K = {
  auth: 'cof_auth', ver: 'cof_auth_ver', me: 'cof_me', ui: 'cof_ui',
  queue: 'cof_queue', tomb: 'cof_tomb', last: 'cof_last_page',
  hist: 'cof_history_v1'
};
/* 살아있는(deleted_at is null) 행만 fetch — 어느 select 든 이걸 붙인다 */
const ALIVE = '&deleted_at=is.null';

/* ===== 상태 ===== */
const S = {
  me: null, pages: [], pageId: null, blocks: [], comments: [],
  settings: {}, filter: 'all', view: 'page',
  fs: 100, theme: 'light', showComments: true, showResolved: false, sideOpen: true,
  cTarget: null, online: [], booted: false,
  // 이 브라우저 탭의 세션 ID. onRemote 에서 자기 UPDATE 이벤트만 정확히 걸러내려고 사용.
  // 이름(updated_by) 이 겹쳐도 (대표 2인, 게스트 등) 서로의 편집이 잘 보인다.
  sid: (crypto.randomUUID ? crypto.randomUUID() : (Date.now() + '-' + Math.random().toString(36).slice(2))).slice(0, 22)
};

/* ===== 유틸 ===== */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    }));
const esc = s => String(s == null ? '' : s);
const nowISO = () => new Date().toISOString();
const member = n => CF.MEMBERS.find(m => m.name === n) || { name: n || '?', color: '#9b9a95' };
const statusOf = id => CF.STATUS.find(s => s.id === id) || CF.STATUS[0];
function hhmm(d) {
  d = d ? new Date(d) : new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function ago(ts) {
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 60) return '방금';
  if (s < 3600) return Math.floor(s / 60) + '분 전';
  if (s < 86400) return Math.floor(s / 3600) + '시간 전';
  const d = new Date(ts);
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hhmm(d);
}
function fsize(b) {
  if (!b) return '';
  if (b < 1024) return b + 'B';
  if (b < 1048576) return (b / 1024).toFixed(0) + 'KB';
  return (b / 1048576).toFixed(1) + 'MB';
}
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

let _toastT = null;
function toast(msg, actionLabel, action, ms) {
  const el = $('#toast'); if (!el) return;
  el.textContent = msg; el.classList.remove('hidden');
  if (actionLabel) {
    const b = document.createElement('button');
    b.textContent = actionLabel;
    b.onclick = () => { el.classList.add('hidden'); action && action(); };
    el.appendChild(b);
  }
  clearTimeout(_toastT);
  _toastT = setTimeout(() => el.classList.add('hidden'), ms || 3800);
}

/* ===== Supabase REST ===== */
async function sb(path, opts) {
  opts = opts || {};
  const h = {
    apikey: CF.KEY, Authorization: 'Bearer ' + CF.KEY,
    'Content-Type': 'application/json'
  };
  Object.assign(h, opts.headers || {});
  const r = await fetch(CF.URL + '/rest/v1/' + path, {
    method: opts.method || 'GET', headers: h, body: opts.body,
    keepalive: !!opts.keepalive
  });
  if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 300));
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const sbUpsert = (table, rows, conflict, keepalive) => sb(
  table + '?on_conflict=' + (conflict || 'id'),
  { method: 'POST', body: JSON.stringify(rows), keepalive: keepalive,
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });

/* ===== 삭제 툼스톤 (되살아남 방지) ===== */
function tombs() {
  const t = lsGet(K.tomb, {}); const cut = Date.now() - 86400000; let ch = false;
  for (const k in t) if (t[k] < cut) { delete t[k]; ch = true; }
  if (ch) lsSet(K.tomb, t);
  return t;
}
function addTomb(id) { const t = tombs(); t[id] = Date.now(); lsSet(K.tomb, t); }
function delTomb(id) { const t = lsGet(K.tomb, {}); delete t[id]; lsSet(K.tomb, t); }
const isTomb = id => !!tombs()[id];

/* ===== rolling history (콘솔 복구용 · 최근 40개) =====
   업무일지 5중 방어 중 "롤링 스냅샷" 이식. 삭제·수정 직전 상태를 로컬에 40개까지 순환 보관.
   콘솔: cofHistory() 확인 / cofRestoreFromLocal(idx) 로컬 복구 / cofRestoreFromServer(entity,id) 서버 이력 조회 */
function _cofPushHistory(rec) {
  try {
    const arr = lsGet(K.hist, []);
    arr.unshift(Object.assign({ ts: Date.now(), by: (typeof S !== 'undefined' && S.me) || '' }, rec));
    lsSet(K.hist, arr.slice(0, 40));
  } catch (e) {}
}
window.cofHistory = function () {
  const arr = lsGet(K.hist, []);
  console.table(arr.map((r, i) => ({
    idx: i, when: new Date(r.ts).toLocaleString('ko-KR'),
    op: r.op, entity: r.entity, id: (r.snap && r.snap.id) || '',
    preview: r.snap ? String(r.snap.content || r.snap.title || '').slice(0, 60) : ''
  })));
  return arr;
};
window.cofRestoreFromLocal = function (idx) {
  const arr = lsGet(K.hist, []); const r = arr[idx];
  if (!r || !r.snap) { console.warn('history 없음'); return; }
  const row = Object.assign({}, r.snap, { deleted_at: null, updated_at: nowISO(), updated_by: S.me });
  delTomb(r.snap.id); Q.up(r.entity, row);
  console.log('[coferry] 로컬 스냅샷으로 복원 예약:', r.entity, r.snap.id);
};
window.cofRestoreFromServer = async function (entity, id) {
  const rows = await sb('cof_history?select=*&entity=eq.' + entity + '&id=eq.' + id + '&order=logged_at.desc&limit=1');
  if (!rows || !rows.length) { console.warn('서버 이력 없음'); return; }
  const snap = rows[0].snapshot;
  const row = Object.assign({}, snap, { deleted_at: null, updated_at: nowISO(), updated_by: S.me });
  delTomb(id); Q.up(entity === 'pages' ? 'cof_pages' : entity === 'blocks' ? 'cof_blocks' : entity === 'comments' ? 'cof_comments' : 'cof_events', row);
  console.log('[coferry] 서버 스냅샷으로 복원 예약:', entity, id);
};

/* ===== 즉시저장 엔진 (애플 메모 방식) =====
   - 로컬 반영은 타이핑 즉시, 서버 전송은 큐로 묶어서
   - 큐는 localStorage 에 보존 → 새로고침/오프라인에도 안 사라짐
   - "저장됨" 배지는 서버 응답 후에만 표시                        */
const Q = {
  ops: lsGet(K.queue, []),
  timer: null, hard: null, busy: false, lastOk: 0, fails: 0,

  persist() { lsSet(K.queue, this.ops.slice(0, 600)); },

  up(table, row) {
    // cof_settings 는 key PK 라 client_id 컬럼 없음, 나머지는 자동 세팅
    if (table !== 'cof_settings' && !row.client_id) row.client_id = S.sid;
    const i = this.ops.findIndex(o => o.k === 'up' && o.t === table && o.r.id === row.id);
    if (i >= 0) this.ops[i].r = Object.assign(this.ops[i].r, row);
    else this.ops.push({ k: 'up', t: table, r: row });
    this.persist(); this.schedule();
  },
  /* soft delete — deleted_at 필드만 세팅해서 upsert (hard delete 안 함).
     서버 트리거가 cof_history 에 스냅샷 자동 기록. 로컬도 rolling history 남긴다. */
  del(table, id, snap) {
    if (snap) _cofPushHistory({ op: 'del', entity: table.replace(/^cof_/, ''), snap: snap });
    const row = { id: id, deleted_at: nowISO(), updated_at: nowISO(), updated_by: (typeof S !== 'undefined' && S.me) || '' };
    this.up(table, row);
    addTomb(id);
  },
  /* 관리자용 hard delete — 보관함 "완전삭제" 같은 회수 불가 경로 전용 */
  hardDel(table, id, snap) {
    if (snap) _cofPushHistory({ op: 'purge', entity: table.replace(/^cof_/, ''), snap: snap });
    this.ops = this.ops.filter(o => !(o.t === table && o.r && o.r.id === id));
    this.ops.push({ k: 'del', t: table, r: { id: id } });
    addTomb(id); this.persist(); this.schedule();
  },
  pendingIds() {
    const s = new Set(); this.ops.forEach(o => s.add(o.r.id)); return s;
  },
  schedule() {
    badge('saving');
    clearTimeout(this.timer);
    const gap = Date.now() - this.lastOk;
    this.timer = setTimeout(() => this.flush(), gap > 1600 ? 120 : 420);
    if (!this.hard) this.hard = setTimeout(() => { this.hard = null; this.flush(); }, 1500);
  },
  async flush(keepalive) {
    if (this.busy || !this.ops.length) { if (!this.ops.length) badge('saved'); return; }
    this.busy = true;
    const batch = this.ops.slice(0, 200);
    try {
      const ups = {}, dels = {};
      batch.forEach(o => {
        if (o.k === 'up') (ups[o.t] = ups[o.t] || []).push(o.r);
        else (dels[o.t] = dels[o.t] || []).push(o.r.id);
      });
      for (const t in ups) {
        const conflict = t === 'cof_settings' ? 'key' : 'id';
        await sbUpsert(t, ups[t], conflict, keepalive);
      }
      for (const t in dels) {
        await sb(t + '?id=in.(' + dels[t].join(',') + ')', { method: 'DELETE', keepalive: keepalive });
      }
      const done = new Set(batch.map(o => o.k + o.t + o.r.id));
      this.ops = this.ops.filter(o => !done.has(o.k + o.t + o.r.id));
      this.persist();
      this.lastOk = Date.now(); this.fails = 0;
      badge(this.ops.length ? 'saving' : 'saved');
      if (this.ops.length) this.schedule();
    } catch (e) {
      this.fails++;
      badge('fail');
      console.warn('[coferry] 저장 실패', e);
      const wait = Math.min(15000, 900 * Math.pow(2, Math.min(this.fails, 4)));
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), wait);
    } finally { this.busy = false; }
  }
};
function badge(state) {
  const el = $('#saveTag'); if (!el) return;
  el.className = 'save-tag ' + (state === 'saved' ? 'saved' : state === 'fail' ? 'fail' : 'saving');
  el.textContent = state === 'saved' ? '저장됨 ' + hhmm()
    : state === 'fail' ? '재시도 중…' : '저장 중…';
}

/* 서버에서 방금 읽어온 목록 위에, 아직 전송 안 끝난 내 편집을 덮어씌운다.
   (이게 없으면 저장 대기 중인 글자가 재조회 한 번에 사라진다) */
function overlayPending(table, rows, pageId) {
  const gone = new Set(Q.ops.filter(o => o.t === table && (o.k === 'del' || (o.k === 'up' && o.r && o.r.deleted_at))).map(o => o.r.id));
  const out = rows.filter(r => !gone.has(r.id) && !r.deleted_at);
  Q.ops.filter(o => o.t === table && o.k === 'up' && !o.r.deleted_at && (!pageId || o.r.page_id === pageId || o.r.page_id === undefined))
    .forEach(o => {
      const i = out.findIndex(r => r.id === o.r.id);
      if (i >= 0) out[i] = Object.assign({}, out[i], o.r);
      else out.push(Object.assign({}, o.r));
    });
  return out;
}

/* 편의 래퍼 */
function savePage(p, fields) {
  p.updated_at = nowISO(); p.updated_by = S.me;
  const row = { id: p.id, updated_at: p.updated_at, updated_by: p.updated_by };
  (fields || ['parent_id', 'title', 'icon', 'status', 'sort', 'archived', 'event_date']).forEach(f => row[f] = p[f]);
  Q.up('cof_pages', row);
  if (typeof renderCalendar === 'function') try { renderCalendar(); } catch (e) {}
}
function saveBlock(b, fields) {
  b.updated_at = nowISO(); b.updated_by = S.me;
  const row = { id: b.id, page_id: b.page_id, updated_at: b.updated_at, updated_by: b.updated_by };
  (fields || ['type', 'content', 'checked', 'size', 'indent', 'meta', 'sort']).forEach(f => row[f] = b[f]);
  Q.up('cof_blocks', row);
  if (typeof syncBlockEvents === 'function') try { syncBlockEvents(b); } catch (e) {}
}

/* ===== 인증 ===== */
function lockInit() {
  // 오피스앱 iframe 안에서 열릴 때는 PIN·사용자 선택 스킵.
  //   ?embed=1&me=<이름>  →  이미 사내 인증됐다고 간주하고 곧장 부팅
  const qs = new URLSearchParams(location.search);
  if (qs.get('embed') === '1') {
    document.body.classList.add('embed');            // 상단바·잠금 스타일 축소용
    lsSet(K.auth, true); lsSet(K.ver, CF.VER);
    const me = (qs.get('me') || '').trim();
    if (me) lsSet(K.me, me);
    else if (!lsGet(K.me)) lsSet(K.me, '대표');       // 이름 미지정 시 기본값
  }
  if (lsGet(K.ver) !== CF.VER) { localStorage.removeItem(K.auth); lsSet(K.ver, CF.VER); }
  if (lsGet(K.auth) === true) { afterPin(); return; }
  const inp = $('#pinInput');
  $('#lock').classList.remove('hidden');
  setTimeout(() => inp.focus(), 60);
  const attempt = () => {
    if (inp.value === CF.PIN) { lsSet(K.auth, true); lsSet(K.ver, CF.VER); afterPin(); }
    else if (inp.value.length >= CF.PIN.length) { $('#pinMsg').textContent = 'PIN이 맞지 않습니다'; inp.value = ''; }
  };
  inp.addEventListener('input', () => { $('#pinMsg').textContent = ''; attempt(); });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); });
}
function afterPin() {
  $('#lock').classList.add('hidden');
  S.me = lsGet(K.me);
  if (!S.me) { showWho(); return; }
  $('#whoami').classList.add('hidden');
  boot();
}
function showWho() {
  const box = $('#whoami'); box.classList.remove('hidden');
  const list = $('#whoList'); list.textContent = '';
  CF.MEMBERS.forEach(m => {
    const b = document.createElement('button');
    b.className = 'who-btn';
    b.textContent = m.name;
    if (m.role) { const s = document.createElement('small'); s.textContent = m.role; b.appendChild(s); }
    b.onclick = () => { S.me = m.name; lsSet(K.me, m.name); box.classList.add('hidden'); boot(); };
    list.appendChild(b);
  });
}

/* ===== 실시간 (supabase-js lazy) + 폴링 백업 ===== */
let _rt = null, _lastPull = new Date(Date.now() - 60000).toISOString();
async function loadSupaJs() {
  if (window.supabase && window.supabase.channel) return true;
  return new Promise(res => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
    s.onload = () => {
      try { window.supabase = window.supabase.createClient(CF.URL, CF.KEY, { realtime: { params: { eventsPerSecond: 8 } } }); res(true); }
      catch (e) { res(false); }
    };
    s.onerror = () => res(false);
    document.head.appendChild(s);
  });
}
async function realtimeInit() {
  const ok = await loadSupaJs();
  if (!ok) { setInterval(pollRemote, 4000); return; }
  _rt = window.supabase.channel('coferry-live', { config: { presence: { key: S.me + '-' + Math.random().toString(36).slice(2, 6) } } })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cof_blocks' }, p => onRemoteBlock(p))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cof_pages' }, p => onRemotePage(p))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cof_comments' }, p => onRemoteComment(p))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cof_settings' }, p => onRemoteSetting(p))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cof_events' }, p => {
      if (typeof onRemoteEvent === 'function') onRemoteEvent(p);
    })
    .on('presence', { event: 'sync' }, () => {
      const st = _rt.presenceState(); const names = [];
      Object.values(st).forEach(arr => arr.forEach(x => { if (x.name && names.indexOf(x.name) < 0) names.push(x.name); }));
      S.online = names; renderPresence();
    })
    .subscribe(st => { if (st === 'SUBSCRIBED') _rt.track({ name: S.me, at: Date.now() }); });
  setInterval(pollRemote, 12000);   // 실시간이 끊겨도 12초마다 보정
}
async function pollRemote() {
  if (document.hidden) return;
  try {
    const since = _lastPull; _lastPull = nowISO();
    // soft-delete 반영을 위해 alive 필터 걸지 않고 전체를 받아, deleted_at 있으면 삭제 이벤트로 처리
    const rows = await sb('cof_blocks?select=*&updated_at=gt.' + encodeURIComponent(since) + '&limit=300');
    (rows || []).forEach(r => onRemoteBlock({ eventType: r.deleted_at ? 'DELETE' : 'UPDATE', new: r, old: r }));
    const pg = await sb('cof_pages?select=*&updated_at=gt.' + encodeURIComponent(since) + '&limit=200');
    (pg || []).forEach(r => onRemotePage({ eventType: r.deleted_at ? 'DELETE' : 'UPDATE', new: r, old: r }));
    if (typeof onRemoteEvent === 'function') {
      const ev = await sb('cof_events?select=*&updated_at=gt.' + encodeURIComponent(since) + '&limit=300');
      (ev || []).forEach(r => onRemoteEvent({ eventType: r.deleted_at ? 'DELETE' : 'UPDATE', new: r, old: r }));
    }
  } catch (e) { /* 네트워크 일시 문제 무시 */ }
}
function renderPresence() {
  const el = $('#presence'); if (!el) return;
  el.textContent = '';
  S.online.filter(n => n !== S.me).slice(0, 4).forEach(n => {
    const m = member(n); const s = document.createElement('span');
    s.style.background = m.color; s.textContent = m.name.slice(-2);
    s.title = m.name + ' 접속 중'; el.appendChild(s);
  });
}

/* ===== 종료 시 강제 flush ===== */
window.addEventListener('visibilitychange', () => { if (document.hidden) Q.flush(true); });
window.addEventListener('pagehide', () => Q.flush(true));
window.addEventListener('beforeunload', e => {
  if (Q.ops.length) { Q.flush(true); e.preventDefault(); e.returnValue = ''; }
});
window.addEventListener('online', () => Q.flush());
