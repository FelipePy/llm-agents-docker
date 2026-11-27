package dev.llmagent.jarvis

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

/**
 * O Jarvis do PC no celular: a mesma interface (servida pelo PC pelo tailscale serve) numa WebView,
 * com o microfone liberado so para o endereco do PC.
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var connect: View
    private lateinit var message: TextView
    private lateinit var linkField: EditText
    private lateinit var retry: Button
    private val prefs by lazy { getSharedPreferences("jarvis", MODE_PRIVATE) }

    /** Pedido de microfone da pagina, esperando a permissao do Android. */
    private var pendingMic: PermissionRequest? = null

    private fun savedLink(): JarvisLink? = prefs.getString(KEY_LINK, null)?.let(JarvisLink::parse)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        web = findViewById(R.id.web)
        connect = findViewById(R.id.connect)
        message = findViewById(R.id.message)
        linkField = findViewById(R.id.link)
        retry = findViewById(R.id.retry)

        // Android 15: o app desenha atras das barras; o conteudo fica entre elas (e acima do teclado).
        if (Build.VERSION.SDK_INT >= 35) {
            findViewById<View>(R.id.root).setOnApplyWindowInsetsListener { v, insets ->
                val i = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime() or WindowInsets.Type.displayCutout())
                v.setPadding(i.left, i.top, i.right, i.bottom)
                insets
            }
        }

        setupWeb()
        findViewById<Button>(R.id.scan).setOnClickListener { scan() }
        findViewById<Button>(R.id.connect_button).setOnClickListener { use(linkField.text.toString()) }
        retry.setOnClickListener { open() }

        if (savedLink() != null) open() else showConnect(null)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWeb() {
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // A voz do Jarvis toca sem esperar um toque na tela.
            mediaPlaybackRequiresUserGesture = false
            textZoom = 100
            setSupportZoom(false)
        }
        web.webViewClient = object : WebViewClient() {
            // Paginas do PC ficam no app; links de fora (noticias, GitHub) abrem no navegador.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if ("${url.scheme}://${url.authority}" == savedLink()?.origin) return false
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, url))
                } catch (e: ActivityNotFoundException) {
                    // sem app para abrir: ignora
                }
                return true
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) {
                    showConnect(
                        "Não consegui falar com o PC (${savedLink()?.host}): ${error.description}.\n\n" +
                            "Confira se o PC está ligado e se o Tailscale está conectado no PC e neste celular.",
                    )
                }
            }

            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                if (request.isForMainFrame && response.statusCode >= 500) {
                    showConnect(
                        "O PC respondeu, mas o Jarvis não está rodando nele (erro ${response.statusCode}).\n\n" +
                            "Abra o Jarvis no PC (ou rode “llm-agent ui”) e tente de novo.",
                    )
                }
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                val origin = request.origin.toString().trimEnd('/')
                val wantsMic = PermissionRequest.RESOURCE_AUDIO_CAPTURE in request.resources
                if (!wantsMic || origin != savedLink()?.origin) {
                    request.deny()
                    return
                }
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                } else {
                    pendingMic?.deny()
                    pendingMic = request
                    requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_MIC)
                }
            }

            override fun onPermissionRequestCanceled(request: PermissionRequest) {
                if (pendingMic === request) pendingMic = null
            }
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQUEST_MIC) return
        val request = pendingMic ?: return
        pendingMic = null
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
        } else {
            request.deny()
        }
    }

    /** Leitor de QR code do Google Play services (a camera fica com ele, sem permissao no app). */
    private fun scan() {
        val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
        GmsBarcodeScanning.getClient(this, options)
            .startScan()
            .addOnSuccessListener { code -> use(code.rawValue ?: "") }
            .addOnFailureListener { e ->
                if (e.message?.contains("cancel", ignoreCase = true) != true) {
                    showConnect("Não consegui abrir o leitor de QR code (${e.message}). Cole o link mostrado no PC.")
                }
            }
    }

    private fun use(raw: String) {
        val link = JarvisLink.parse(raw)
        if (link == null) {
            showConnect("Esse não é o link do Jarvis. Ele começa com https:// e termina com #token=… (Configurações → Celular, no PC).")
            return
        }
        prefs.edit().putString(KEY_LINK, link.url).apply()
        linkField.setText("")
        open()
    }

    private fun open() {
        val link = savedLink() ?: return showConnect(null)
        connect.visibility = View.GONE
        web.visibility = View.VISIBLE
        // Com o Jarvis aberto a tela nao apaga (a escuta continua precisa dela ligada).
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        web.loadUrl(link.url)
    }

    /** Tela de conexao; com `problem`, explica o que deu errado e oferece tentar de novo. */
    private fun showConnect(problem: String?) {
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        web.stopLoading()
        web.visibility = View.GONE
        connect.visibility = View.VISIBLE
        message.text = problem ?: getString(R.string.connect_intro)
        message.setTextColor(getColor(if (problem != null) R.color.error else R.color.text))
        retry.visibility = if (problem != null && savedLink() != null) View.VISIBLE else View.GONE
    }

    @Deprecated("Voltar do sistema: dentro do Jarvis, volta a pagina; no inicio, pergunta.")
    override fun onBackPressed() {
        if (web.visibility == View.VISIBLE && web.canGoBack()) {
            web.goBack()
            return
        }
        AlertDialog.Builder(this)
            .setTitle("Jarvis")
            .setItems(arrayOf("Sair", "Trocar de PC")) { _, which ->
                if (which == 0) {
                    finish()
                } else {
                    prefs.edit().remove(KEY_LINK).apply()
                    web.loadUrl("about:blank")
                    showConnect(null)
                }
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    override fun onPause() {
        super.onPause()
        web.onPause()
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
    }

    override fun onDestroy() {
        pendingMic?.deny()
        web.destroy()
        super.onDestroy()
    }

    private companion object {
        const val KEY_LINK = "link"
        const val REQUEST_MIC = 1
    }
}
