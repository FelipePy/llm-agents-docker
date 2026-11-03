"""Filtro de "alucinacao" do whisper: em ruido, ele as vezes devolve o proprio
vocabulario de dicas (a lista de nomes) como se fosse fala."""
import re
import unicodedata
from typing import Iterable, Set


def _tokens(text: str):
    text = unicodedata.normalize("NFD", text)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn").lower()
    return [t for t in re.split(r"[^a-z0-9]+", text) if t]


def vocab_tokens(words: Iterable[str]) -> Set[str]:
    out: Set[str] = set()
    for w in words:
        out.update(_tokens(w))
    return out


def looks_like_vocabulary(text: str, vocab: Set[str]) -> bool:
    """Verdadeiro se a "fala" e basicamente a lista de dicas (3+ palavras, 60%+ delas do vocabulario)."""
    tokens = _tokens(text)
    if len(tokens) < 3 or not vocab:
        return False
    return sum(1 for t in tokens if t in vocab) / len(tokens) >= 0.6
