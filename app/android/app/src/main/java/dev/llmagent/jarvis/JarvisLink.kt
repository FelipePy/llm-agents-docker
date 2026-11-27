package dev.llmagent.jarvis

import java.net.URI
import java.net.URISyntaxException

/** Link de conexao com o PC: https://<pc>.ts.net/#token=... (o QR code das configuracoes do Jarvis). */
data class JarvisLink(
    /** https://<host>[:porta]: so esta origem ganha o microfone e fica dentro do app. */
    val origin: String,
    /** Pagina aberta, com o token no fragmento (a interface guarda e tira da barra). */
    val url: String,
) {
    val host: String get() = origin.removePrefix("https://")

    companion object {
        private val TOKEN = Regex("(?:^|&)token=([^&]+)")

        /** Link valido ou null: so HTTPS (o microfone exige) e com token. */
        fun parse(raw: String): JarvisLink? {
            val uri = try {
                URI(raw.trim())
            } catch (e: URISyntaxException) {
                return null
            }
            val host = uri.host?.lowercase() ?: return null
            if (uri.scheme?.lowercase() != "https" || host.isEmpty()) return null
            val token = TOKEN.find(uri.rawFragment ?: "")?.groupValues?.get(1) ?: return null
            val port = if (uri.port == -1 || uri.port == 443) "" else ":${uri.port}"
            val origin = "https://$host$port"
            return JarvisLink(origin, "$origin/#token=$token")
        }
    }
}
