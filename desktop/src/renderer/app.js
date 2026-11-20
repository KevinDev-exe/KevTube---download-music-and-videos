// Interfaz de KevTube
const $ = (s) => document.querySelector(s);
const listEl = $('#list');
const tpl = $('#itemTpl');

const ICONS = {
  ok: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  warn: '<svg viewBox="0 0 24 24"><path d="M12 7v6m0 4h.01"/></svg>',
  err: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  mp3: '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  mp4: '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="14" height="12" rx="2"/><path d="m16 10 6-3v10l-6-3"/></svg>',
};

/** @type {Array<{key:string,id:string,url:string,format:'mp3'|'mp4',status:string,title?:string,thumbnail?:string,duration?:string,uploader?:string,file?:string,error?:string,pct?:number}>} */
let items = [];
let running = false;
let stopRequested = false;

// ---------- Persistencia ----------
function save() {
  try {
    const data = items
      .filter((i) => i.status !== 'loading')
      .map(({ pct, ...i }) => ({ ...i, status: i.status === 'done' ? 'done' : i.status === 'error' ? 'error' : 'ready' }));
    localStorage.setItem('kevtube.items', JSON.stringify(data));
  } catch {}
}
function load() {
  try {
    items = JSON.parse(localStorage.getItem('kevtube.items') || '[]');
  } catch {
    items = [];
  }
}

// ---------- Toasts ----------
function toast(type, text, sub, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = `<span class="t-icon">${ICONS[type] || ''}</span><div><p></p>${sub ? '<small></small>' : ''}</div>`;
  el.querySelector('p').textContent = text;
  if (sub) el.querySelector('small').textContent = sub;
  $('#toasts').appendChild(el);
  const close = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 250);
  };
  if (ms) setTimeout(close, ms);
  return { el, close };
}

// ---------- Render ----------
function renderItem(item) {
  let li = listEl.querySelector(`[data-key="${item.key}"]`);
  if (!li) {
    li = tpl.content.firstElementChild.cloneNode(true);
    li.dataset.key = item.key;
    li.querySelector('.fmt').addEventListener('click', () => toggleFormat(item.key));
    li.querySelector('.remove').addEventListener('click', () => removeItem(item.key));
    li.querySelector('.done-check').addEventListener('click', () => window.api.showFile(item.file));
    listEl.prepend(li);
  }
  li.className = 'item ' + item.status;
  const img = li.querySelector('.thumb-img');
  const thumb = item.thumbnail || `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`;
  if (img.getAttribute('src') !== thumb) img.src = thumb;
  li.querySelector('.duration').textContent = item.duration || '';
  li.querySelector('.title').textContent = item.title || 'Obteniendo información…';

  let meta = item.uploader || item.url;
  if (item.status === 'queued') meta = 'En cola…';
  if (item.status === 'downloading') meta = item.pct >= 95 ? 'Convirtiendo…' : `Descargando ${Math.round(item.pct || 0)}%`;
  if (item.status === 'done') meta = `Descargado como ${item.format.toUpperCase()}`;
  if (item.status === 'error') meta = '⚠ ' + (item.error || 'Error') + ' — toca Descargar para reintentar';
  li.querySelector('.meta').textContent = meta;

  const fmt = li.querySelector('.fmt');
  fmt.className = 'fmt ' + item.format;
  fmt.innerHTML = ICONS[item.format] + item.format.toUpperCase();
  fmt.title = item.format === 'mp3' ? 'Solo audio — clic para cambiar a video (MP4)' : 'Video — clic para cambiar a audio (MP3)';
  li.querySelector('.item-bar-fill').style.width = (item.pct || 0) + '%';
}

function renderSummary() {
  const total = items.length;
  const done = items.filter((i) => i.status === 'done').length;
  $('#empty').hidden = total > 0;
  $('#summary').hidden = total === 0;
  $('#count').textContent = `${done}/${total}`;
  $('#clearDone').hidden = done === 0 || running;
  // "Abrir carpeta" aparece al terminar de descargar; se oculta mientras descarga o si no hay completadas
  $('#openFolder').hidden = running || done === 0;

  // Progreso global = completas + fracción de la actual
  const current = items.find((i) => i.status === 'downloading');
  const progress = total ? ((done + (current ? (current.pct || 0) / 100 : 0)) / total) * 100 : 0;
  $('#totalBar').style.width = progress + '%';

  const btn = $('#downloadAll');
  const pending = items.filter((i) => ['ready', 'error'].includes(i.status)).length;
  if (running) {
    btn.classList.add('stop');
    btn.querySelector('span').textContent = 'Detener';
    btn.disabled = false;
  } else {
    btn.classList.remove('stop');
    btn.querySelector('span').textContent = pending ? `Descargar (${pending})` : 'Descargar';
    btn.disabled = pending === 0;
  }
}

function renderAll() {
  listEl.innerHTML = '';
  [...items].reverse().forEach(renderItem);
  renderSummary();
}

