/* coferry — 파일 업로드(이미지/PDF/엑셀) · 이미지 블록 · 파일함 · 로고 */
'use strict';

const ICONS = [
  [/pdf/,                         '📕'],
  [/sheet|excel|csv|numbers/,     '📊'],
  [/presentation|powerpoint|keynote/, '📽'],
  [/word|document|rtf/,           '📄'],
  [/zip|compress|rar|7z/,         '🗜'],
  [/photoshop|psd/,               '🖌'],
  [/illustrator|postscript|ai$/,  '✒️'],
  [/video/,                       '🎬'],
  [/audio/,                       '🎧']
];
function iconFor(mime, name) {
  const s = ((mime || '') + ' ' + (name || '')).toLowerCase();
  for (const [re, ic] of ICONS) if (re.test(s)) return ic;
  return '📎';
}
const isImage = f => /^image\//.test(f.type || '') && !/heic|heif/i.test(f.type);

/* ===== 업로드 ===== */
function upShow(pct, text) {
  const bar = $('#upBar');
  bar.classList.remove('hidden');
  $('#upFill').style.width = Math.max(3, pct) + '%';
  $('#upText').textContent = text;
}
function upHide() { setTimeout(() => $('#upBar').classList.add('hidden'), 600); }

async function uploadToStorage(file, onProgress) {
  // Supabase Storage 는 key 에 non-ASCII (한글 등) 가 들어가면 InvalidKey 400.
  // 원본 파일명은 meta.name / cof_files.name 에 그대로 보관하고, 스토리지 경로만 ASCII 로 안전화.
  const rawName = file.name || 'file';
  const dot = rawName.lastIndexOf('.');
  const ext = dot > 0 ? rawName.slice(dot).replace(/[^\w.\-]/g, '').toLowerCase() : '';
  const base = (dot > 0 ? rawName.slice(0, dot) : rawName).replace(/[^A-Za-z0-9_-]+/g, '_').slice(-40) || 'file';
  const path = (S.pageId || 'misc') + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '_' + base + ext;
  await new Promise((res, rej) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', CF.URL + '/storage/v1/object/' + CF.BUCKET + '/' + encodeURI(path));
    xhr.setRequestHeader('apikey', CF.KEY);
    xhr.setRequestHeader('Authorization', 'Bearer ' + CF.KEY);
    xhr.setRequestHeader('x-upsert', 'true');
    if (file.type) xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total * 100); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? res() : rej(new Error(xhr.status + ' ' + xhr.responseText.slice(0, 200)));
    xhr.onerror = () => rej(new Error('network'));
    xhr.send(file);
  });
  return {
    path: path,
    url: CF.URL + '/storage/v1/object/public/' + CF.BUCKET + '/' + encodeURI(path)
  };
}

async function uploadAndInsert(file, afterBlockId) {
  if (!S.pageId) { newPage(null); }              // 페이지가 없으면 즉석에서 하나 만든다
  if (!S.pageId) { toast('페이지를 만들지 못했습니다'); return; }
  if (!file || !file.size) { toast('빈 파일입니다: ' + (file && file.name || '?')); return; }
  if (file.size > CF.MAX_MB * 1048576) { toast(file.name + ' — ' + CF.MAX_MB + 'MB 를 넘습니다'); return; }
  upShow(4, '올리는 중… ' + file.name);
  try {
    const { path, url } = await uploadToStorage(file, p => upShow(p, Math.round(p) + '% · ' + file.name));
    upShow(100, '완료 · ' + file.name); upHide();

    const img = isImage(file);
    const meta = { url: url, path: path, name: file.name, mime: file.type || '', size: file.size, w: img ? 620 : 0, cap: '' };
    const anchor = afterBlockId || (S.blocks.length ? S.blocks[S.blocks.length - 1].id : null);
    let b;
    if (anchor) {
      const i = blockIndex(anchor), prev = S.blocks[i], next = S.blocks[i + 1];
      b = makeBlock(S.pageId, img ? 'image' : 'file', sortBetween(prev ? prev.sort : null, next ? next.sort : null), { meta: meta });
      S.blocks.splice(i + 1, 0, b);
    } else {
      b = makeBlock(S.pageId, img ? 'image' : 'file', 1000, { meta: meta });
      S.blocks.push(b);
    }
    // 빈 본문 블록 위에 올렸으면 그 블록 제거
    const host = blockIndex(anchor) >= 0 ? S.blocks[blockIndex(anchor)] : null;
    if (host && host.type === 'text' && !host.content && S.blocks.length > 2) removeBlock(host.id);

    Q.up('cof_files', {
      id: uid(), page_id: S.pageId, name: file.name, mime: file.type || '',
      size: file.size, path: path, url: url, uploaded_by: S.me, created_at: nowISO()
    });
    renderEditorKeepFocus(null);
  } catch (e) {
    upHide();
    console.warn('[coferry] upload failed', e);
    toast('업로드 실패 · ' + file.name + ' — ' + ((e && e.message) || '').slice(0, 100));
  }
}
function pickFiles(afterBlockId) {
  const inp = $('#filePicker');
  inp.value = '';
  inp.onchange = () => {
    const files = Array.from(inp.files || []);
    (async () => { for (const f of files) await uploadAndInsert(f, afterBlockId); })();
  };
  inp.click();
}

