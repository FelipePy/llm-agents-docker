"""Reconhecimento de quem fala (verificacao de voz na ativacao).

A voz vira um vetor ("embedding") de 256 numeros pelo modelo WeSpeaker
ResNet34 (ONNX, ~26 MB, baixado na primeira vez). Duas falas da mesma pessoa
dao vetores parecidos: a semelhanca de cosseno entre eles fica alta. Quem
compara com o perfil salvo e o servidor; aqui so se calcula o vetor.
"""
import os
import urllib.request
from collections import deque
from typing import List, Optional, Sequence, Tuple

import numpy as np

MODEL_URL = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/"
    "speaker-recongition-models/wespeaker_en_voxceleb_resnet34.onnx"
)
MODEL_FILE = "wespeaker_en_voxceleb_resnet34.onnx"
SAMPLE_RATE = 16000
MIN_SAMPLES = SAMPLE_RATE // 2  # menos de 0,5 s de fala nao identifica ninguem
# Corte do silencio antes de comparar: quadros com fala (score do VAD) e uma
# folga em volta (o VAD atrasa um pouco no comeco e no fim da palavra).
VOICED_THRESHOLD = 0.5
VOICED_PAD = 2  # quadros de 80 ms
RECENT_FRAMES = 32  # ~2,5 s guardados para a palavra de ativacao

_FRAME = 400  # 25 ms
_SHIFT = 160  # 10 ms
_NFFT = 512
_MELS = 80


def _mel(f):
    return 1127.0 * np.log(1.0 + np.asarray(f) / 700.0)


