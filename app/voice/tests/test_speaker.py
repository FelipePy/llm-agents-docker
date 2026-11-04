import unittest

import numpy as np

from jarvis_voice.speaker import MIN_SAMPLES, Clips, SpeakerModel, fbank, pcm_samples, vad_frames, voiced


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


    def test_warm_without_model_does_nothing(self):
        model = SpeakerModel("/nao/existe")
        self.assertFalse(model.downloaded())
        model.warm()
        self.assertFalse(model.ready())


LOUD, QUIET = 0.9, 0.1
FRAME = 2560  # 80 ms


def frames(scores, start=0):
    """Quadros de 80 ms; o conteudo de cada um e o seu numero (para saber quais ficaram)."""
    return [(bytes([(start + i) % 256]) * FRAME, s) for i, s in enumerate(scores)]


def numbers(pcm):
    return [pcm[i] for i in range(0, len(pcm), FRAME)]


class VoicedTest(unittest.TestCase):
    def test_keeps_speech_with_padding_and_drops_silence(self):
        scores = [QUIET] * 10 + [LOUD] * 8 + [QUIET] * 14
        self.assertEqual(numbers(voiced(frames(scores))), list(range(8, 20)))

    def test_joins_separate_bits_of_speech(self):
        scores = [QUIET] * 5 + [LOUD] * 5 + [QUIET] * 10 + [LOUD] * 3 + [QUIET] * 5
        self.assertEqual(numbers(voiced(frames(scores))), list(range(3, 12)) + list(range(18, 25)))

    def test_short_speech_widens_to_the_minimum(self):
        scores = [QUIET] * 10 + [LOUD] + [QUIET] * 10
        pcm = voiced(frames(scores))
        self.assertGreaterEqual(len(pcm), MIN_SAMPLES * 2)
        self.assertIn(10, numbers(pcm))
        self.assertEqual(numbers(pcm), sorted(numbers(pcm)), "trecho continuo, em ordem")

    def test_no_speech_keeps_everything(self):
        self.assertEqual(len(voiced(frames([QUIET] * 6))), 6 * FRAME)


class VadFramesTest(unittest.TestCase):
    def test_splits_recording_into_frames_with_vad_scores(self):
        pcm = b"".join(bytes([i]) * FRAME for i in range(5)) + b"resto"
        got = vad_frames(pcm, lambda f: LOUD if f[0] in (2, 3) else QUIET)
        self.assertEqual([s for _, s in got], [QUIET, QUIET, LOUD, LOUD, QUIET])
        self.assertEqual(numbers(b"".join(p for p, _ in got)), [0, 1, 2, 3, 4])

    def test_recording_trimmed_like_the_activation(self):
        scores = [QUIET] * 12 + [LOUD] * 8 + [QUIET] * 15
        pcm = b"".join(p for p, _ in frames(scores))
        by_number = dict(enumerate(scores))
        self.assertEqual(numbers(voiced(vad_frames(pcm, lambda f: by_number[f[0]]))), list(range(10, 22)))


class ClipsTest(unittest.TestCase):
    def test_recent_keeps_the_last_frames_without_silence(self):
        clips = Clips(recent_frames=20)
        for pcm, score in frames([LOUD] * 5 + [QUIET] * 10 + [LOUD] * 8 + [QUIET] * 2):
            clips.feed(pcm, score)
        # Ficaram os quadros 5 a 24: os 5 primeiros sairam, e o silencio do meio foi cortado.
        self.assertEqual(numbers(clips.get(clips.save())), list(range(13, 25)))

    def test_save_segment_and_forget_old_clips_and_vectors(self):
        clips = Clips(keep=2)
        a = clips.save(frames([LOUD] * 7))
        clips.set_vector(a, [1.0])
        self.assertEqual(clips.vector(a), (True, [1.0]))
        b = clips.save(frames([LOUD] * 7, 1))
        c = clips.save(frames([LOUD] * 7, 2))
        self.assertIsNone(clips.get(a))
        self.assertEqual(clips.vector(a), (False, None))
        self.assertEqual((numbers(clips.get(b))[0], numbers(clips.get(c))[0]), (1, 2))
        self.assertEqual(clips.vector(b), (False, None), "vetor ainda nao calculado")

    def test_vector_of_a_forgotten_clip_is_not_kept(self):
        clips = Clips()
        clips.set_vector(99, [1.0])
        self.assertEqual(clips.vector(99), (False, None))


if __name__ == "__main__":
    unittest.main()