// 웹페이지에서 이미지를 끌어왔거나 클립보드에 복사한 이미지를 File 로 변환
async function fetchUrlAsFile(url) {
  const r = await fetch(url, { credentials: 'omit' });
  if (!r.ok) throw new Error('URL fetch ' + r.status);
  const blob = await r.blob();
  const name = decodeURIComponent((url.split('/').pop() || 'image').split('?')[0]).slice(-80) || 'image';
  return new File([blob], name, { type: blob.type || 'application/octet-stream' });
}

/* ===== 이미지 / 파일 블록 노드 ===== */
function safeUrl(u) { return (typeof u === 'string' && u.indexOf(CF.URL) === 0) ? u : ''; }
// 원본 파일명(한글/특수문자 포함) 그대로 다운로드되도록 ?download=<원본이름> 을 붙인다
function dlUrl(meta) {
  const u = safeUrl(meta && meta.url); if (!u) return '';
  const name = (meta && meta.name) ? meta.name : '';
  return name ? u + (u.indexOf('?') < 0 ? '?' : '&') + 'download=' + encodeURIComponent(name) : u;
}

function imageNode(b) {
  const wrap = document.createElement('div'); wrap.style.flex = '1';
  const box = document.createElement('div'); box.className = 'imgwrap';
  const img = document.createElement('img');
  img.className = 'blk-img'; img.loading = 'lazy';
  img.src = safeUrl(b.meta.url); img.alt = b.meta.name || '';
  img.style.width = (b.meta.w || 620) + 'px';
  img.onclick = () => lightbox(safeUrl(b.meta.url));
  box.appendChild(img);

  const tools = document.createElement('div'); tools.className = 'imgtools';
  const rng = document.createElement('input');
  rng.type = 'range'; rng.min = 160; rng.max = 1000; rng.value = b.meta.w || 620;
  rng.title = '이미지 크기';
  rng.oninput = () => { img.style.width = rng.value + 'px'; };
  rng.onchange = () => { b.meta = Object.assign({}, b.meta, { w: +rng.value }); saveBlock(b, ['meta']); };
  tools.appendChild(rng);
  const dl = document.createElement('button'); dl.className = 'tbtn'; dl.textContent = '↓';
  dl.title = '원본 파일명 그대로 다운로드';
  dl.onclick = () => window.open(dlUrl(b.meta), '_blank', 'noopener');
  tools.appendChild(dl);
  const del = document.createElement('button'); del.className = 'tbtn'; del.textContent = '🗑';
  del.onclick = () => removeBlock(b.id);
  tools.appendChild(del);
  box.appendChild(tools);
  wrap.appendChild(box);

  const cap = document.createElement('div');
  cap.className = 'cap'; cap.contentEditable = 'plaintext-only';
  cap.textContent = b.meta.cap || '';
  cap.addEventListener('input', () => {
    b.meta = Object.assign({}, b.meta, { cap: cap.innerText.replace(/\n$/, '') });
    saveBlock(b, ['meta']);
  });
  wrap.appendChild(cap);
  return wrap;
}

