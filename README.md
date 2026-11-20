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
│       └── renderer/       ← la interfaz que ve el usuario (la usan escritorio Y celular)
│           ├── index.html  ← estructura de la pantalla
│           ├── styles.css  ← diseño (colores, animaciones, versión para pantallas pequeñas)
│           ├── app.js      ← lógica de la lista: agregar, quitar, cambiar formato,
│           │                 descargar, alertas y contador
│           └── platform.js ← vacío en escritorio; en Android se reemplaza por mobile/web/platform.js
│
├── mobile/                 ← App Android (Kotlin)
│   ├── build.gradle.kts    ← versiones del plugin de Android y Kotlin
│   ├── settings.gradle.kts ← nombre del proyecto y repositorios
│   ├── gradlew / gradlew.bat ← Gradle (compila la app sin instalar nada extra)
│   ├── web/
│   │   └── platform.js     ← conecta la interfaz con Android (window.api)
│   └── app/
│       ├── build.gradle.kts ← versión de la app, dependencias, firma del APK
│       └── src/main/
│           ├── AndroidManifest.xml ← permisos y opción "Compartir → KevTube"
│           ├── java/com/kevtube/app/MainActivity.kt ← todo lo nativo: motor yt-dlp,
│           │       compartir, portapapeles, descargas y guardado en Descargas/KevTube
│           └── res/        ← ícono y colores de la app
│
└── install_movile/
    └── KevTube.apk         ← instalador para teléfonos Android
```

> **Una sola interfaz para todo:** la pantalla del celular es la misma de escritorio (`desktop/src/renderer`). Al compilar Android se copia sola, así que si cambias el diseño, cambia en ambos.

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

> El instalador de escritorio (`dist/`) **no** se sube al repositorio porque pesa ~100 MB. Para compartirlos usa **GitHub Releases** (en tu repositorio: *Releases → Draft a new release* y adjuntas el `.exe`).

---

## 📱 App Android

El instalador listo está en [`install_movile/KevTube.apk`](install_movile/). Las instrucciones para instalarlo en el teléfono están en [install_movile/README.md](install_movile/README.md).

En el teléfono se agrega un video de dos formas:
- **Compartir → KevTube** desde YouTube.
- **Copiar enlace** y abrir KevTube (lo detecta al abrir; Android no deja leer el portapapeles en segundo plano).

### Requisitos para compilar

- **Android Studio** instalado (trae el SDK de Android y Java).
- O, sin Android Studio: Java 17+ y el Android SDK, con `sdk.dir` en `mobile/local.properties`.

### Generar el APK

```powershell
cd mobile
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat assembleRelease
```

El APK queda en `mobile/app/build/outputs/apk/release/app-release.apk`. Cópialo a `install_movile/KevTube.apk`.

| Opción | Comando |
|---|---|
| APK para probar en el emulador de Android Studio (x86_64) | `.\gradlew.bat assembleDebug -Pabis=x86_64` |
| Instalarlo en un teléfono conectado por USB | `.\gradlew.bat installDebug` |

Para cambiar la versión de la app, edita `versionCode` y `versionName` en `mobile/app/build.gradle.kts`.

> El APK se firma con la llave de depuración. Sirve para instalarlo directo en cualquier teléfono, pero para publicarlo en la Play Store hay que crear una llave propia.

| Pieza (Android) | Para qué sirve |
|---|---|
| **youtubedl-android** | Trae yt-dlp, Python y ffmpeg dentro de la app. KevTube actualiza yt-dlp cada vez que se abre. |
| **WebView** | Muestra la misma interfaz HTML de escritorio. |
| **MediaStore** | Guarda los archivos en `Descargas/KevTube/MP3` y `MP4`. |

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
