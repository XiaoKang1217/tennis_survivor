import unittest
from scripts.fetch_daily_jinx_settlements import attach_pick_counts


class CountCorrectionsTest(unittest.TestCase):
    def setUp(self):
        self.row = dict(date="2026-09-23", tour="ATP", event_id="24713",
                        match_id="MS026", player_name="武基奇", pick_count=0)
        self.correction = dict(self.row, pick_count=41, official_day=1)

    def test_corrects_overwritten_snapshot_and_survives_rerun(self):
        snapshots = {("2026-09-23", "ATP", "24713"): {"巴列霍": 23}}
        once = attach_pick_counts([self.row], snapshots, [self.correction])
        self.assertEqual(once[0]["pick_count"], 41)
        self.assertEqual(once, attach_pick_counts(once, snapshots, [self.correction]))

    def test_other_date_event_match_and_player_unchanged(self):
        for field, value in [("date", "2026-09-24"), ("event_id", "other"),
                             ("match_id", "MS025"), ("player_name", "沃尔顿")]:
            row = dict(self.row, **{field: value})
            self.assertEqual(attach_pick_counts([row], {}, [self.correction])[0]["pick_count"], 0)

    def test_existing_unrelated_points_preserved(self):
        row = dict(self.row, match_id="other", pick_count=12)
        self.assertEqual(attach_pick_counts([row], {}, [self.correction])[0]["pick_count"], 12)


if __name__ == "__main__":
    unittest.main()