function update(item) {
  renderItem(item);
  renderSummary();
  save();
}

// ---------- Acciones ----------
async function addLink({ url, id }) {
  const existing = items.find((i) => i.id === id);
  if (existing) {
    toast('warn', 'Ya está en la lista', existing.title);
    return;
  }
  const item = { key: id + '-' + Date.now(), id, url, format: 'mp3', status: 'loading' };
  items.push(item);
  update(item);
  const t = toast('info', 'Agregando a la lista de descargas…', url, 0);
  try {
    const info = await window.api.getInfo(url);
    Object.assign(item, info, { status: running ? 'queued' : 'ready' });
    if (!items.includes(item)) return t.close(); // la quitaron mientras cargaba
    t.close();
    toast('ok', 'Agregada correctamente', item.title);
  } catch (e) {
    t.close();
    Object.assign(item, { status: 'error', title: url, error: cleanErr(e) });
    toast('err', 'No se pudo agregar', cleanErr(e), 4000);
  }
  update(item);
}

function toggleFormat(key) {
  const item = items.find((i) => i.key === key);
  if (!item || ['downloading', 'done', 'loading'].includes(item.status)) return;
  item.format = item.format === 'mp3' ? 'mp4' : 'mp3';
  update(item);
}

function removeItem(key) {
  const item = items.find((i) => i.key === key);
  if (!item || item.status === 'downloading') return;
  items = items.filter((i) => i.key !== key);
  const li = listEl.querySelector(`[data-key="${key}"]`);
  if (li) {
    li.classList.add('removing');
    setTimeout(() => li.remove(), 200);
  }
  renderSummary();
  save();
}

async function startQueue() {
  if (running) {
    stopRequested = true;
    window.api.cancel();
    return;
  }
  items.forEach((i) => {
    if (['ready', 'error'].includes(i.status)) {
      i.status = 'queued';
      i.pct = 0;
      renderItem(i);
    }
  });
  running = true;
  stopRequested = false;
  renderSummary();

  let ok = 0;
  let item;
  while (!stopRequested && (item = items.find((i) => i.status === 'queued'))) {
    item.status = 'downloading';
    item.pct = 0;
    update(item);
    try {
      item.file = await window.api.download({ key: item.key, url: item.url, format: item.format });
      item.status = 'done';
      item.pct = 100;
      ok++;
    } catch (e) {
      if (stopRequested) {
        item.status = 'ready';
        item.pct = 0;
      } else {
        item.status = 'error';
        item.error = cleanErr(e);
      }
    }
    update(item);
  }

  // Lo que quedó en cola al detener vuelve a "listo"
  items.forEach((i) => {
    if (i.status === 'queued') {
      i.status = 'ready';
      i.pct = 0;
      renderItem(i);
    }
  });
  running = false;
  renderSummary();
  save();

  const failed = items.filter((i) => i.status === 'error').length;
  if (stopRequested) toast('warn', 'Descargas detenidas');
  else if (ok) {
    toast(failed ? 'warn' : 'ok', `${ok} descarga${ok > 1 ? 's' : ''} completada${ok > 1 ? 's' : ''}`, failed ? `${failed} con error` : '');
    window.api.notify(`¡Listo! ${ok} archivo(s) descargado(s)`);
  }
}

function cleanErr(e) {
  return String(e && e.message ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

// ---------- Eventos ----------
window.api.onLink(addLink);
window.api.onProgress(({ key, pct }) => {
  const item = items.find((i) => i.key === key);
  if (!item || item.status !== 'downloading') return;
  item.pct = pct;
  renderItem(item);
  renderSummary();
});
window.api.onEngineStatus((msg) => {
  const el = $('#engine');
  el.hidden = !msg;
  el.textContent = msg || '';
  if (msg) $('#summary').hidden = false;
  else renderSummary();
});

$('#pasteForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#pasteInput');
  const parsed = await window.api.parseUrl(input.value);
  if (!parsed) {
    toast('err', 'Ese no parece un enlace de YouTube');
    return;
  }
  input.value = '';
  addLink(parsed);
});
$('#downloadAll').addEventListener('click', startQueue);
$('#openFolder').addEventListener('click', () => window.api.openFolder());
$('#clearDone').addEventListener('click', () => {
  items.filter((i) => i.status === 'done').forEach((i) => removeItem(i.key));
});
$('#watch').addEventListener('change', async (e) => {
  await window.api.setWatch(e.target.checked);
  toast(e.target.checked ? 'ok' : 'warn', e.target.checked ? 'Detección de enlaces activada' : 'Detección de enlaces desactivada');
});

function showSettings(s) {
  $('#watch').checked = s.watchClipboard;
  $('#openFolder').title = 'Guardado en: ' + s.outDir;
}

// ---------- Inicio ----------
load();
renderAll();
window.api.getSettings().then(showSettings);
