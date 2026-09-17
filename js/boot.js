/* coferry — 부팅 / 전역 바인딩 */
'use strict';

function applyFS() {
  document.documentElement.style.setProperty('--fs', S.fs + '%');
  $('#fsVal').textContent = S.fs + '%';
}
function applyTheme() {
  document.documentElement.dataset.theme = S.theme;
  $('#btnTheme').textContent = S.theme === 'dark' ? '☀️' : '🌙';
}
function renderMe() {
  const m = member(S.me);
  const chip = $('#meChip');
  chip.style.background = m.color;
  chip.textContent = (S.me || '?').slice(-2);
  chip.title = S.me + ' — 클릭해서 사용자 변경';
  chip.onclick = () => {
    if (!confirm('사용자를 변경할까요? (저장 중인 내용은 먼저 전송됩니다)')) return;
    Q.flush(true);
    localStorage.removeItem(K.me);
    location.reload();
  };
}

function bindTop() {
  $('#fsUp').onclick   = () => { S.fs = Math.min(190, S.fs + 10); applyFS(); saveUI(); };
  $('#fsDown').onclick = () => { S.fs = Math.max(70,  S.fs - 10); applyFS(); saveUI(); };
  $('#btnTheme').onclick = () => { S.theme = S.theme === 'dark' ? 'light' : 'dark'; applyTheme(); saveUI(); };
  $('#btnComments').onclick = () => { S.showComments = !S.showComments; applyPanel(); };
  $('#btnCloseComments').onclick = () => { S.showComments = false; applyPanel(); };
  $('#showResolved').onchange = e => { S.showResolved = e.target.checked; renderComments(); };
  $('#btnNewPage').onclick = () => newPage(null);
  $('#btnFiles').onclick = showFiles;
  $('#btnArchive').onclick = showArchive;
  $('#btnSidebar').onclick = () => $('#sidebar').classList.toggle('open');

  const cbox = $('#cBox');
  cbox.addEventListener('input', () => autoGrow(cbox));
  cbox.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendComment(); }
  });
  $('#cSend').onclick = sendComment;

  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); Q.flush(); toast('저장했습니다'); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); $('#searchBox').focus(); }
    if (e.key === 'Escape') {
      ['#slashMenu', '#blockMenu', '#emojiPick'].forEach(s => $(s).classList.add('hidden'));
      $('#sidebar').classList.remove('open');
    }
  });

  // 에디터 빈 공간 클릭 → 마지막 줄로 포커스 / 없으면 새 줄
  $('#editor').addEventListener('click', e => {
    if (e.target.id !== 'editor') return;
    const last = S.blocks[S.blocks.length - 1];
    if (last && last.type !== 'image' && last.type !== 'file' && !last.content) focusBlock(last.id, 'end');
    else if (last) insertAfter(last.id, 'text', true);
  });

  // 페이지 우클릭 → 보관
  $('#pageTree').addEventListener('contextmenu', e => {
    const row = e.target.closest('.t-item'); if (!row) return;
    e.preventDefault();
    const target = pageById(row.dataset.pid);
    if (target && confirm('"' + (target.title || '제목 없음') + '" 을(를) 보관함으로 옮길까요?')) archivePage(target);
  });

  if ('Notification' in window && Notification.permission === 'default') {
    setTimeout(() => Notification.requestPermission().catch(() => {}), 2500);
  }
}

async function boot() {
  if (S.booted) return;
  S.booted = true;
  const ui = lsGet(K.ui, {});
  S.fs = ui.fs || 100; S.theme = ui.theme || 'light';
  S.filter = ui.filter || 'all';
  S.showComments = ui.showComments !== false;
  applyFS(); applyTheme(); applyPanel(); renderMe();

  $('#app').classList.remove('hidden');
  bindTop(); bindPageHead(); bindSearch(); bindDrop(); bindLogo();

  // 미전송분 먼저 올린다 (새로고침/오프라인 복구)
  if (Q.ops.length) { badge('saving'); Q.flush(); }

  try {
    const [pages, settings] = await Promise.all([
      sb('cof_pages?select=*&order=sort.asc&limit=1000'),
      sb('cof_settings?select=*')
    ]);
    S.pages = overlayPending('cof_pages', (pages || []).filter(p => !isTomb(p.id)));
    (settings || []).forEach(s => S.settings[s.key] = s.value);
  } catch (e) {
    toast('서버 연결에 실패했습니다. 잠시 후 자동 재시도합니다.');
    console.warn(e);
  }
  applyLogo();
  renderFilter(); renderTree();

  const last = lsGet(K.last);
  if (last && pageById(last) && !pageById(last).archived) openPage(last);
  else if (childrenOf(null)[0]) openPage(childrenOf(null)[0].id);
  else $('#emptyState').classList.remove('hidden');

  realtimeInit();
  setInterval(() => { if (S.pageId && !editorFocused()) renderPageHead(); }, 60000);
  if (!Q.ops.length) badge('saved');
}

document.addEventListener('DOMContentLoaded', lockInit);
