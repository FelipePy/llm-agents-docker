"""Worker de voz do Jarvis.

Le do stdin audio PCM (16 kHz, mono, 16 bits) e comandos JSON; escreve eventos
JSON no stdout (ver protocol.py). Logs vao para o stderr.
"""
import asyncio
import base64
import json
import os
import re
import sys
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor

from .protocol import JSON, encode_json, read_message
from .hallucination import looks_like_vocabulary, vocab_tokens
from .segmenter import Segmenter

FRAME_SAMPLES = 1280  # 80 ms a 16 kHz
FRAME_BYTES = FRAME_SAMPLES * 2
WAKE_DEBOUNCE_S = 2.0
PARTIAL_EVERY_FRAMES = 6  # legenda parcial a cada ~0,5 s de fala
AUDIO_CHUNK_BYTES = 2048  # envia a voz em pedacos (~0,3 s), enquanto o edge-tts gera
HEARD_MAX_BYTES = 8 * 32000  # esperando ser chamado, so transcreve falas de ate 8 s

_lock = threading.Lock()


def send(obj) -> None:
    data = encode_json(obj)
    with _lock:
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def cuda_available() -> bool:
    try:
        import ctranslate2

        return ctranslate2.get_cuda_device_count() > 0
    except Exception:
        return False


def load_whisper(name: str):
    """Modelo "auto": "small" na GPU (rapido e preciso); "base" na CPU (~3x mais rapido que o "small")."""
    from faster_whisper import WhisperModel

    gpu = cuda_available()
    if name == "auto":
        name = "small" if gpu else "base"
    if gpu:
        try:
            model = WhisperModel(name, device="cuda", compute_type="float16")
            log(f"whisper: modelo {name} na GPU")
            return model
        except Exception as err:  # bibliotecas CUDA ausentes ou incompativeis
            log(f"whisper: GPU indisponivel ({err}); usando CPU")
    log(f"whisper: modelo {name} na CPU (int8)")
    return WhisperModel(name, device="cpu", compute_type="int8")


