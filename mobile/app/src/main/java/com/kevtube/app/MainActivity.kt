package com.kevtube.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import org.json.JSONObject
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private var pageReady = false
    private val pendingLinks = mutableListOf<String>()

    private val io = Executors.newCachedThreadPool()
    private val downloads = Executors.newSingleThreadExecutor()
    @Volatile private var currentProcess: String? = null
    @Volatile private var cancelled = false

    private val prefs by lazy { getSharedPreferences("kevtube", MODE_PRIVATE) }

    // ---------- Motor (yt-dlp + ffmpeg) ----------
    private val engineLock = Object()
    @Volatile private var engineReady = false
    // Las descargas esperan a que termine la actualización de yt-dlp (con la versión vieja YouTube bloquea)
    private val updateDone = CountDownLatch(1)

    private fun ensureEngine() {
        if (engineReady) return
        synchronized(engineLock) {
            if (engineReady) return
            YoutubeDL.getInstance().init(applicationContext)
            FFmpeg.getInstance().init(applicationContext)
            engineReady = true
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this)
        web.setBackgroundColor(0xFF0F0F14.toInt())
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.addJavascriptInterface(Bridge(), "KevAndroid")
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)
        }
        setContentView(web)
        web.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")

        if (Build.VERSION.SDK_INT < 29 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE), 1)
        }

        // Preparar el motor y actualizar yt-dlp en segundo plano (YouTube cambia seguido)
        io.execute {
            try {
                emit("engine", JSONObject.quote("Preparando el motor de descargas…"))
                ensureEngine()
                emit("engine", "null")
                try {
                    val status = YoutubeDL.getInstance().updateYoutubeDL(applicationContext, YoutubeDL.UpdateChannel.STABLE)
                    Log.i(TAG, "Actualización yt-dlp: $status → ${YoutubeDL.getInstance().version(applicationContext)}")
                } catch (e: Exception) {
                    Log.w(TAG, "No se pudo actualizar yt-dlp", e)
                }
            } catch (e: Exception) {
                emit("engine", JSONObject.quote("No se pudo preparar el motor: ${e.message}"))
            } finally {
                updateDone.countDown()
            }
        }

        handleShare(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleShare(intent)
    }

    /** Enlace compartido desde YouTube (Compartir → KevTube) */
    private fun handleShare(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND) return
        val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return
        intent.action = null // no procesarlo dos veces
        prefs.edit().putString("lastClip", text).apply()
        sendLink(text)
    }

    /** Al volver a la app, revisa si copiaste un enlace de YouTube */
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (!hasFocus || !prefs.getBoolean("watch", true)) return
        val cm = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
        val text = try {
            cm.primaryClip?.getItemAt(0)?.coerceToText(this)?.toString()
        } catch (_: Exception) {
            null
        } ?: return
        if (text == prefs.getString("lastClip", null)) return
        prefs.edit().putString("lastClip", text).apply()
        sendLink(text)
    }

    private fun sendLink(text: String) {
        if (!YT_REGEX.containsMatchIn(text)) return
        runOnUiThread {
            if (pageReady) pushLink(text) else pendingLinks.add(text)
        }
    }

    private fun pushLink(text: String) {
        web.evaluateJavascript(
            "window.api.parseUrl(${JSONObject.quote(text)}).then(function(l){ if(l) window.__kev.emit('link', l); })",
            null
        )
    }

    private fun js(code: String) = runOnUiThread { web.evaluateJavascript(code, null) }
    private fun emit(type: String, json: String) = js("window.__kev && window.__kev.emit('$type', $json)")
    private fun resolve(id: String, json: String) = js("window.__kev.resolve('$id', $json)")
    private fun reject(id: String, msg: String) = js("window.__kev.reject('$id', ${JSONObject.quote(msg)})")

    // ---------- Puente con la interfaz ----------
    inner class Bridge {
        @JavascriptInterface
        fun ready() = runOnUiThread {
            pageReady = true
            pendingLinks.forEach { pushLink(it) }
            pendingLinks.clear()
        }

        @JavascriptInterface
        fun getWatch(): Boolean = prefs.getBoolean("watch", true)

        @JavascriptInterface
        fun setWatch(v: Boolean) = prefs.edit().putBoolean("watch", v).apply()

        @JavascriptInterface
        fun getInfo(id: String, url: String) = io.execute {
            try {
                ensureEngine()
                val info = YoutubeDL.getInstance().getInfo(url)
                val secs = info.duration
                val json = JSONObject()
                    .put("id", info.id)
                    .put("title", info.title ?: url)
                    .put("duration", formatDuration(secs))
                    .put("thumbnail", info.thumbnail ?: "https://i.ytimg.com/vi/${info.id}/mqdefault.jpg")
                    .put("uploader", info.uploader ?: "")
                resolve(id, json.toString())
            } catch (e: Exception) {
                reject(id, friendlyError(e.message ?: ""))
            }
        }

        @JavascriptInterface
        fun download(id: String, key: String, url: String, format: String) = downloads.execute {
            runOnUiThread { window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
            try {
                ensureEngine()
                if (updateDone.count > 0) {
                    emit("engine", JSONObject.quote("Actualizando el motor de descargas…"))
                    updateDone.await(90, TimeUnit.SECONDS)
                    emit("engine", "null")
                }
                val uri = downloadWithRetry(key, url, format)
                resolve(id, JSONObject.quote(uri))
            } catch (e: Exception) {
                reject(id, if (cancelled) "Cancelado" else friendlyError(e.message ?: ""))
            } finally {
                runOnUiThread { window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
            }
        }

        @JavascriptInterface
        fun cancel() {
            cancelled = true
            currentProcess?.let { YoutubeDL.getInstance().destroyProcessById(it) }
        }

        @JavascriptInterface
        fun openFolder() = runOnUiThread {
            try {
                startActivity(Intent(DownloadManager.ACTION_VIEW_DOWNLOADS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (_: Exception) {
                Toast.makeText(this@MainActivity, "Busca la carpeta Descargas/KevTube", Toast.LENGTH_LONG).show()
            }
        }

        @JavascriptInterface
        fun openFile(path: String) = runOnUiThread {
            try {
                val uri = if (path.startsWith("content://")) Uri.parse(path) else null
                if (uri == null) return@runOnUiThread openFolder()
                val mime = contentResolver.getType(uri) ?: "*/*"
                startActivity(
                    Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                )
            } catch (_: Exception) {
                openFolder()
            }
        }

        @JavascriptInterface
        fun notify(msg: String) {
            if (!hasWindowFocus()) runOnUiThread { Toast.makeText(this@MainActivity, msg, Toast.LENGTH_SHORT).show() }
        }
    }

    // ---------- Descarga ----------
    private fun downloadWithRetry(key: String, url: String, format: String): String {
        cancelled = false
        val max = 3
        var attempt = 1
        while (true) {
            try {
                return downloadOnce(key, url, format, simple = attempt == max)
            } catch (e: Exception) {
                if (cancelled) throw e
                val msg = e.message ?: ""
                Log.w(TAG, "Intento $attempt falló ($format): ${msg.takeLast(800)}")
                val retryable = Regex("HTTP Error 403|Forbidden|HTTP Error 5\\d\\d|timed out|Connection reset").containsMatchIn(msg)
                if (attempt >= max || !retryable) throw e
                progress(key, 0f)
                Thread.sleep(1500L * attempt)
                attempt++
            }
        }
    }

    private fun downloadOnce(key: String, url: String, format: String, simple: Boolean): String {
        val tmp = File(cacheDir, "dl/$key").apply { deleteRecursively(); mkdirs() }
        val req = YoutubeDLRequest(url).apply {
            addOption("--no-playlist")
            addOption("--newline")
            addOption("--retries", "10")
            addOption("--fragment-retries", "10")
            addOption("-o", "${tmp.absolutePath}/%(title).150B.%(ext)s")
            if (format == "mp4") {
                addOption("-f", if (simple) "bv*+ba/b" else "bv*[ext=mp4][height<=1080]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b")
                addOption("--merge-output-format", "mp4")
            } else {
                if (simple) addOption("-f", "ba/b")
                addOption("-x")
                addOption("--audio-format", "mp3")
                addOption("--audio-quality", "0")
                addOption("--embed-metadata")
            }
        }

        // Con video + audio son dos descargas: repartimos la barra para que no "regrese"
        val stages = if (format == "mp4") 2 else 1
        var stage = 0
        var last = 0f
        val processId = "kev-$key"
        currentProcess = processId
        try {
            YoutubeDL.getInstance().execute(req, processId) { pct, _, _ ->
                if (pct < 0) return@execute
                if (pct + 5 < last && stage < stages - 1) stage++
                last = pct
                progress(key, ((stage + pct / 100f) / stages) * 95f)
            }
        } finally {
            currentProcess = null
        }

        val file = tmp.listFiles()?.filter { it.isFile && !it.name.endsWith(".part") }?.maxByOrNull { it.length() }
            ?: throw Exception("No se encontró el archivo descargado")
        val result = publish(file, format)
        tmp.deleteRecursively()
        progress(key, 100f)
        return result
    }

    private fun progress(key: String, pct: Float) =
        emit("progress", JSONObject().put("key", key).put("pct", pct.toDouble().coerceIn(0.0, 100.0)).toString())

    /** Copia el archivo a Descargas/KevTube/MP3 o MP4 */
    private fun publish(file: File, format: String): String {
        val sub = if (format == "mp4") "MP4" else "MP3"
        val mime = if (format == "mp4") "video/mp4" else "audio/mpeg"
        if (Build.VERSION.SDK_INT >= 29) {
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, file.name)
                put(MediaStore.MediaColumns.MIME_TYPE, mime)
                put(MediaStore.MediaColumns.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/KevTube/$sub")
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw Exception("No se pudo guardar en Descargas")
            contentResolver.openOutputStream(uri)!!.use { out -> file.inputStream().use { it.copyTo(out) } }
            values.clear()
            values.put(MediaStore.MediaColumns.IS_PENDING, 0)
            contentResolver.update(uri, values, null, null)
            return uri.toString()
        } else {
            @Suppress("DEPRECATION")
            val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "KevTube/$sub")
            dir.mkdirs()
            val dest = File(dir, file.name)
            file.copyTo(dest, overwrite = true)
            MediaScannerConnection.scanFile(this, arrayOf(dest.absolutePath), arrayOf(mime), null)
            return dest.absolutePath
        }
    }

    companion object {
        const val TAG = "KevTube"
        val YT_REGEX = Regex(
            "(https?://)?(www\\.|m\\.|music\\.)?(youtube\\.com/(watch\\?\\S*v=|shorts/|live/|embed/)|youtu\\.be/)[\\w-]{6,}",
            RegexOption.IGNORE_CASE
        )

        fun formatDuration(secs: Int): String {
            if (secs <= 0) return ""
            val h = secs / 3600
            val m = (secs % 3600) / 60
            val s = secs % 60
            return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
        }

        fun friendlyError(err: String): String = when {
            err.contains("Private video", true) -> "El video es privado"
            err.contains("Video unavailable", true) -> "Video no disponible"
            err.contains("confirm your age", true) -> "Requiere verificación de edad"
            err.contains("not a bot", true) -> "YouTube pidió verificación, intenta en unos minutos"
            err.contains("HTTP Error 403") || err.contains("Forbidden") -> "YouTube bloqueó la descarga por un momento"
            err.contains("Unable to download webpage", true) || err.contains("getaddrinfo") -> "Sin conexión a internet"
            else -> err.lines().lastOrNull { it.isNotBlank() }?.removePrefix("ERROR: ")?.take(160) ?: "Error desconocido"
        }
    }
}
