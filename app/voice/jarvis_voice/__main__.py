"""Worker de voz do Jarvis.

Le do stdin audio PCM (16 kHz, mono, 16 bits) e comandos JSON; escreve eventos
JSON no stdout (ver protocol.py). Logs vao para o stderr.
"""
import asyncio
import base64
import json
import os
import sys
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor

from .protocol import JSON, encode_json, read_message
from .segmenter import Segmenter

FRAME_SAMPLES = 1280  # 80 ms a 16 kHz
FRAME_BYTES = FRAME_SAMPLES * 2
WAKE_DEBOUNCE_S = 2.0

_lock = threading.Lock()


def send(obj) -> None:
    data = encode_json(obj)
    with _lock:
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def load_whisper(name: str):
    from faster_whisper import WhisperModel

    try:
        return WhisperModel(name, device="auto", compute_type="default")
    except Exception as err:  # sem CUDA utilizavel
        log(f"whisper: falha no modo automatico ({err}); usando CPU int8")
        return WhisperModel(name, device="cpu", compute_type="int8")


def main() -> None:
    import numpy as np

    send({"event": "status", "message": "carregando os modelos de voz"})
    from openwakeword.model import Model
    from openwakeword.vad import VAD
    import edge_tts

    wake = Model(wakeword_models=["hey_jarvis"], inference_framework="onnx")
    vad = VAD()
    whisper = load_whisper(os.environ.get("LLM_AGENT_VOICE_STT_MODEL", "small"))
    voice = os.environ.get("LLM_AGENT_VOICE", "pt-BR-AntonioNeural")
    threshold = float(os.environ.get("LLM_AGENT_VOICE_WAKE_THRESHOLD", "0.5"))

    stt_pool = ThreadPoolExecutor(max_workers=1)
    tts_pool = ThreadPoolExecutor(max_workers=1)
    state = {"listen": False, "generation": 0, "transcript": 0, "last_wake": 0.0}
    segmenter = Segmenter()

    def transcribe(segment: bytes, tid: int) -> None:
        try:
            audio = np.frombuffer(segment, dtype=np.int16).astype(np.float32) / 32768.0
            parts, _ = whisper.transcribe(audio, language="pt", beam_size=1, condition_on_previous_text=False)
            text = " ".join(p.text.strip() for p in parts).strip()
            send({"event": "transcript", "id": tid, "text": text})
        except Exception as err:
            log(traceback.format_exc())
            send({"event": "error", "message": f"falha na transcrição: {err}"})

    def speak(sid: int, text: str, generation: int) -> None:
        async def synth() -> bytes:
            chunks = []
            async for chunk in edge_tts.Communicate(text, voice).stream():
                if chunk.get("type") == "audio":
                    chunks.append(chunk["data"])
            return b"".join(chunks)

        try:
            audio = asyncio.run(synth())
            if generation == state["generation"]:
                send({"event": "audio", "id": sid, "data": base64.b64encode(audio).decode("ascii")})
        except Exception as err:
            log(traceback.format_exc())
            send({"event": "speak-error", "id": sid, "message": str(err)})

    send({"event": "ready"})
    pending = b""
    stdin = sys.stdin.buffer
    while True:
        message = read_message(stdin)
        if message is None:
            return
        kind, payload = message
        if kind == JSON:
            cmd = json.loads(payload)
            name = cmd.get("cmd")
            if name == "listen":
                state["listen"] = True
                segmenter.reset()
                vad.reset_states()
            elif name == "sleep":
                state["listen"] = False
                segmenter.reset()
            elif name == "speak":
                tts_pool.submit(speak, int(cmd["id"]), str(cmd["text"]), state["generation"])
            elif name == "cancel":
                state["generation"] += 1
            continue

        pending += payload
        while len(pending) >= FRAME_BYTES:
            frame, pending = pending[:FRAME_BYTES], pending[FRAME_BYTES:]
            samples = np.frombuffer(frame, dtype=np.int16)
            score = max(wake.predict(samples).values())
            now = time.monotonic()
            if score >= threshold and now - state["last_wake"] >= WAKE_DEBOUNCE_S:
                state["last_wake"] = now
                wake.reset()
                send({"event": "wake", "score": round(float(score), 3)})
                continue
            if state["listen"]:
                started, segment = segmenter.feed(frame, float(vad.predict(samples, frame_size=640)))
                if started:
                    send({"event": "speech-start"})
                if segment is not None:
                    state["transcript"] += 1
                    stt_pool.submit(transcribe, segment, state["transcript"])


if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        log(traceback.format_exc())
        send({"event": "error", "message": f"worker de voz parou: {err}", "fatal": True})
        sys.exit(1)
