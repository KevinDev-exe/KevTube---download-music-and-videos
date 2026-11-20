// Lógica de descarga: independiente de la interfaz (se puede probar con Node puro).
// Usa yt-dlp (se descarga solo la primera vez) + ffmpeg (incluido vía ffmpeg-static).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const YT_REGEX =
  /(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com\/(watch\?[^\s]*v=|shorts\/|live\/|embed\/)|youtu\.be\/)[\w-]{6,}[^\s]*/i;

/** Devuelve la URL de YouTube contenida en el texto, o null. */
function extractYouTubeUrl(text) {
  if (!text || typeof text !== 'string' || text.length > 2000) return null;
  const m = text.match(YT_REGEX);
  if (!m) return null;
  let url = m[0];
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  return url;
}

/** Id del video, para no agregar el mismo dos veces. */
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

function ytdlpAssetName() {
  if (process.platform === 'win32') return 'yt-dlp.exe';
  if (process.platform === 'darwin') return 'yt-dlp_macos';
  return 'yt-dlp_linux';
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 10) return reject(new Error('Demasiadas redirecciones'));
    https
      .get(url, { headers: { 'User-Agent': 'KevTube' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(download(res.headers.location, dest, redirects + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error('HTTP ' + res.statusCode));
        }
        const tmp = dest + '.part';
        const file = fs.createWriteStream(tmp);
        res.pipe(file);
        file.on('finish', () =>
          file.close(() => {
            fs.renameSync(tmp, dest);
            resolve(dest);
          })
        );
        file.on('error', reject);
      })
      .on('error', reject);
  });
}

class Downloader {
  /**
   * @param {object} opts
   * @param {string} opts.binDir  carpeta donde vive yt-dlp
   * @param {string} opts.ffmpegPath ruta a ffmpeg
   */
  constructor({ binDir, ffmpegPath }) {
    this.binDir = binDir;
    this.ffmpegPath = ffmpegPath;
    this.ytdlp = path.join(binDir, ytdlpAssetName());
    this._ready = null;
    this.current = null; // proceso en curso
  }

