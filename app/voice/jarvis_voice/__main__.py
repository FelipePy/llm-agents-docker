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
from .segmenter import Segmenter, end_ms_from
from .groq import GroqError, GroqStt
from .speaker import Clips, SpeakerModel

FRAME_SAMPLES = 1280  # 80 ms a 16 kHz
FRAME_BYTES = FRAME_SAMPLES * 2
WAKE_DEBOUNCE_S = 2.0
AUDIO_CHUNK_BYTES = 2048  # envia a voz em pedacos (~0,3 s), enquanto o edge-tts gera
GROQ_WARN_EVERY_S = 60  # avisa a falha do Groq no maximo uma vez por minuto
HEARD_MAX_BYTES = 8 * 32000  # esperando ser chamado, so transcreve falas de ate 8 s
MAX_EMBED_CLIPS = 8
# Modelo de reconhecimento da voz do usuario (baixado na primeira vez que for preciso).
SPEAKER_DIR = os.environ.get("LLM_AGENT_VOICE_SPEAKER_DIR") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".venv", "models"
)
# Janela do whisper (o CTranslate2 completa ate 30 s de todo jeito: janelas menores nao aceleram).
WINDOW_S = int(os.environ.get("LLM_AGENT_VOICE_WINDOW_S", "30"))

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
    # Mais threads pioram (disputam a CPU com o detector de fala e a palavra de ativacao).
    threads = int(os.environ.get("LLM_AGENT_VOICE_STT_THREADS", "4"))
    log(f"whisper: modelo {name} na CPU (int8, {threads} threads)")
    return WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=threads)


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
    state = {"listen": False, "generation": 0, "transcript": 0, "last_wake": 0.0, "prompt": "", "vocab": set()}
    # Transcricao no Groq (configurada pela tela); None = whisper local.
    cloud = {"stt": None, "warned": 0.0}
    # Chamado pelo nome ("Jarvis, ..."): esperando, transcreve falas curtas e o servidor procura o nome.
    name_wake = os.environ.get("LLM_AGENT_VOICE_NAME_WAKE", "1") != "0"
    # Fim da fala depois de 1 s de silencio (o servidor manda o das configuracoes no comando
    # "pauses"); se a fala parecer incompleta, o servidor espera mais um pouco, e se o
    # usuario continuar, emenda as falas.
    end_ms = int(os.environ.get("LLM_AGENT_VOICE_END_MS", "1000"))
    segmenter = Segmenter(end_ms=end_ms)
    stt_busy = threading.Event()
    # Verificacao da voz: o audio de cada ativacao fica guardado; o servidor pede o vetor dele.
    clips = Clips()
    speaker = SpeakerModel(SPEAKER_DIR, log)
    speaker_pool = ThreadPoolExecutor(max_workers=1)

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
            chunk_length=WINDOW_S,
        )
        return filter_vocab(" ".join(p.text.strip() for p in parts).strip())

    def filter_vocab(text: str) -> str:
        if looks_like_vocabulary(text, state["vocab"]):
            log(f"transcricao descartada (eco do vocabulario): {text!r}")
            return ""
        return text

    def run_cloud(segment: bytes):
        """Groq, se configurado; None se nao estiver ou se falhar (ai vale o whisper local)."""
        stt = cloud["stt"]
        if stt is None:
            return None
        try:
            return filter_vocab(stt.transcribe(segment, state["prompt"]))
        except GroqError as err:
            log(f"groq: {err}; usando o whisper local")
            now = time.monotonic()
            if now - cloud["warned"] >= GROQ_WARN_EVERY_S:
                cloud["warned"] = now
                send({"event": "error", "message": f"Transcrição no Groq falhou ({err}); usei o whisper local."})
            return None

    def transcribe(segment: bytes, tid: int) -> None:
        try:
            started = time.monotonic()
            # So a fala depois de chamar o Jarvis vai para a nuvem; a espera pelo nome fica local.
            text = run_cloud(segment)
            via = "groq"
            if text is None:
                text, via = run_whisper(segment), "local"
            ms = int((time.monotonic() - started) * 1000)
            log(f"transcricao final ({via}): {ms} ms para {len(segment) / 32000:.1f} s de fala")
            send({"event": "transcript", "id": tid, "text": text, "ms": ms})
        except Exception as err:
            log(traceback.format_exc())
            send({"event": "error", "message": f"falha na transcrição: {err}"})

    def transcribe_heard(segment: bytes, clip: int) -> None:
        try:
            started = time.monotonic()
            text = run_whisper(segment)
            if text:
                send({"event": "heard", "text": text, "ms": int((time.monotonic() - started) * 1000), "clip": clip})
        except Exception:
            log(traceback.format_exc())
        finally:
            stt_busy.clear()

    def embed(eid: int, audio: list, clip) -> None:
        """Vetores da voz: de trechos enviados (cadastro) ou de um trecho guardado (ativacao)."""
        try:
            started = time.monotonic()
            if clip is not None:
                pcm = clips.get(int(clip))
                audio = [] if pcm is None else [pcm]
            vectors = [speaker.embed(pcm) for pcm in audio]
            log(f"voz do usuario: {len(vectors)} vetor(es) em {int((time.monotonic() - started) * 1000)} ms")
            send({"event": "embedding", "id": eid, "vectors": vectors})
        except Exception as err:
            log(traceback.format_exc())
            send({"event": "embedding", "id": eid, "error": str(err)})

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
            elif name == "stt":
                key = str(cmd.get("key") or "")
                if cmd.get("provider") == "groq" and key:
                    cloud["stt"] = GroqStt(key, str(cmd.get("model") or "whisper-large-v3-turbo"))
                    log(f"transcricao: Groq ({cloud['stt'].model})")
                else:
                    cloud["stt"] = None
                    log("transcricao: whisper local")
            elif name == "pauses":
                end_ms = end_ms_from(cmd.get("end_ms"), end_ms)
                segmenter.end_ms = end_ms
                log(f"fim da fala: {end_ms} ms de silencio")
            elif name == "embed":
                audio = [base64.b64decode(str(a)) for a in cmd.get("audio", [])][:MAX_EMBED_CLIPS]
                speaker_pool.submit(embed, int(cmd["id"]), audio, cmd.get("clip"))
            elif name == "vocab":
                words = [str(w) for w in cmd.get("words", [])][:150]
                state["prompt"] = " ".join(words)
                state["vocab"] = vocab_tokens(words)
            continue

        pending += payload
        while len(pending) >= FRAME_BYTES:
            frame, pending = pending[:FRAME_BYTES], pending[FRAME_BYTES:]
            samples = np.frombuffer(frame, dtype=np.int16)
            clips.feed(frame)
            score = max(wake.predict(samples).values())
            now = time.monotonic()
            if score >= threshold and now - state["last_wake"] >= WAKE_DEBOUNCE_S:
                state["last_wake"] = now
                wake.reset()
                send({"event": "wake", "score": round(float(score), 3), "clip": clips.save()})
                continue
            if state["listen"] or name_wake:
                was_active = segmenter.active
                started, segment = segmenter.feed(frame, float(vad.predict(samples, frame_size=640)))
                if not state["listen"]:
                    # Esperando ser chamado: transcreve falas curtas (sem legenda ao vivo).
                    if segment is not None and len(segment) <= HEARD_MAX_BYTES and not stt_busy.is_set():
                        stt_busy.set()
                        stt_pool.submit(transcribe_heard, segment, clips.save(segment))
                    continue
                if started:
                    send({"event": "speech-start"})
                if segment is not None:
                    state["transcript"] += 1
                    stt_pool.submit(transcribe, segment, state["transcript"])
                elif was_active and not segmenter.active:
                    # A fala detectada era curta demais (ruido): nada para transcrever.
                    send({"event": "speech-drop"})


if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        log(traceback.format_exc())
        send({"event": "error", "message": f"worker de voz parou: {err}", "fatal": True})
        sys.exit(1)
