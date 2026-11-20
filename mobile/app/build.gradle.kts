plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.kevtube.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.kevtube.app"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
        // Teléfonos reales (32 y 64 bits). Para probar en el emulador: -Pabis=x86_64
        val abis = (project.findProperty("abis") as String?)?.split(",") ?: listOf("arm64-v8a", "armeabi-v7a")
        ndk { abiFilters += abis }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Firmado con la llave de depuración: sirve para instalar el APK directo.
            // Para publicar en Play Store hay que crear una llave propia.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // yt-dlp para Android necesita las librerías nativas extraídas
    packaging { jniLibs { useLegacyPackaging = true } }

    // La interfaz web se toma de la app de escritorio (misma pantalla en ambos)
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/webassets"))
}

kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}

val copyWeb by tasks.registering(Sync::class) {
    from("../../desktop/src/renderer") { exclude("platform.js") }
    from("../web")
    into(layout.buildDirectory.dir("generated/webassets/www"))
}
tasks.named("preBuild") { dependsOn(copyWeb) }

dependencies {
    implementation("io.github.junkfood02.youtubedl-android:library:0.18.1")
    implementation("io.github.junkfood02.youtubedl-android:ffmpeg:0.18.1")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.11.0")
}
