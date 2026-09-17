/* coferry — 피드백 스레드 (블록별 · 페이지별) + 실시간 알림 */
'use strict';

async function loadComments(pageId) {
  let rows = null;
  try {
    rows = await sb('cof_comments?select=*&page_id=eq.' + pageId + '&order=created_at.asc&limit=800');
  } catch (e) { /* 아래에서 빈 목록 처리 */ }
  if (S.pageId !== pageId) return;           // 늦게 도착한 이전 페이지 응답 무시
  S.comments = overlayPending('cof_comments', (rows || []).filter(c => !isTomb(c.id)), pageId)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  renderComments();
  refreshCommentCounts();
}

function startComment(b) {
  S.cTarget = b ? b.id : null;
  S.showComments = true; applyPanel();
  renderComments();
  const tag = $('#cTargetTag');
  if (b) {
    tag.classList.remove('hidden'); tag.textContent = '';
    const s = document.createElement('span');
    s.textContent = '↳ ' + (b.type === 'image' ? '🖼 이미지'
      : b.type === 'file' ? ('📎 ' + (b.meta.name || '파일'))
      : (b.content || '빈 줄').slice(0, 40));
    tag.appendChild(s);
    const x = document.createElement('button'); x.textContent = '✕';
    x.onclick = () => { S.cTarget = null; tag.classList.add('hidden'); renderComments(); };
    tag.appendChild(x);
  } else tag.classList.add('hidden');
  $('#cBox').focus();
}

function renderComments() {
  const list = $('#cList'); if (!list) return;
  if (!S.cTarget) $('#cTargetTag').classList.add('hidden');   // 페이지 바꾸면 '이 줄' 꼬리표도 같이 내린다
  if (document.activeElement === $('#cBox') && list.dataset.busy === '1') { /* 입력 중에도 목록은 안전 */ }
  list.textContent = '';
  let rows = S.comments.slice();
  if (!S.showResolved) rows = rows.filter(c => !c.resolved);
  if (S.cTarget) rows = rows.filter(c => c.block_id === S.cTarget);

  $('#cpanelTitle').textContent = '💬 피드백' + (S.cTarget ? ' (이 줄)' : '') + ' · ' + rows.length;

  if (!rows.length) {
    const e = document.createElement('div'); e.className = 'c-empty';
    e.textContent = S.cTarget ? '이 줄에 남긴 피드백이 없습니다.\n아래에 적어보세요.'
      : '아직 피드백이 없습니다.\n줄 오른쪽 💬 를 눌러 특정 줄에 달 수도 있어요.';
    e.style.whiteSpace = 'pre-line';
    list.appendChild(e);
    return;
  }
  rows.forEach(c => list.appendChild(commentEl(c)));
  list.scrollTop = list.scrollHeight;
}

