package dev.llmagent.jarvis

import android.annotation.TargetApi
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import java.util.concurrent.Executor

/**
 * Com o microfone aberto (eco cancelado), a WebView poe o Android em modo de chamada, que toca a voz no fone de
 * ouvido do aparelho, baixinho, como numa ligacao. Aqui a voz volta para o alto-falante; fone com fio ou bluetooth
 * continuam valendo.
 */
interface SpeakerRoute {
    fun start()
    fun stop()

    companion object {
        fun create(audio: AudioManager): SpeakerRoute =
            if (Build.VERSION.SDK_INT >= 31) ModernSpeakerRoute(audio) else LegacySpeakerRoute(audio)

        /** Em modo de chamada, saindo pelo fone de ouvido do aparelho (ou sem saida definida): vai para o alto-falante. */
        fun useSpeaker(mode: Int, device: Int?): Boolean =
            mode == AudioManager.MODE_IN_COMMUNICATION && (device == null || device == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE)
    }
}

/** Android 12+: o sistema avisa quando entra em modo de chamada ou troca a saida. */
@TargetApi(31)
private class ModernSpeakerRoute(private val audio: AudioManager) : SpeakerRoute {
    private val handler = Handler(Looper.getMainLooper())
    private val main = Executor { handler.post(it) }
    private val modeListener = AudioManager.OnModeChangedListener { apply() }
    private val deviceListener = AudioManager.OnCommunicationDeviceChangedListener { apply() }
    private var running = false

    /** Mudamos a saida de chamada para o alto-falante (para desfazer ao sair). */
    private var changed = false

    override fun start() {
        if (running) return
        running = true
        audio.addOnModeChangedListener(main, modeListener)
        audio.addOnCommunicationDeviceChangedListener(main, deviceListener)
        apply()
    }

    override fun stop() {
        if (!running) return
        running = false
        audio.removeOnModeChangedListener(modeListener)
        audio.removeOnCommunicationDeviceChangedListener(deviceListener)
        if (changed) audio.clearCommunicationDevice()
        changed = false
    }

    private fun apply() {
        if (!running || !SpeakerRoute.useSpeaker(audio.mode, audio.communicationDevice?.type)) return
        val speaker = audio.availableCommunicationDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
        if (speaker != null && audio.setCommunicationDevice(speaker)) changed = true
    }
}

/** Antes do Android 12 nao ha aviso de troca de modo: confere de tempos em tempos. */
@Suppress("DEPRECATION")
private class LegacySpeakerRoute(private val audio: AudioManager) : SpeakerRoute {
    private val handler = Handler(Looper.getMainLooper())
    private var changed = false
    private val poll = object : Runnable {
        override fun run() {
            apply()
            handler.postDelayed(this, POLL_MS)
        }
    }

    override fun start() {
        handler.removeCallbacks(poll)
        handler.post(poll)
    }

    override fun stop() {
        handler.removeCallbacks(poll)
        if (changed) audio.isSpeakerphoneOn = false
        changed = false
    }

    private fun apply() {
        val other = audio.isSpeakerphoneOn || audio.isWiredHeadsetOn || audio.isBluetoothScoOn || audio.isBluetoothA2dpOn
        if (other || !SpeakerRoute.useSpeaker(audio.mode, null)) return
        audio.isSpeakerphoneOn = true
        changed = true
    }

    private companion object {
        const val POLL_MS = 1_000L
    }
}
