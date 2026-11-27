package dev.llmagent.jarvis

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class JarvisLinkTest {
    @Test
    fun aceitaOLinkDoQrCode() {
        val link = JarvisLink.parse("  https://PC.tail1.ts.net/#token=abc%2Fdef ")!!
        assertEquals("https://pc.tail1.ts.net", link.origin)
        assertEquals("https://pc.tail1.ts.net/#token=abc%2Fdef", link.url)
        assertEquals("pc.tail1.ts.net", link.host)
    }

    @Test
    fun guardaAPortaQuandoNaoEAPadrao() {
        assertEquals("https://pc.tail1.ts.net:8443", JarvisLink.parse("https://pc.tail1.ts.net:8443/#token=t")!!.origin)
        assertEquals("https://pc.tail1.ts.net", JarvisLink.parse("https://pc.tail1.ts.net:443/#token=t")!!.origin)
    }

    @Test
    fun recusaSemHttpsOuSemToken() {
        assertNull(JarvisLink.parse("http://pc.tail1.ts.net/#token=t"))
        assertNull(JarvisLink.parse("https://pc.tail1.ts.net/"))
        assertNull(JarvisLink.parse("https://pc.tail1.ts.net/#token="))
        assertNull(JarvisLink.parse("qualquer coisa"))
        assertNull(JarvisLink.parse(""))
    }
}
