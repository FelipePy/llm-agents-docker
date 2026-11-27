plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Assinatura do APK: com a chave do CI (segredos), as atualizacoes instalam por cima;
// sem ela, a chave de depuracao (cada maquina tem a sua: troca de chave exige desinstalar).
val keystoreFile = System.getenv("JARVIS_KEYSTORE")?.let { file(it) }?.takeIf { it.exists() }

android {
    namespace = "dev.llmagent.jarvis"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.llmagent.jarvis"
        minSdk = 26
        targetSdk = 35
        versionCode = (project.findProperty("jarvisVersionCode") as String?)?.toInt() ?: 1
        versionName = (project.findProperty("jarvisVersionName") as String?) ?: "0.1.0"
    }

    signingConfigs {
        if (keystoreFile != null) {
            create("jarvis") {
                storeFile = keystoreFile
                storePassword = System.getenv("JARVIS_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("JARVIS_KEY_ALIAS")
                keyPassword = System.getenv("JARVIS_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("jarvis") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // Leitor de QR code do Google Play services: sem permissao de camera no app.
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
    testImplementation("junit:junit:4.13.2")
}
