#!/usr/bin/env python3
import os
import sys
import unittest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(__file__))
import fetch_current


class FakeResponse:
    def __init__(self, text):
        self.text = text


class FakeSession:
    def __init__(self, html=''):
        self.html = html

    def get(self, _url, timeout=None):
        return FakeResponse(self.html)


class UnexpectedRequestSession:
    def get(self, _url, timeout=None):
        raise AssertionError('the date override must not depend on the selectable-event menu')


class SequenceSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = 0

    def get(self, _url, timeout=None):
        value = self.responses[min(self.calls, len(self.responses) - 1)]
        self.calls += 1
        return FakeResponse(value)


class CurrentEventSelectionTests(unittest.TestCase):
    def test_august_second_counts_only_canada_during_washington_overlap(self):
        now = datetime(2026, 8, 2, 12, 0, tzinfo=timezone(timedelta(hours=8)))
        with patch.object(fetch_current, '_pick_active_event') as picker:
            selected = fetch_current.get_active_events(UnexpectedRequestSession(), {}, now)
        self.assertEqual(selected, ('20421', '30806'))
        picker.assert_not_called()

    def test_override_expires_after_august_second(self):
        html = (
            'href="https://www.live-tennis.cn/zh/survivor/event/20421/2026/MS/my" '
            'href="https://www.live-tennis.cn/zh/survivor/event/30806/2026/WS/my"'
        )
        now = datetime(2026, 8, 3, 12, 0, tzinfo=timezone(timedelta(hours=8)))
        with patch.object(fetch_current, '_pick_active_event', side_effect=['20421', '30806']) as picker:
            selected = fetch_current.get_active_events(FakeSession(html), {}, now)
        self.assertEqual(selected, ('20421', '30806'))
        self.assertEqual(picker.call_count, 2)

    def test_canada_internal_id_lookup_can_retry_transient_empty_page(self):
        session = SequenceSession([
            '<html>temporary empty response</html>',
            'url: "https://www.live-tennis.cn/zh/survivor/event/98765/score"',
        ])
        with patch.object(fetch_current.time, 'sleep'):
            internal_id = fetch_current.get_internal_id(session, '30806', 'WS', attempts=3)
        self.assertEqual(internal_id, '98765')
        self.assertEqual(session.calls, 2)


if __name__ == '__main__':
    unittest.main()