function fileNode(b) {
  const wrap = document.createElement('div'); wrap.style.flex = '1';
  const a = document.createElement('a');
  a.className = 'fcard'; a.href = safeUrl(b.meta.url); a.target = '_blank'; a.rel = 'noopener';
  const i = document.createElement('span'); i.className = 'fi'; i.textContent = iconFor(b.meta.mime, b.meta.name); a.appendChild(i);
  const mid = document.createElement('span'); mid.style.cssText = 'flex:1;min-width:0';
  const n = document.createElement('span'); n.className = 'fn'; n.textContent = b.meta.name || '파일'; mid.appendChild(n);
  const s = document.createElement('span'); s.className = 'fs';
  s.textContent = fsize(b.meta.size) + ' · 클릭 열기 · ↓ 원본 이름으로 다운로드'; mid.appendChild(s);
  a.appendChild(mid);
  const dl = document.createElement('button'); dl.className = 'tbtn'; dl.textContent = '↓';
  dl.title = '원본 파일명 그대로 다운로드';
  dl.onclick = e => { e.preventDefault(); window.open(dlUrl(b.meta), '_blank', 'noopener'); };
  a.appendChild(dl);
  const del = document.createElement('button'); del.className = 'tbtn'; del.textContent = '🗑';
  del.onclick = e => { e.preventDefault(); removeBlock(b.id); };
  a.appendChild(del);
  wrap.appendChild(a);

  const cap = document.createElement('div');
  cap.className = 'cap'; cap.contentEditable = 'plaintext-only';
  cap.textContent = b.meta.cap || '';
  cap.addEventListener('input', () => {
    b.meta = Object.assign({}, b.meta, { cap: cap.innerText.replace(/\n$/, '') });
    saveBlock(b, ['meta']);
  });
  wrap.appendChild(cap);
  return wrap;
}

function lightbox(url) {
  if (!url) return;
  const d = document.createElement('div'); d.className = 'lightbox';
  const i = document.createElement('img'); i.src = url; d.appendChild(i);
  d.onclick = () => d.remove();
  document.body.appendChild(d);
}

/* ===== 드래그 앤 드롭 · 붙여넣기 ===== */
function bindDrop() {
  let depth = 0;
  const isFileDrag = e => {
    if (!e.dataTransfer) return false;
    const types = Array.from(e.dataTransfer.types || []);
    return types.indexOf('Files') >= 0
        || types.indexOf('text/uri-list') >= 0
        || types.indexOf('text/x-moz-url') >= 0;
  };
  window.addEventListener('dragenter', e => {
    if (!isFileDrag(e)) return;
    depth++; document.body.classList.add('dragging');
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1); if (!depth) document.body.classList.remove('dragging');
  });
  window.addEventListener('dragover', e => { if (document.body.classList.contains('dragging')) e.preventDefault(); });
  window.addEventListener('drop', e => {
    if (!document.body.classList.contains('dragging') && !isFileDrag(e)) return;
    e.preventDefault(); depth = 0; document.body.classList.remove('dragging');
    const row = e.target.closest && e.target.closest('.blk');
    const anchor = row ? row.dataset.id : null;
    handleDropOrPaste(e.dataTransfer, anchor);
  });

  // 붙여넣기 (Cmd/Ctrl+V) — 클립보드 이미지 지원
  window.addEventListener('paste', e => {
    if (!e.clipboardData) return;
    const files = Array.from(e.clipboardData.files || []);
    if (!files.length) return;
    const inEditable = document.activeElement && document.activeElement.isContentEditable;
    if (inEditable) e.preventDefault();
    (async () => { for (const f of files) await uploadAndInsert(f, null); })();
  });
}