  /** Asegura que yt-dlp exista (lo descarga la primera vez) e intenta actualizarlo. */
  ensureReady(onStatus = () => {}) {
    if (this._ready) return this._ready;
    this._ready = (async () => {
      fs.mkdirSync(this.binDir, { recursive: true });
      if (!fs.existsSync(this.ytdlp)) {
        onStatus('Preparando el motor de descargas (solo la primera vez)…');
        const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytdlpAssetName()}`;
        await download(url, this.ytdlp);
        if (process.platform !== 'win32') fs.chmodSync(this.ytdlp, 0o755);
      } else {
        // Actualización silenciosa en segundo plano: YouTube cambia seguido.
        this._run(['-U']).catch(() => {});
      }
      onStatus(null);
    })().catch((e) => {
      this._ready = null;
      throw e;
    });
    return this._ready;
  }

  _run(args) {
    return new Promise((resolve, reject) => {
      const p = spawn(this.ytdlp, args, { windowsHide: true });
      let out = '';
      let err = '';
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (err += d));
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(lastLine(err) || 'yt-dlp falló'))));
    });
  }

  /** Obtiene título, duración y miniatura. */
  async getInfo(url) {
    await this.ensureReady();
    const out = await this._run([
      '--no-playlist',
      '--skip-download',
      '--no-warnings',
      '-O',
      '%(.{id,title,duration_string,thumbnail,uploader})j',
      url,
    ]);
    const info = JSON.parse(out.trim().split('\n').pop());
    return {
      id: info.id,
      title: info.title || url,
      duration: !info.duration_string ? '' : info.duration_string.includes(':') ? info.duration_string : '0:' + info.duration_string.padStart(2, '0'),
      thumbnail: info.thumbnail || `https://i.ytimg.com/vi/${info.id}/mqdefault.jpg`,
      uploader: info.uploader || '',
    };
  }

  /**
   * Descarga un elemento.
   * @param {{url:string, format:'mp3'|'mp4'}} item
   * @param {string} outDir
   * @param {(percent:number)=>void} onProgress
   * @returns {Promise<string>} ruta del archivo final
   */
  async downloadItem(item, outDir, onProgress = () => {}) {
    await this.ensureReady();
    // Organizado por formato: <carpeta>/MP3 y <carpeta>/MP4
    outDir = path.join(outDir, item.format === 'mp4' ? 'MP4' : 'MP3');
    fs.mkdirSync(outDir, { recursive: true });

    // YouTube a veces responde 403 de forma pasajera: se reintenta solo.
    // El último intento usa un formato más simple, que suele pasar.
    const MAX = 3;
    this.cancelled = false;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this._downloadOnce(item, outDir, onProgress, attempt === MAX);
      } catch (e) {
        if (this.cancelled) throw new Error('Cancelado');
        if (attempt >= MAX || !e.retryable) throw e;
        onProgress(0);
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
  }

  _downloadOnce(item, outDir, onProgress, simple) {
    const common = [
      '--retries',
      '10',
      '--fragment-retries',
      '10',
      '--extractor-retries',
      '3',
      '--no-playlist',
      '--newline',
      '--no-warnings',
      '--ffmpeg-location',
      this.ffmpegPath,
      '--progress-template',
      'download:PROGRESS %(progress._percent_str)s',
      '--print',
      'after_move:FILE %(filepath)s',
      '--windows-filenames',
      '-o',
      path.join(outDir, '%(title).150B.%(ext)s'),
    ];

    const formatArgs =
      item.format === 'mp4'
        ? ['-f', simple ? 'bv*+ba/b' : 'bv*[ext=mp4][height<=1080]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b', '--merge-output-format', 'mp4']
        : ['-x', '--audio-format', 'mp3', '--audio-quality', '0', '--embed-metadata', ...(simple ? ['-f', 'ba/b'] : ['--embed-thumbnail'])];

    const args = [...formatArgs, ...common, item.url];

    return new Promise((resolve, reject) => {
      const p = spawn(this.ytdlp, args, { windowsHide: true });
      this.current = p;
      let filePath = null;
      let err = '';
      // Con video+audio hay dos descargas; repartimos la barra para que no "regrese".
      let stage = 0;
      let lastPct = 0;
      const stages = item.format === 'mp4' ? 2 : 1;

      const handle = (line) => {
        line = line.trim();
        const m = line.match(/^PROGRESS\s+([\d.]+)%/);
        if (m) {
          const pct = parseFloat(m[1]);
          if (pct + 5 < lastPct && stage < stages - 1) stage++;
          lastPct = pct;
          const overall = ((stage + pct / 100) / stages) * 95; // 5% final = conversión
          onProgress(Math.min(95, overall));
        } else if (line.startsWith('FILE ')) {
          filePath = line.slice(5);
        }
      };

      let buf = '';
      p.stdout.on('data', (d) => {
        buf += d.toString();
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        lines.forEach(handle);
      });
      p.stderr.on('data', (d) => (err += d));
      p.on('error', reject);
      p.on('close', (code) => {
        this.current = null;
        if (buf) handle(buf);
        if (code === 0) {
          onProgress(100);
          resolve(filePath);
        } else if (code === null || this.cancelled) {
          reject(new Error('Cancelado'));
        } else {
          const e = new Error(friendlyError(err));
          // 403 / cortes de red: vale la pena reintentar
          e.retryable = /HTTP Error 403|Forbidden|HTTP Error 5\d\d|timed out|Connection reset|IncompleteRead/i.test(err);
          reject(e);
        }
      });
    });
  }

  cancel() {
    this.cancelled = true;
    if (this.current) this.current.kill();
  }
}

function lastLine(s) {
  return (s || '').trim().split('\n').pop();
}

function friendlyError(err) {
  const l = lastLine(err);
  if (/Private video/i.test(err)) return 'El video es privado';
  if (/Video unavailable/i.test(err)) return 'Video no disponible';
  if (/Sign in to confirm your age/i.test(err)) return 'Requiere verificación de edad';
  if (/getaddrinfo|Unable to download webpage/i.test(err)) return 'Sin conexión a internet';
  if (/HTTP Error 403|Forbidden/i.test(err)) return 'YouTube bloqueó la descarga por un momento';
  if (/Sign in to confirm you.?re not a bot/i.test(err)) return 'YouTube pidió verificación, intenta en unos minutos';
  return l.replace(/^ERROR:\s*/, '') || 'Error desconocido';
}

module.exports = { Downloader, extractYouTubeUrl, videoId };