function commentEl(c) {
  const m = member(c.author);
  const box = document.createElement('div');
  box.className = 'c-item' + (c.resolved ? ' resolved' : '');

  if (c.block_id && !S.cTarget) {
    const b = S.blocks.find(x => x.id === c.block_id);
    const ctx = document.createElement('div'); ctx.className = 'c-ctx';
    ctx.textContent = '↳ ' + (b ? (b.type === 'image' ? '🖼 이미지'
      : b.type === 'file' ? ('📎 ' + (b.meta.name || '파일'))
      : (b.content || '빈 줄').slice(0, 44)) : '삭제된 줄');
    ctx.onclick = () => {
      const row = $('#editor').querySelector('.blk[data-id="' + c.block_id + '"]');
      if (row) { row.scrollIntoView({ block: 'center', behavior: 'smooth' }); flash(c.block_id); }
    };
    box.appendChild(ctx);
  }

  const top = document.createElement('div'); top.className = 'c-top';
  const av = document.createElement('span'); av.className = 'c-av';
  av.style.background = m.color; av.textContent = (c.author || '?').slice(-2); top.appendChild(av);
  const nm = document.createElement('span'); nm.className = 'c-name'; nm.textContent = c.author || '?'; top.appendChild(nm);
  const tm = document.createElement('span'); tm.className = 'c-time'; tm.textContent = ago(c.created_at); top.appendChild(tm);
  box.appendChild(top);

  const bd = document.createElement('div'); bd.className = 'c-body'; bd.textContent = c.body; box.appendChild(bd);

  const acts = document.createElement('div'); acts.className = 'c-acts';
  const rs = document.createElement('button');
  rs.textContent = c.resolved ? '↩︎ 다시 열기' : '✓ 해결';
  rs.onclick = () => {
    c.resolved = !c.resolved;
    Q.up('cof_comments', { id: c.id, page_id: c.page_id, block_id: c.block_id, author: c.author, body: c.body, resolved: c.resolved, created_at: c.created_at });
    renderComments(); refreshCommentCounts();
  };
  acts.appendChild(rs);
  const rp = document.createElement('button'); rp.textContent = '↩ 답글';
  rp.onclick = () => { const t = $('#cBox'); t.value = '@' + (c.author || '') + ' '; t.focus(); autoGrow(t); };
  acts.appendChild(rp);
  if (c.author === S.me) {
    const dl = document.createElement('button'); dl.textContent = '삭제';
    dl.onclick = () => {
      S.comments = S.comments.filter(x => x.id !== c.id);
      Q.del('cof_comments', c.id);
      renderComments(); refreshCommentCounts();
    };
    acts.appendChild(dl);
  }
  box.appendChild(acts);
  return box;
}

function sendComment() {
  const t = $('#cBox');
  const body = t.value.trim();
  if (!body || !S.pageId) return;
  const c = {
    id: uid(), page_id: S.pageId, block_id: S.cTarget || null,
    author: S.me, body: body, resolved: false, created_at: nowISO()
  };
  S.comments.push(c);
  Q.up('cof_comments', c);
  t.value = ''; autoGrow(t);
  renderComments(); refreshCommentCounts();
}

function autoGrow(t) { t.style.height = 'auto'; t.style.height = Math.min(140, t.scrollHeight) + 'px'; }

function refreshCommentCounts() {
  const counts = {};
  S.comments.forEach(c => { if (c.block_id && !c.resolved) counts[c.block_id] = (counts[c.block_id] || 0) + 1; });
  $$('#editor .blk-cbtn').forEach(btn => {
    const n = counts[btn.dataset.cfor] || 0;
    btn.textContent = n ? '💬' + n : '💬';
    btn.classList.toggle('has', !!n);
  });
}

function applyPanel() {
  $('#cpanel').classList.toggle('off', !S.showComments);
  saveUI();
}

/* ===== 원격 ===== */
function onRemoteComment(payload) {
  const r = payload.new || payload.old; if (!r) return;
  if (payload.eventType === 'DELETE') { S.comments = S.comments.filter(c => c.id !== r.id); renderComments(); refreshCommentCounts(); return; }
  if (isTomb(r.id)) return;
  if (r.page_id !== S.pageId) {
    if (r.author !== S.me && payload.eventType === 'INSERT') notify(r);
    return;
  }
  const i = S.comments.findIndex(c => c.id === r.id);
  if (i < 0) {
    S.comments.push(r);
    if (r.author !== S.me) { notify(r); if (S.showComments) toast('💬 ' + r.author + ' 님의 새 피드백'); }
  } else S.comments[i] = r;
  renderComments(); refreshCommentCounts();
}

function notify(c) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const p = pageById(c.page_id);
    const n = new Notification('💬 ' + c.author + ' 님의 피드백', {
      body: (p ? '[' + (p.title || '제목 없음') + '] ' : '') + c.body.slice(0, 120),
      tag: 'cof-' + c.id
    });
    n.onclick = () => { window.focus(); if (c.page_id !== S.pageId) openPage(c.page_id); n.close(); };
  } catch (e) {}
}