async function handleDropOrPaste(dt, anchor) {
  if (!dt) return;
  const files = Array.from(dt.files || []);
  if (files.length) {
    for (const f of files) await uploadAndInsert(f, anchor);
    return;
  }
  // 파일이 없으면 URL 로 온 이미지(다른 탭에서 끌어오기)를 시도한다
  const url = dt.getData('text/uri-list') || dt.getData('URL') || dt.getData('text/plain');
  if (url && /^https?:\/\//.test(url)) {
    try {
      const f = await fetchUrlAsFile(url);
      await uploadAndInsert(f, anchor);
    } catch (e) {
      console.warn('[coferry] URL drop failed', e);
      toast('이 이미지는 가져올 수 없습니다 (CORS). 파일을 다운로드한 뒤 끌어다 놓아 주세요.');
    }
  }
}

/* ===== 파일함 ===== */
async function showFiles() {
  S.view = 'files';
  $('#pageWrap').classList.add('hidden'); $('#emptyState').classList.add('hidden');
  $('#archiveView').classList.add('hidden');
  const v = $('#filesView'); v.classList.remove('hidden'); v.textContent = '';
  const h = document.createElement('h2'); h.textContent = '📎 파일함'; v.appendChild(h);
  const sub = document.createElement('div'); sub.className = 'sub';
  sub.textContent = '지금까지 올린 이미지 · PDF · 엑셀 · 문서'; v.appendChild(sub);

  let rows = [];
  try { rows = await sb('cof_files?select=*&order=created_at.desc&limit=400') || []; }
  catch (e) { toast('파일 목록을 불러오지 못했습니다'); }
  if (!rows.length) { const e2 = document.createElement('div'); e2.className = 'c-empty'; e2.textContent = '아직 올린 파일이 없습니다'; v.appendChild(e2); return; }

  const grid = document.createElement('div'); grid.className = 'fgrid';
  rows.forEach(f => {
    const t = document.createElement('div'); t.className = 'ftile';
    const th = document.createElement('div'); th.className = 'th';
    if (/^image\//.test(f.mime) && safeUrl(f.url)) {
      const im = document.createElement('img'); im.src = safeUrl(f.url); im.loading = 'lazy'; th.appendChild(im);
    } else th.textContent = iconFor(f.mime, f.name);
    t.appendChild(th);
    const mt = document.createElement('div'); mt.className = 'mt';
    const b = document.createElement('b'); b.textContent = f.name; mt.appendChild(b);
    const sp = document.createElement('span');
    const pg = pageById(f.page_id);
    sp.textContent = fsize(f.size) + ' · ' + (f.uploaded_by || '-') + (pg ? ' · ' + (pg.title || '제목 없음') : '');
    mt.appendChild(sp);
    t.appendChild(mt);
    t.onclick = () => {
      if (/^image\//.test(f.mime)) lightbox(safeUrl(f.url));
      else window.open(safeUrl(f.url), '_blank', 'noopener');
    };
    grid.appendChild(t);
  });
  v.appendChild(grid);
}

/* ===== 로고 ===== */
function applyLogo() {
  const url = safeUrl((S.settings.logo || {}).url);
  const img = $('#brandLogo'), txt = $('#brandText'), lock = $('#lockLogo');
  if (url) {
    img.src = url; img.classList.remove('hidden'); txt.classList.add('hidden');
    lock.textContent = ''; const l2 = document.createElement('img'); l2.src = url; lock.appendChild(l2);
  } else {
    img.classList.add('hidden'); txt.classList.remove('hidden'); lock.textContent = 'coferry';
  }
}
function bindLogo() {
  $('#brandBox').onclick = () => $('#logoInput').click();
  $('#logoInput').onchange = async () => {
    const f = $('#logoInput').files[0]; if (!f) return;
    if (!/^image\//.test(f.type)) { toast('이미지 파일만 가능합니다'); return; }
    upShow(5, '로고 업로드…');
    try {
      const { url } = await uploadToStorage(f, p => upShow(p, '로고 ' + Math.round(p) + '%'));
      upHide();
      S.settings.logo = { url: url };
      Q.up('cof_settings', { key: 'logo', value: { url: url }, updated_at: nowISO() });
      applyLogo();
      toast('로고가 바뀌었습니다');
    } catch (e) { upHide(); toast('로고 업로드 실패'); }
  };
}
