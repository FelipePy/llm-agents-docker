"""Falas ouvidas enquanto o Jarvis espera ser chamado ("Jarvis, ...").

Cada fala e numerada: "heard-start" quando comeca e, no fim, "heard" (transcrita, pelo
worker) ou "heard-drop" (ruido, longa demais, transcricao vazia ou virou fala da
conversa). Assim o servidor sabe se o usuario continuou falando depois do nome.

Uma transcricao por vez; com o whisper ocupado, a ultima fala espera na fila em vez de
ser descartada ("Jarvis" ... pausa ... "abre o meu-app": a segunda parte termina
enquanto a primeira ainda esta sendo transcrita).
"""
import threading
from typing import Callable, Optional, Tuple

Job = Tuple[bytes, int, int]  # (audio, numero do trecho guardado, numero da fala)


class HeardQueue:
    def __init__(self, send: Callable[[dict], None], submit: Callable[[Job], None], max_bytes: int):
        self.send = send
        self.submit = submit
        self.max_bytes = max_bytes
        self.current: Optional[int] = None
        self._seq = 0
        self._lock = threading.Lock()
        self._busy = False
        self._queued: Optional[Job] = None

    def start(self) -> None:
        """Comecou uma fala (thread principal)."""
        self._seq += 1
        self.current = self._seq
        self.send({"event": "heard-start", "id": self._seq})

    def end(self, segment: Optional[bytes], save_clip: Callable[[], int]) -> None:
        """A fala terminou: com audio, vai para a transcricao (ou fila); sem, e descartada."""
        hid, self.current = self.current, None
        if hid is None:
            return
        if segment is None or len(segment) > self.max_bytes:
            self.send({"event": "heard-drop", "id": hid})
            return
        job = (segment, save_clip(), hid)
        with self._lock:
            if self._busy:
                if self._queued is not None:
                    self.send({"event": "heard-drop", "id": self._queued[2]})
                self._queued = job
                return
            self._busy = True
        self.submit(job)

    def abandon(self) -> None:
        """O modo mudou no meio da fala (ela continua como fala da conversa, ou acabou)."""
        if self.current is not None:
            self.send({"event": "heard-drop", "id": self.current})
            self.current = None

    def done(self, hid: int, sent: bool) -> None:
        """Fim de uma transcricao (thread do whisper): `sent` diz se virou "heard"."""
        if not sent:
            self.send({"event": "heard-drop", "id": hid})
        with self._lock:
            queued, self._queued = self._queued, None
            if queued is None:
                self._busy = False
        if queued is not None:
            self.submit(queued)
