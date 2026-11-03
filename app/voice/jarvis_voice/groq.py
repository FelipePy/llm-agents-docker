"""Transcricao no Groq (whisper na nuvem), sem dependencias extras.

Mantem uma conexao HTTPS aberta entre as falas (economiza o aperto de mao TLS).
"""
import http.client
import io
import json
import uuid
import wave

HOST = "api.groq.com"
PATH = "/openai/v1/audio/transcriptions"
TIMEOUT_S = 8
PROMPT_MAX_CHARS = 600  # o Groq aceita ate ~224 tokens de prompt


def pcm_to_wav(pcm: bytes, rate: int = 16000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


def multipart(fields: dict, file_name: str, file_data: bytes, boundary: str) -> bytes:
    out = io.BytesIO()
    for name, value in fields.items():
        out.write(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode("utf-8"))
    out.write(
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{file_name}"\r\n'
        "Content-Type: audio/wav\r\n\r\n".encode("utf-8")
    )
    out.write(file_data)
    out.write(f"\r\n--{boundary}--\r\n".encode("utf-8"))
    return out.getvalue()


class GroqError(Exception):
    pass


class GroqStt:
    def __init__(self, key: str, model: str, connect=None):
        self.key = key
        self.model = model
        self._connect = connect or (lambda: http.client.HTTPSConnection(HOST, timeout=TIMEOUT_S))
        self._conn = None

    def transcribe(self, pcm: bytes, prompt: str = "") -> str:
        fields = {"model": self.model, "language": "pt", "temperature": "0", "response_format": "json"}
        if prompt:
            fields["prompt"] = prompt[:PROMPT_MAX_CHARS]
        boundary = uuid.uuid4().hex
        body = multipart(fields, "fala.wav", pcm_to_wav(pcm), boundary)
        headers = {
            "Authorization": f"Bearer {self.key}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        }
        # Uma nova tentativa se a conexao guardada tiver caido.
        for attempt in (0, 1):
            if self._conn is None:
                self._conn = self._connect()
            try:
                self._conn.request("POST", PATH, body=body, headers=headers)
                res = self._conn.getresponse()
                data = res.read()
            except (OSError, http.client.HTTPException) as err:
                self.close()
                if attempt:
                    raise GroqError(f"sem conexão com o Groq ({err})") from err
                continue
            if res.status == 200:
                return str(json.loads(data).get("text", "")).strip()
            if res.status in (401, 403):
                raise GroqError("o Groq recusou a chave de API")
            if res.status == 429:
                raise GroqError("limite de uso do Groq atingido")
            raise GroqError(f"o Groq respondeu {res.status}")
        raise GroqError("sem conexão com o Groq")

    def close(self) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None
