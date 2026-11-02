import io
import unittest

from jarvis_voice.protocol import AUDIO, JSON, encode, encode_json, read_message


class ProtocolTest(unittest.TestCase):
    def test_round_trip(self):
        stream = io.BytesIO(encode(AUDIO, b"\x01\x02") + encode_json({"cmd": "ação"}))
        self.assertEqual(read_message(stream), (AUDIO, b"\x01\x02"))
        kind, payload = read_message(stream)
        self.assertEqual(kind, JSON)
        self.assertEqual(payload.decode("utf-8"), '{"cmd": "ação"}')
        self.assertIsNone(read_message(stream))

    def test_truncated_message_is_end_of_stream(self):
        self.assertIsNone(read_message(io.BytesIO(encode(AUDIO, b"abcdef")[:-2])))

    def test_invalid_kind_raises(self):
        with self.assertRaises(ValueError):
            read_message(io.BytesIO(b"X\x00\x00\x00\x01a"))


if __name__ == "__main__":
    unittest.main()
