import unittest

from jarvis_voice.hallucination import looks_like_vocabulary, vocab_tokens

VOCAB = vocab_tokens(["Jarvis", "Claude", "Codex", "Nowcasting-Geoserver", "meu-app", "agendarse"])


class HallucinationTest(unittest.TestCase):
    def test_vocabulary_echo_is_detected(self):
        self.assertTrue(looks_like_vocabulary("Jarvis, Claude, Codex, Nowcasting-Geoserver, meu-app.", VOCAB))
        self.assertTrue(looks_like_vocabulary("Claude Codex agendarse", VOCAB))

    def test_real_requests_pass(self):
        self.assertFalse(looks_like_vocabulary("Jarvis, abre o projeto Nowcasting Geoserver", VOCAB))
        self.assertFalse(looks_like_vocabulary("Jarvis", VOCAB))
        self.assertFalse(looks_like_vocabulary("qual o estado do meu app hoje?", VOCAB))
        self.assertFalse(looks_like_vocabulary("Claude Codex agendarse", set()))


if __name__ == "__main__":
    unittest.main()
