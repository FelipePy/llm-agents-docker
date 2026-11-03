"""Reconhecimento de quem fala (verificacao de voz na ativacao).

A voz vira um vetor ("embedding") de 256 numeros pelo modelo WeSpeaker
ResNet34 (ONNX, ~26 MB, baixado na primeira vez). Duas falas da mesma pessoa
dao vetores parecidos: a semelhanca de cosseno entre eles fica alta. Quem
compara com o perfil salvo e o servidor; aqui so se calcula o vetor.
"""
import os
import urllib.request
from typing import List, Optional

import numpy as np

MODEL_URL = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/"
    "speaker-recongition-models/wespeaker_en_voxceleb_resnet34.onnx"
)
MODEL_FILE = "wespeaker_en_voxceleb_resnet34.onnx"
SAMPLE_RATE = 16000
MIN_SAMPLES = SAMPLE_RATE // 2  # menos de 0,5 s de fala nao identifica ninguem

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


class Clips:
    """Audio guardado para conferir a voz de quem chamou: os ultimos segundos
    (palavra de ativacao) e as falas ouvidas. O servidor pede a verificacao
    pelo numero do trecho, so quando a fala era uma ativacao."""

    def __init__(self, recent_bytes: int = int(2.5 * SAMPLE_RATE) * 2, keep: int = 4):
        self.recent_bytes = recent_bytes
        self.keep = keep
        self._recent = bytearray()
        self._clips: dict = {}
        self._next = 0

    def feed(self, pcm: bytes) -> None:
        self._recent += pcm
        if len(self._recent) > self.recent_bytes:
            del self._recent[: len(self._recent) - self.recent_bytes]

    def save(self, pcm: Optional[bytes] = None) -> int:
        """Guarda o trecho (sem argumento: os ultimos segundos) e devolve o numero dele."""
        self._next += 1
        self._clips[self._next] = bytes(self._recent) if pcm is None else bytes(pcm)
        for old in [k for k in self._clips if k <= self._next - self.keep]:
            del self._clips[old]
        return self._next

    def get(self, clip: int) -> Optional[bytes]:
        return self._clips.get(clip)