def main() -> None:
    import numpy as np

    send({"event": "status", "message": "carregando os modelos de voz"})
    from openwakeword.model import Model
    from openwakeword.vad import VAD
    import edge_tts

    wake = Model(wakeword_models=["hey_jarvis"], inference_framework="onnx")
    vad = VAD()
    whisper = load_whisper(os.environ.get("LLM_AGENT_VOICE_STT_MODEL", "auto"))
    voice = os.environ.get("LLM_AGENT_VOICE", "pt-BR-AntonioNeural")
    # Um pouco mais rapido que o padrao do edge-tts soa mais natural numa conversa.
    rate = os.environ.get("LLM_AGENT_VOICE_RATE", "+15%")
    if not re.fullmatch(r"[+-]\d{1,2}%", rate):
        log(f"LLM_AGENT_VOICE_RATE invalido ({rate!r}); usando +15%")
        rate = "+15%"
    threshold = float(os.environ.get("LLM_AGENT_VOICE_WAKE_THRESHOLD", "0.5"))

    stt_pool = ThreadPoolExecutor(max_workers=1)
    tts_pool = ThreadPoolExecutor(max_workers=1)
    prefetch_pool = ThreadPoolExecutor(max_workers=1)
    # Audio de frases curtas ja sintetizadas (saudacoes): tocam sem esperar o edge-tts.
    tts_cache: dict = {}
    state = {"listen": False, "generation": 0, "transcript": 0, "last_wake": 0.0, "since_partial": 0, "prompt": "", "vocab": set()}
    # Chamado pelo nome ("Jarvis, ..."): esperando, transcreve falas curtas e o servidor procura o nome.
    name_wake = os.environ.get("LLM_AGENT_VOICE_NAME_WAKE", "1") != "0"
    end_ms = int(os.environ.get("LLM_AGENT_VOICE_END_MS", "500"))
    segmenter = Segmenter(end_ms=end_ms)
    stt_busy = threading.Event()

    def run_whisper(segment: bytes) -> str:
        audio = np.frombuffer(segment, dtype=np.int16).astype(np.float32) / 32768.0
        parts, _ = whisper.transcribe(
            audio,
            language="pt",
            beam_size=1,
            condition_on_previous_text=False,
            without_timestamps=True,
            # "hotwords" destaca os nomes sem trata-los como fala anterior
            # (com initial_prompt, o whisper "transcrevia" a lista em ruido).
            hotwords=state["prompt"] or None,
        )
        text = " ".join(p.text.strip() for p in parts).strip()
        if looks_like_vocabulary(text, state["vocab"]):
            log(f"transcricao descartada (eco do vocabulario): {text!r}")
            return ""
        return text

    def transcribe(segment: bytes, tid: int) -> None:
        try:
            started = time.monotonic()
            text = run_whisper(segment)
            ms = int((time.monotonic() - started) * 1000)
            log(f"transcricao final: {ms} ms para {len(segment) / 32000:.1f} s de fala")
            send({"event": "transcript", "id": tid, "text": text, "ms": ms})
        except Exception as err:
            log(traceback.format_exc())
            send({"event": "error", "message": f"falha na transcrição: {err}"})

    def transcribe_heard(segment: bytes) -> None:
        try:
            started = time.monotonic()
            text = run_whisper(segment)
            if text:
                send({"event": "heard", "text": text, "ms": int((time.monotonic() - started) * 1000)})
        except Exception:
            log(traceback.format_exc())
        finally:
            stt_busy.clear()

    def transcribe_partial(segment: bytes) -> None:
        try:
            text = run_whisper(segment)
            if text:
                send({"event": "partial", "text": text})
        except Exception:
            log(traceback.format_exc())
        finally:
            stt_busy.clear()

    async def synth_all(text: str) -> bytes:
        chunks = []
        async for chunk in edge_tts.Communicate(text, voice, rate=rate).stream():
            if chunk.get("type") == "audio":
                chunks.append(chunk["data"])
        return b"".join(chunks)

    def prefetch(texts) -> None:
        for text in texts:
            if text in tts_cache:
                continue
            try:
                tts_cache[text] = asyncio.run(synth_all(text))
            except Exception as err:
                log(f"voz: nao consegui preparar {text!r}: {err}")

    def speak(sid: int, text: str, generation: int) -> None:
        cached = tts_cache.get(text)
        if cached:
            if generation == state["generation"]:
                send({"event": "audio", "id": sid, "data": base64.b64encode(cached).decode("ascii"), "last": True})
            return

        async def synth() -> None:
            started = time.monotonic()
            first = True
            buf = b""
            whole = []
            async for chunk in edge_tts.Communicate(text, voice, rate=rate).stream():
                if generation != state["generation"]:
                    return
                if chunk.get("type") != "audio":
                    continue
                buf += chunk["data"]
                whole.append(chunk["data"])
                if len(buf) >= AUDIO_CHUNK_BYTES:
                    if first:
                        log(f"voz: primeiro pedaco em {int((time.monotonic() - started) * 1000)} ms")
                        first = False
                    send({"event": "audio", "id": sid, "data": base64.b64encode(buf).decode("ascii"), "last": False})
                    buf = b""
            if generation == state["generation"]:
                send({"event": "audio", "id": sid, "data": base64.b64encode(buf).decode("ascii"), "last": True})
            if len(text) <= 60 and len(tts_cache) < 64:
                tts_cache[text] = b"".join(whole)

        try:
            asyncio.run(synth())
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
                # Enquanto o Jarvis fala ("barge"), so conta como fala do usuario
                # voz mais forte e mais longa, para o eco nao interromper.
                barge = bool(cmd.get("barge"))
                # Se o usuario ja esta falando ("Hey Jarvis, abre..."), continua a mesma fala.
                if barge or not segmenter.active:
                    segmenter = Segmenter(threshold=0.7 if barge else 0.5, start_frames=3 if barge else 2, end_ms=end_ms)
                    vad.reset_states()
            elif name == "sleep":
                state["listen"] = False
                segmenter = Segmenter(end_ms=end_ms)
            elif name == "speak":
                tts_pool.submit(speak, int(cmd["id"]), str(cmd["text"]), state["generation"])
            elif name == "cancel":
                state["generation"] += 1
            elif name == "prefetch":
                prefetch_pool.submit(prefetch, [str(t) for t in cmd.get("texts", [])][:20])
            elif name == "vocab":
                words = [str(w) for w in cmd.get("words", [])][:150]
                state["prompt"] = " ".join(words)
                state["vocab"] = vocab_tokens(words)
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
            if state["listen"] or name_wake:
                started, segment = segmenter.feed(frame, float(vad.predict(samples, frame_size=640)))
                if not state["listen"]:
                    # Esperando ser chamado: transcreve falas curtas (sem legenda ao vivo).
                    if segment is not None and len(segment) <= HEARD_MAX_BYTES and not stt_busy.is_set():
                        stt_busy.set()
                        stt_pool.submit(transcribe_heard, segment)
                    continue
                if started:
                    state["since_partial"] = 0
                    send({"event": "speech-start"})
                if segment is not None:
                    state["transcript"] += 1
                    stt_pool.submit(transcribe, segment, state["transcript"])
                elif segmenter.active:
                    state["since_partial"] += 1
                    # Legenda ao vivo: so transcreve de novo quando a anterior terminou.
                    if state["since_partial"] >= PARTIAL_EVERY_FRAMES and not stt_busy.is_set():
                        state["since_partial"] = 0
                        stt_busy.set()
                        stt_pool.submit(transcribe_partial, segmenter.current())


if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        log(traceback.format_exc())
        send({"event": "error", "message": f"worker de voz parou: {err}", "fatal": True})
        sys.exit(1)
