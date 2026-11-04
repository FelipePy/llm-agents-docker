import unittest

from jarvis_voice.heard import HeardQueue


class HeardQueueTest(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.jobs = []
        self.clips = 0
        self.q = HeardQueue(self.events.append, self.jobs.append, max_bytes=100)

    def clip(self):
        self.clips += 1
        return self.clips

    def test_numbers_each_speech_and_transcribes_it(self):
        self.q.start()
        self.q.end(b"jarvis", self.clip)
        self.assertEqual(self.events, [{"event": "heard-start", "id": 1}])
        self.assertEqual(self.jobs, [(b"jarvis", 1, 1)])

    def test_speech_while_busy_waits_in_the_queue_instead_of_being_lost(self):
        # "Jarvis" ... pausa ... "abre o meu-app": a segunda parte termina com o whisper ocupado.
        self.q.start()
        self.q.end(b"jarvis", self.clip)
        self.q.start()
        self.q.end(b"abre o app", self.clip)
        self.assertEqual(len(self.jobs), 1, "uma transcricao por vez")
        self.q.done(1, sent=True)
        self.assertEqual(self.jobs[1], (b"abre o app", 2, 2))
        self.assertNotIn("heard-drop", [e["event"] for e in self.events])
        self.q.done(2, sent=True)
        self.q.start()
        self.q.end(b"mais", self.clip)
        self.assertEqual(self.jobs[2][2], 3, "livre de novo: transcreve na hora")

    def test_only_the_last_speech_waits(self):
        self.q.start()
        self.q.end(b"a", self.clip)
        for _ in range(2):
            self.q.start()
            self.q.end(b"b", self.clip)
        self.assertIn({"event": "heard-drop", "id": 2}, self.events)
        self.q.done(1, sent=True)
        self.assertEqual(self.jobs[-1][2], 3)

    def test_noise_too_long_empty_or_abandoned_speech_is_dropped(self):
        self.q.start()
        self.q.end(None, self.clip)
        self.q.start()
        self.q.end(b"x" * 101, self.clip)
        self.q.start()
        self.q.abandon()
        self.q.abandon()
        self.q.start()
        self.q.end(b"hmm", self.clip)
        self.q.done(4, sent=False)
        drops = [e["id"] for e in self.events if e["event"] == "heard-drop"]
        self.assertEqual(drops, [1, 2, 3, 4])
        self.assertEqual(self.clips, 1, "so guarda o audio do que vai ser transcrito")

    def test_end_without_start_does_nothing(self):
        self.q.end(b"x", self.clip)
        self.assertEqual((self.events, self.jobs), ([], []))


if __name__ == "__main__":
    unittest.main()
