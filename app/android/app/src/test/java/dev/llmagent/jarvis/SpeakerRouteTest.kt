package dev.llmagent.jarvis

import android.media.AudioDeviceInfo
import android.media.AudioManager
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SpeakerRouteTest {
    @Test
    fun emModoDeChamadaTiraDoFoneDoAparelho() {
        assertTrue(SpeakerRoute.useSpeaker(AudioManager.MODE_IN_COMMUNICATION, AudioDeviceInfo.TYPE_BUILTIN_EARPIECE))
        assertTrue(SpeakerRoute.useSpeaker(AudioManager.MODE_IN_COMMUNICATION, null))
    }

    @Test
    fun respeitaFonesEOModoNormal() {
        assertFalse(SpeakerRoute.useSpeaker(AudioManager.MODE_IN_COMMUNICATION, AudioDeviceInfo.TYPE_WIRED_HEADSET))
        assertFalse(SpeakerRoute.useSpeaker(AudioManager.MODE_IN_COMMUNICATION, AudioDeviceInfo.TYPE_BLUETOOTH_SCO))
        assertFalse(SpeakerRoute.useSpeaker(AudioManager.MODE_IN_COMMUNICATION, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER))
        assertFalse(SpeakerRoute.useSpeaker(AudioManager.MODE_NORMAL, AudioDeviceInfo.TYPE_BUILTIN_EARPIECE))
    }
}
