"""Mensagens enquadradas entre o servidor e o worker de voz.

Cada mensagem: 1 byte de tipo (b"A" audio PCM, b"J" JSON) + 4 bytes de
tamanho (big-endian) + conteudo.
"""
import json
import struct
from typing import BinaryIO, Optional, Tuple

AUDIO = b"A"
JSON = b"J"
_HEADER = struct.Struct(">cI")
MAX_SIZE = 16 * 1024 * 1024


def encode(kind: bytes, payload: bytes) -> bytes:
    return _HEADER.pack(kind, len(payload)) + payload


def encode_json(obj) -> bytes:
    return encode(JSON, json.dumps(obj, ensure_ascii=False).encode("utf-8"))


def _read_exact(stream: BinaryIO, n: int) -> Optional[bytes]:
    buf = b""
    while len(buf) < n:
        chunk = stream.read(n - len(buf))
        if not chunk:
            return None
        buf += chunk
    return buf


def read_message(stream: BinaryIO) -> Optional[Tuple[bytes, bytes]]:
    """Proxima mensagem, ou None no fim do fluxo (inclusive mensagem cortada)."""
    header = _read_exact(stream, _HEADER.size)
    if header is None:
        return None
    kind, size = _HEADER.unpack(header)
    if kind not in (AUDIO, JSON) or size > MAX_SIZE:
        raise ValueError(f"mensagem invalida: tipo={kind!r} tamanho={size}")
    payload = _read_exact(stream, size)
    if payload is None:
        return None
    return kind, payload
