import unittest

from jarvis_voice.segmenter import Segmenter

LOUD, QUIET = 0.9, 0.1


def frame(i):
    return bytes([i % 256]) * 4


class SegmenterTest(unittest.TestCase):
    def feed(self, seg, scores, start=0):
        events = []
        for n, score in enumerate(scores, start):
            started, segment = seg.feed(frame(n), score)
            events.append((started, segment))
        return events

    def test_silence_never_starts(self):
        seg = Segmenter()
        self.assertTrue(all(e == (False, None) for e in self.feed(seg, [QUIET] * 50)))
        self.assertFalse(seg.active)

    def test_one_loud_frame_is_not_enough(self):
        seg = Segmenter()
        self.feed(seg, [QUIET, LOUD, QUIET, LOUD, QUIET])
        self.assertFalse(seg.active)

    def test_segment_with_preroll_ends_after_silence(self):
        seg = Segmenter()
        scores = [QUIET] * 4 + [LOUD] * 2 + [LOUD] * 5 + [QUIET] * 10
        events = self.feed(seg, scores)
        self.assertEqual(events[5], (True, None))
        segment = events[-1][1]
        self.assertIsNotNone(segment)
        # 3 quadros de pre-rolagem (1, 2, 3), 2 de inicio, 5 de fala, 10 de silencio.
        expected = b"".join(frame(i) for i in range(1, 21))
        self.assertEqual(segment, expected)
        self.assertFalse(seg.active)
        self.assertTrue(all(e[1] is None for e in events[:-1]))

    def test_one_second_pause_ends_the_speech(self):
        # Fim da fala do Jarvis: 1 s de silencio; pausas menores nao cortam a frase.
        seg = Segmenter(end_ms=1000)
        events = self.feed(seg, [LOUD] * 8 + [QUIET] * 12 + [LOUD] * 4 + [QUIET] * 12)
        self.assertTrue(all(segment is None for _, segment in events))
        self.assertTrue(seg.active)
        _, segment = seg.feed(frame(99), QUIET)
        self.assertIsNotNone(segment)

    def test_short_blip_is_dropped(self):
        seg = Segmenter()
        events = self.feed(seg, [QUIET] * 4 + [LOUD] * 2 + [QUIET] * 10)
        self.assertTrue(all(e[1] is None for e in events))
        self.assertFalse(seg.active)

    def test_long_speech_is_cut_at_max(self):
        seg = Segmenter(max_ms=800, preroll_ms=0)
        events = self.feed(seg, [LOUD] * 12)
        cut = [n for n, e in enumerate(events) if e[1] is not None]
        self.assertEqual(cut, [9])
        self.assertEqual(len(events[9][1]), 10 * 4)

    def test_current_audio_while_speaking(self):
        seg = Segmenter(preroll_ms=0)
        self.assertIsNone(seg.current())
        self.feed(seg, [LOUD] * 4)
        self.assertEqual(seg.current(), b"".join(frame(i) for i in range(4)))

    def test_reset(self):
        seg = Segmenter()
        self.feed(seg, [LOUD] * 3)
        self.assertTrue(seg.active)
        seg.reset()
        self.assertFalse(seg.active)


if __name__ == "__main__":
    unittest.main()
