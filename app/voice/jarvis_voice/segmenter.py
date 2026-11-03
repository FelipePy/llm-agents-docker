"""Segmenta a fala, em quadros de 80 ms, a partir de um score de VAD (0 a 1)."""
from typing import List, Optional, Tuple

FRAME_MS = 80
# Faixa do silencio que encerra a fala (o servidor ja limita; aqui e so por garantia).
END_MS_MIN = 300
END_MS_MAX = 5000


def end_ms_from(value, fallback: int) -> int:
    """Silencio pedido pelo servidor (comando "pauses"), limitado a faixa; invalido mantem o anterior."""
    try:
        ms = int(value)
    except (TypeError, ValueError):
        return fallback
    return min(END_MS_MAX, max(END_MS_MIN, ms))


class Segmenter:
    def __init__(self, threshold: float = 0.5, start_frames: int = 2, end_ms: int = 800,
                 min_ms: int = 300, max_ms: int = 30_000, preroll_ms: int = 300):
        self.threshold = threshold
        self.start_frames = start_frames
        self.end_ms = end_ms
        self.min_ms = min_ms
        self.max_ms = max_ms
        self.preroll_frames = preroll_ms // FRAME_MS
        self.reset()

    def reset(self) -> None:
        self._pre: List[bytes] = []
        self._speech: List[bytes] = []
        self._above = 0
        self._silence_ms = 0
        self._lead = 0
        self.active = False

    def current(self) -> Optional[bytes]:
        """Audio da fala em andamento (para a legenda parcial), ou None."""
        return b"".join(self._speech) if self.active else None

    def feed(self, frame: bytes, score: float) -> Tuple[bool, Optional[bytes]]:
        """Devolve (a fala comecou agora, segmento terminado ou None)."""
        loud = score >= self.threshold
        if not self.active:
            self._pre.append(frame)
            del self._pre[:-(self.preroll_frames + self.start_frames)]
            self._above = self._above + 1 if loud else 0
            if self._above < self.start_frames:
                return False, None
            self.active = True
            self._speech = self._pre
            self._lead = len(self._pre) - self.start_frames
            self._pre = []
            self._silence_ms = 0
            return True, None

        self._speech.append(frame)
        self._silence_ms = 0 if loud else self._silence_ms + FRAME_MS
        duration_ms = len(self._speech) * FRAME_MS
        if self._silence_ms < self.end_ms and duration_ms < self.max_ms:
            return False, None
        speech_ms = (len(self._speech) - self._lead) * FRAME_MS - self._silence_ms
        segment = b"".join(self._speech)
        self.reset()
        return False, segment if speech_ms >= self.min_ms else None
