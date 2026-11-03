import io
import json
import unittest
import wave

from jarvis_voice.groq import GroqError, GroqStt, pcm_to_wav


class FakeResponse:
    def __init__(self, status, body):
        self.status = status
        self._body = body

    def read(self):
        return self._body


class FakeConn:
    """Responde em ordem; uma excecao na lista simula a conexao caida."""

    def __init__(self, replies, log):
        self.replies = replies
        self.log = log

    def request(self, method, path, body=None, headers=None):
        self.log.append((method, path, body, headers))
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        self.reply = reply

    def getresponse(self):
        return self.reply

    def close(self):
        self.log.append("close")


def make(replies, connections=None):
    log = []
    made = []

    def connect():
        conn = FakeConn(replies, log)
        made.append(conn)
        return conn

    return GroqStt("gsk_test", "whisper-large-v3-turbo", connect=connect), log, made


class GroqTest(unittest.TestCase):
    def test_wav_header(self):
        with wave.open(io.BytesIO(pcm_to_wav(b"\x00\x00" * 160))) as w:
            self.assertEqual((w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()), (1, 2, 16000, 160))

    def test_sends_audio_language_and_prompt(self):
        stt, log, _ = make([FakeResponse(200, json.dumps({"text": " Abre o meu-app. "}).encode())])
        self.assertEqual(stt.transcribe(b"\x01\x00" * 100, "Jarvis meu-app"), "Abre o meu-app.")
        method, path, body, headers = log[0]
        self.assertEqual((method, path), ("POST", "/openai/v1/audio/transcriptions"))
        self.assertEqual(headers["Authorization"], "Bearer gsk_test")
        self.assertIn(b'name="language"\r\n\r\npt\r\n', body)
        self.assertIn(b'name="model"\r\n\r\nwhisper-large-v3-turbo\r\n', body)
        self.assertIn(b'name="prompt"\r\n\r\nJarvis meu-app\r\n', body)
        self.assertIn(b"RIFF", body)

    def test_reuses_connection_and_reconnects_once(self):
        ok = FakeResponse(200, b'{"text": "oi"}')
        stt, _, made = make([ok, ok, OSError("caiu"), ok])
        stt.transcribe(b"\x00\x00")
        stt.transcribe(b"\x00\x00")
        self.assertEqual(len(made), 1)
        self.assertEqual(stt.transcribe(b"\x00\x00"), "oi")
        self.assertEqual(len(made), 2)

    def test_errors(self):
        for status, text in ((401, "chave"), (429, "limite"), (500, "500")):
            stt, _, _ = make([FakeResponse(status, b"{}")])
            with self.assertRaisesRegex(GroqError, text):
                stt.transcribe(b"\x00\x00")
        stt, _, _ = make([OSError("a"), OSError("b")])
        with self.assertRaisesRegex(GroqError, "sem conexão"):
            stt.transcribe(b"\x00\x00")


if __name__ == "__main__":
    unittest.main()
