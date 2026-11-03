import unittest

import numpy as np

from jarvis_voice.speaker import MIN_SAMPLES, Clips, SpeakerModel, fbank, pcm_samples


class FbankTest(unittest.TestCase):
    def test_shape_is_frames_by_80(self):
        samples = np.random.default_rng(1).normal(0, 1000, 16000).astype(np.float32)
        feats = fbank(samples)
        self.assertEqual(feats.shape, (98, 80))
        # media de cada banda removida
        self.assertTrue(np.allclose(feats.mean(axis=0), 0, atol=1e-3))

    def test_too_short_gives_no_frames(self):
        self.assertEqual(fbank(np.zeros(100, dtype=np.float32)).shape, (0, 80))

    def test_pcm_keeps_integer_scale(self):
        pcm = np.array([1000, -2000], dtype=np.int16).tobytes()
        self.assertEqual(list(pcm_samples(pcm)), [1000.0, -2000.0])


class SpeakerModelTest(unittest.TestCase):
    def test_short_audio_has_no_embedding_and_does_not_load(self):
        model = SpeakerModel("/nao/existe")
        self.assertIsNone(model.embed(b"\0\0" * (MIN_SAMPLES - 1)))
        self.assertIsNone(model._session)

    def test_embed_runs_the_model_on_fbank(self):
        class Fake:
            def run(self, _out, inputs):
                self.shape = inputs["feats"].shape
                return [np.array([[0.5, -0.5]], dtype=np.float32)]

        model = SpeakerModel("/nao/existe")
        model._session = fake = Fake()
        self.assertEqual(model.embed(b"\1\0" * 16000), [0.5, -0.5])
        self.assertEqual(fake.shape, (1, 98, 80))


class ClipsTest(unittest.TestCase):
    def test_recent_keeps_only_the_last_bytes(self):
        clips = Clips(recent_bytes=4)
        clips.feed(b"abc")
        clips.feed(b"def")
        self.assertEqual(clips.get(clips.save()), b"cdef")

    def test_save_segment_and_forget_old_clips(self):
        clips = Clips(keep=2)
        a = clips.save(b"1")
        b = clips.save(b"2")
        c = clips.save(b"3")
        self.assertIsNone(clips.get(a))
        self.assertEqual((clips.get(b), clips.get(c)), (b"2", b"3"))


if __name__ == "__main__":
    unittest.main()
