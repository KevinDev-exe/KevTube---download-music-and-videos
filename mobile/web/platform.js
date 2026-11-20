// Versión Android de window.api: conecta la interfaz (app.js) con el código nativo (MainActivity.kt)
(function () {
  const N = window.KevAndroid;
  if (!N) return;

  const pending = {};
  const listeners = { link: [], progress: [], engine: [] };
  let seq = 0;

  // El código nativo llama a estas funciones con evaluateJavascript
  window.__kev = {
    resolve(id, value) {
      const p = pending[id];
      if (p) { delete pending[id]; p.res(value); }
    },
    reject(id, msg) {
      const p = pending[id];
      if (p) { delete pending[id]; p.rej(new Error(msg)); }
    },
    emit(type, data) {
      (listeners[type] || []).forEach((f) => f(data));
    },
  };

  const call = (fn, ...args) =>
    new Promise((res, rej) => {
      const id = 'c' + ++seq;
      pending[id] = { res, rej };
      N[fn](id, ...args);
    });

  const YT_REGEX =
    /(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com\/(watch\?[^\s]*v=|shorts\/|live\/|embed\/)|youtu\.be\/)[\w-]{6,}[^\s]*/i;
  function extract(text) {
    const m = (text || '').match(YT_REGEX);
    if (!m) return null;
    return /^https?:\/\//i.test(m[0]) ? m[0] : 'https://' + m[0];
  }
  function videoId(url) {
    try {
      const u = new URL(url);
      if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('/')[0];
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const parts = u.pathname.split('/').filter(Boolean);
      return parts[1] || parts[0];
    } catch {
      return url;
    }
  }

  window.api = {
    getSettings: async () => ({ outDir: 'Descargas/KevTube', watchClipboard: N.getWatch() }),
    setWatch: async (v) => N.setWatch(!!v),
    openFolder: async () => N.openFolder(),
    showFile: async (f) => f && N.openFile(f),
    parseUrl: async (t) => {
      const url = extract(t);
      return url ? { url, id: videoId(url) } : null;
    },
    getInfo: (url) => call('getInfo', url),
    download: (item) => call('download', item.key, item.url, item.format),
    cancel: async () => N.cancel(),
    notify: async (msg) => N.notify(msg),
    onLink: (f) => listeners.link.push(f),
    onProgress: (f) => listeners.progress.push(f),
    onEngineStatus: (f) => listeners.engine.push(f),
  };

  // Textos adaptados al teléfono
  document.documentElement.classList.add('android');
  const empty = document.querySelector('.empty p');
  if (empty) {
    empty.innerHTML =
      'En YouTube toca <b>Compartir</b> → <b>KevTube</b>.<br />O copia el enlace y abre KevTube: se agrega solo.';
  }
  const input = document.querySelector('#pasteInput');
  if (input) input.placeholder = 'Pega aquí un enlace de YouTube…';

  // Avisar al código nativo cuando la interfaz ya está lista (app.js cargado)
  window.addEventListener('load', () => N.ready());
})();