def _mel_banks() -> np.ndarray:
    """Filtros triangulares na escala mel, como o fbank do Kaldi (20 Hz ate Nyquist)."""
    low, high = _mel(20.0), _mel(SAMPLE_RATE / 2)
    centers = np.linspace(low, high, _MELS + 2)
    freqs = _mel(np.arange(_NFFT // 2) * SAMPLE_RATE / _NFFT)
    banks = np.zeros((_MELS, _NFFT // 2 + 1), dtype=np.float32)
    for m in range(_MELS):
        left, center, right = centers[m], centers[m + 1], centers[m + 2]
        up = (freqs - left) / (center - left)
        down = (right - freqs) / (right - center)
        banks[m, : _NFFT // 2] = np.maximum(0.0, np.minimum(up, down))
    return banks


_BANKS = _mel_banks()
_WINDOW = (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(_FRAME) / (_FRAME - 1))) ** 0.85  # janela "povey"


def fbank(samples: np.ndarray) -> np.ndarray:
    """Log-mel (80 bandas, 25/10 ms) no estilo do Kaldi, com a media de cada banda removida."""
    x = np.asarray(samples, dtype=np.float32)
    n = 1 + (len(x) - _FRAME) // _SHIFT
    if n <= 0:
        return np.zeros((0, _MELS), dtype=np.float32)
    idx = np.arange(_FRAME)[None, :] + _SHIFT * np.arange(n)[:, None]
    frames = x[idx]
    frames = frames - frames.mean(axis=1, keepdims=True)
    frames = np.concatenate([frames[:, :1] - 0.97 * frames[:, :1], frames[:, 1:] - 0.97 * frames[:, :-1]], axis=1)
    frames = frames * _WINDOW
    power = np.abs(np.fft.rfft(frames, n=_NFFT)) ** 2
    feats = np.log(np.maximum(power @ _BANKS.T, np.finfo(np.float32).eps))
    return (feats - feats.mean(axis=0, keepdims=True)).astype(np.float32)


def pcm_samples(pcm: bytes) -> np.ndarray:
    """PCM 16 bits na escala do modelo (inteiros, sem normalizar)."""
    return np.frombuffer(pcm, dtype=np.int16).astype(np.float32)


class SpeakerModel:
    """O modelo ONNX, carregado so quando for preciso (cadastro ou ativacao com perfil)."""

    def __init__(self, model_dir: str, log=lambda _m: None):
        self.path = os.path.join(model_dir, MODEL_FILE)
        self.log = log
        self._session = None

    def downloaded(self) -> bool:
        """O modelo ja foi baixado (alguem cadastrou ou tentou cadastrar a voz)."""
        return os.path.exists(self.path)

    def ready(self) -> bool:
        return self._session is not None

    def warm(self) -> None:
        """Carrega o modelo ja baixado, para a primeira ativacao nao esperar por isso."""
        if self.downloaded():
            self._load()

    def _load(self):
        if self._session is None:
            if not os.path.exists(self.path):
                os.makedirs(os.path.dirname(self.path), exist_ok=True)
                self.log("voz do usuario: baixando o modelo de reconhecimento (~26 MB)")
                tmp = self.path + ".part"
                urllib.request.urlretrieve(MODEL_URL, tmp)
                os.replace(tmp, self.path)
            import onnxruntime as ort

            options = ort.SessionOptions()
            options.intra_op_num_threads = 2
            self._session = ort.InferenceSession(self.path, options, providers=["CPUExecutionProvider"])
        return self._session

    def embed(self, pcm: bytes) -> Optional[List[float]]:
        """Vetor da voz no audio, ou None se o audio for curto demais."""
        samples = pcm_samples(pcm)
        if len(samples) < MIN_SAMPLES:
            return None
        feats = fbank(samples)
        out = self._load().run(None, {"feats": feats[None, :, :]})[0][0]
        return [float(v) for v in out]


Frame = Tuple[bytes, float]  # (PCM de um quadro, score do VAD)


def voiced(frames: Sequence[Frame], threshold: float = VOICED_THRESHOLD, pad: int = VOICED_PAD,
           min_bytes: int = MIN_SAMPLES * 2) -> bytes:
    """So a parte com fala (mais a folga), para o silencio e o ruido nao pesarem no vetor.

    Sem nenhum quadro com fala, devolve tudo (melhor tentar do que recusar).
    Se a fala ficar curta demais para o modelo, alarga em volta dela ate o minimo.
    """
    n = len(frames)
    loud = [i for i, (_, score) in enumerate(frames) if score >= threshold]
    if not loud:
        return b"".join(pcm for pcm, _ in frames)
    keep = sorted({j for i in loud for j in range(max(0, i - pad), min(n, i + pad + 1))})
    if sum(len(frames[i][0]) for i in keep) >= min_bytes:
        return b"".join(frames[i][0] for i in keep)
    lo, hi = keep[0], keep[-1] + 1
    while sum(len(pcm) for pcm, _ in frames[lo:hi]) < min_bytes and (lo > 0 or hi < n):
        if hi < n:
            hi += 1
        if lo > 0 and sum(len(pcm) for pcm, _ in frames[lo:hi]) < min_bytes:
            lo -= 1
    return b"".join(pcm for pcm, _ in frames[lo:hi])


class Clips:
    """Audio guardado para conferir a voz de quem chamou: os ultimos segundos
    (palavra de ativacao) e as falas ouvidas, ja sem o silencio. O servidor pede a
    verificacao pelo numero do trecho, so quando a fala era uma ativacao. O vetor
    pode ser calculado antes (junto da transcricao) e fica guardado com o trecho."""

    def __init__(self, recent_frames: int = RECENT_FRAMES, keep: int = 4):
        self.keep = keep
        self._recent: deque = deque(maxlen=recent_frames)
        self._clips: dict = {}
        self._vectors: dict = {}
        self._next = 0

    def feed(self, pcm: bytes, score: float) -> None:
        self._recent.append((pcm, score))

    def save(self, frames: Optional[Sequence[Frame]] = None) -> int:
        """Guarda o trecho (sem argumento: os ultimos segundos) e devolve o numero dele."""
        self._next += 1
        self._clips[self._next] = voiced(list(self._recent) if frames is None else frames)
        for old in [k for k in self._clips if k <= self._next - self.keep]:
            del self._clips[old]
            self._vectors.pop(old, None)
        return self._next

    def get(self, clip: int) -> Optional[bytes]:
        return self._clips.get(clip)

    def set_vector(self, clip: int, vector) -> None:
        if clip in self._clips:
            self._vectors[clip] = vector

    def vector(self, clip: int):
        """(ja calculado?, vetor)."""
        return (clip in self._vectors, self._vectors.get(clip))
