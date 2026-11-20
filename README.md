# KevTube 🎵🎬

Descargador de música (**MP3**) y video (**MP4**) desde YouTube, pensado para ser muy fácil de usar:

1. En YouTube toca **Compartir → Copiar enlace**.
2. KevTube detecta el enlace solo y lo agrega a la lista ("Agregando…" → "Agregada correctamente").
3. Cada canción sale en **MP3** por defecto. Si le das clic al formato, cambia a **MP4** (video).
4. Dale a **Descargar** y verás el progreso (`3/5 descargadas`). Cada una que termina queda con un ✔ verde.
5. Al terminar aparece **Abrir carpeta**, que te lleva directo a tus archivos.

Los archivos se guardan ordenados por formato:

```
Descargas\KevTube\
   ├── MP3\   ← canciones
   └── MP4\   ← videos
```

---

## 📁 Estructura del proyecto

```
Download-mp3-mp4/
├── README.md               ← este archivo
├── .gitignore              ← lo que NO se sube a git (node_modules, instaladores, etc.)
│
├── desktop/                ← App de escritorio (Windows / Mac / Linux)
│   ├── package.json        ← nombre, versión, dependencias y configuración del instalador
│   ├── package-lock.json   ← versiones exactas de las dependencias (no editar a mano)
│   ├── assets/
│   │   └── icon.png        ← ícono de la app y del instalador
│   └── src/
│       ├── main.js         ← "cerebro" de la app: crea la ventana, vigila el portapapeles,
│       │                     notificaciones de Windows y comunicación con la interfaz
│       ├── preload.js      ← puente seguro entre la interfaz y main.js (window.api)
│       ├── downloader.js   ← motor de descargas: usa yt-dlp + ffmpeg, progreso,
│       │                     reintentos automáticos y carpetas MP3/MP4
│       └── renderer/       ← la interfaz que ve el usuario
│           ├── index.html  ← estructura de la pantalla
│           ├── styles.css  ← diseño (colores, animaciones, versión para pantallas pequeñas)
│           └── app.js      ← lógica de la lista: agregar, quitar, cambiar formato,
│                             descargar, alertas y contador
│
└── install_movile/         ← aquí va el instalador para teléfono (APK de Android)
```

### ¿Cómo funciona por dentro?

```
 Copias un enlace ──► main.js lo detecta en el portapapeles
                          │
                          ▼
                   app.js (interfaz) lo agrega a la lista
                          │  pide título y miniatura
                          ▼
                   downloader.js ──► yt-dlp ──► YouTube
                          │                 └─► ffmpeg (convierte a MP3 / une video+audio en MP4)
                          ▼
                   Descargas\KevTube\MP3  o  \MP4
```

| Pieza | Para qué sirve |
|---|---|
| **Electron** | Permite hacer la app de escritorio con HTML, CSS y JavaScript. |
| **yt-dlp** | El programa que realmente descarga de YouTube. KevTube lo baja solo la primera vez que se abre y lo actualiza en cada inicio (YouTube cambia seguido). Se guarda en `%APPDATA%\KevTube\bin`. |
| **ffmpeg** | Convierte el audio a MP3 y une video + audio en el MP4. Viene incluido (paquete `ffmpeg-static`). |
| **electron-builder** | Genera el instalador `.exe`. |

---

## 🛠️ Requisitos

- [Node.js](https://nodejs.org) versión 20 o superior (incluye `npm`).
- Internet (la primera vez se descarga el motor yt-dlp).

Revisa que estén instalados:

```powershell
node -v
npm -v
```

---

## 📦 Instalar dependencias

```powershell
cd desktop
npm install
```

Esto crea la carpeta `desktop/node_modules` con Electron, ffmpeg y el generador de instaladores. Esa carpeta **no** se sube a git; cualquiera que clone el proyecto la vuelve a crear con `npm install`.

---

## ▶️ Abrir la app en modo desarrollo

```powershell
cd desktop
npm start
```

---

## 💿 Generar el instalador

> Cierra KevTube antes de generar el instalador.

| Sistema | Comando | Resultado |
|---|---|---|
| Windows | `npm run dist` | `desktop/dist/KevTube Setup 1.0.0.exe` |
| Mac | `npm run dist:mac` | `.dmg` (debe ejecutarse en una Mac) |
| Linux | `npm run dist:linux` | `.AppImage` |

El instalador no tiene firma digital, así que Windows puede mostrar *"Windows protegió tu PC"*. Se da clic en **Más información → Ejecutar de todas formas**.

Para cambiar la versión, edita `"version"` en `desktop/package.json` antes de generar el instalador.

> Los instaladores (`dist/`) **no** se suben al repositorio porque pesan ~100 MB. Para compartirlos usa **GitHub Releases** (en tu repositorio: *Releases → Draft a new release* y adjuntas el `.exe`).

---

## 📱 App para teléfono

La carpeta [`install_movile/`](install_movile/) es donde va el instalador para Android (`.apk`).

> Estado: **pendiente**. La app móvil aún no está construida. En Android la idea es que KevTube aparezca en el menú **Compartir** de YouTube (Compartir → KevTube), porque Android no deja que una app lea el portapapeles en segundo plano.

---

## 🩺 Solución de problemas

| Problema | Qué hacer |
|---|---|
| Un video sale con error *"YouTube bloqueó la descarga por un momento"* (403) | KevTube ya reintenta solo 3 veces. Si aún falla, espera un rato y dale **Descargar** de nuevo. |
| La app se cierra sola o algo raro pasa | Revisa el registro en `%APPDATA%\KevTube\kevtube.log`. |
| Dejó de descargar todo de repente | YouTube cambió algo. Cierra y abre KevTube para que se actualice yt-dlp. |
| No detecta los enlaces copiados | Revisa que el interruptor **Detectar enlaces copiados** esté encendido. |

---

## ⚖️ Aviso

Descargar contenido de YouTube puede ir en contra de sus términos de uso. Usa KevTube para uso personal o con contenido que tengas permiso de descargar.
