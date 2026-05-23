#!/usr/bin/env python3
import os
import sys
import types
import unittest

sys.path.insert(0, os.path.dirname(__file__))
sys.modules.setdefault('requests', types.SimpleNamespace(Session=object))

from fetch_current import calc_preview_v5_instant


def details(events):
    return ''.join(f'<b>【{name}({score})】</b>' for name, score in events)


class InstantScoreTests(unittest.TestCase):
    def assert_current_atp_grand_slam_zero_keeps_forced_slot(self, event_name):
        other_slams = [name for name in ['澳网', '法网', '温网', '美网'] if name != event_name]
        det = details([
            (event_name, 800),
            (other_slams[0], 100),
            (other_slams[1], 100),
            (other_slams[2], 100),
            ('印第安维尔斯', 10),
            ('迈阿密', 10),
            ('马德里', 10),
            ('罗马', 10),
            ('上海', 10),
            ('休斯顿', 5),
            ('慕尼黑', 5),
            ('汉堡', 5),
            ('哈雷', 5),
            ('东京', 5),
            ('维也纳', 5),
            ('巴塞尔', 5),
            ('香港', 5),
            ('阿德莱德', 5),
            ('多哈', 5),
        ])
        score = calc_preview_v5_instant('u1', 0, 800, 0, det, 'MS', event_name)
        self.assertEqual(score, 395)

    def test_current_atp_grand_slam_zero_keeps_forced_slot(self):
        for event_name in ['澳网', '法网', '温网', '美网']:
            with self.subTest(event_name=event_name):
                self.assert_current_atp_grand_slam_zero_keeps_forced_slot(event_name)

    def assert_current_wta_grand_slam_zero_keeps_forced_slot(self, event_name):
        other_slams = [name for name in ['澳网', '法网', '温网', '美网'] if name != event_name]
        det = details([
            (event_name, 800),
            (other_slams[0], 100),
            (other_slams[1], 100),
            (other_slams[2], 100),
            ('多哈', 10),
            ('印第安维尔斯', 10),
            ('迈阿密', 10),
            ('马德里', 10),
            ('罗马', 10),
            ('北京', 10),
            ('辛辛那提', 10),
            ('查尔斯顿', 5),
            ('林茨', 5),
            ('斯图加特', 5),
            ('香港', 5),
            ('阿德莱德', 5),
            ('霍巴特', 5),
            ('梅里达', 5),
            ('东京', 5),
            ('大阪', 5),
        ])
        score = calc_preview_v5_instant('u1', 0, 800, 0, det, 'WS', event_name)
        self.assertEqual(score, 405)

    def test_current_wta_grand_slam_zero_keeps_forced_slot(self):
        for event_name in ['澳网', '法网', '温网', '美网']:
            with self.subTest(event_name=event_name):
                self.assert_current_wta_grand_slam_zero_keeps_forced_slot(event_name)


if __name__ == '__main__':
    unittest.main()
