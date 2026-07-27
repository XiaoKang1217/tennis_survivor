#!/usr/bin/env python3
import os
import sys
import types
import unittest

sys.path.insert(0, os.path.dirname(__file__))
sys.modules.setdefault('requests', types.SimpleNamespace(Session=object))

from fetch_current import calc_current_deduct_score, calc_preview_v5_instant
import fetch_breakdown as scoring


def details(events):
    return ''.join(f'<b>【{name}({score})】</b>' for name, score in events)


class InstantScoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.official_calendar = scoring.load_official_calendar()

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

    def test_wta_merida_chinese_alias_uses_official_500_level(self):
        survivor_events = scoring._build_survivor_events_index([
            {'year': 2026, 'tour': 'WTA', 'event_name': '梅里达'}
        ])
        meta = scoring.get_meta('梅里达', 'WS', self.official_calendar, None, 6, 2026,
                                survivor_events=survivor_events)
        self.assertEqual(meta['type'], 'A500')
        self.assertEqual(scoring.norm_event_key(meta['event_key']), 'merida')

    def test_previous_year_event_not_opened_by_survivor_expires_and_is_not_reselected(self):
        survivor_events = scoring._build_survivor_events_index([
            {'year': 2026, 'tour': 'ATP', 'event_name': '伊斯特本'},
            {'year': 2026, 'tour': 'ATP', 'event_name': '哈雷'},
        ])
        evs = scoring.parse_details(
            '<b>【马洛卡(250)】</b><b>【哈雷(50)】</b>',
            'MS', self.official_calendar, None, 6, 2026, survivor_events
        )
        mallorca = next(e for e in evs if e['n'] == '马洛卡')
        self.assertFalse(mallorca['inc'])
        self.assertTrue(mallorca['meta']['expired_by_survivor_calendar'])

        selected, pool, mode = scoring.select_countable_events(
            evs, 'MS', '伊斯特本', 45, 95, self.official_calendar, None, 6, 2026,
            pending_events=None, survivor_events=survivor_events
        )
        self.assertEqual(scoring.sum_events(selected), 95)
        self.assertEqual({e['n'] for e in selected}, {'哈雷', '伊斯特本'})
        self.assertNotIn('马洛卡', {e['n'] for e in selected})

    def test_current_same_name_event_replaces_live_details_score(self):
        survivor_events = scoring._build_survivor_events_index([
            {'year': 2026, 'tour': 'ATP', 'event_name': '罗马'},
            {'year': 2026, 'tour': 'ATP', 'event_name': '澳网'},
        ])
        evs = scoring.parse_details(
            '<b>【罗马(180)】</b><b>【澳网(100)】</b>',
            'MS', self.official_calendar, None, 5, 2026, survivor_events
        )
        selected, pool, mode = scoring.select_countable_events(
            evs, 'MS', '罗马', 30, 130, self.official_calendar, None, 5, 2026,
            pending_events=None, survivor_events=survivor_events
        )
        self.assertEqual(mode, 'event_adjusted_forced')
        self.assertEqual(scoring.sum_events(selected), 130)
        self.assertEqual(next(e for e in selected if e['n'] == '罗马')['s'], 30)

    def test_current_deduct_score_includes_expired_mallorca_when_eastbourne_is_current(self):
        survivor_events = scoring._build_survivor_events_index([
            {'year': 2026, 'tour': 'ATP', 'event_name': '伊斯特本'},
            {'year': 2026, 'tour': 'ATP', 'event_name': '哈雷'},
        ])
        det = '<b>【马洛卡(250)】</b><b>【哈雷(50)】</b>'
        score = calc_current_deduct_score(
            det, 'MS', '伊斯特本', self.official_calendar, 6, 2026, survivor_events
        )
        self.assertEqual(score, 250)

    def test_wta_montreal_expiry_is_deferred_until_2026_canada_starts(self):
        survivor_events = scoring._build_survivor_events_index([
            {'year': 2026, 'tour': 'WTA', 'event_name': '华盛顿'},
        ])

        during_washington = scoring.choose_official_record(
            '蒙特利尔', 'WS', self.official_calendar, scoring.date(2026, 7, 27),
            survivor_events=survivor_events
        )
        canada_start = scoring.choose_official_record(
            '蒙特利尔', 'WS', self.official_calendar, scoring.date(2026, 8, 2),
            survivor_events=survivor_events
        )

        self.assertEqual(during_washington['year'], 2025)
        self.assertFalse(during_washington['expired_by_survivor_calendar'])
        self.assertEqual(canada_start['year'], 2025)
        self.assertTrue(canada_start['expired_by_survivor_calendar'])


if __name__ == '__main__':
    unittest.main()
