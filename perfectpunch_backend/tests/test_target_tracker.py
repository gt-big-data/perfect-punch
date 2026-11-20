import unittest
from perfectpunch_backend.game.target_tracker import TargetOutcomeTracker


class TestTargetOutcomes(unittest.TestCase):
    def setUp(self):
        self.tracker = TargetOutcomeTracker("session-123")

    def spawn(self, target_id, punch="jab"):
        return self.tracker.spawn(
            target_id=target_id, requested_punch=punch,
            spawned_at_ms=1_000, expires_at_ms=3_000,
            requested_hand="left",
        )

    def test_perfect_and_good_both_hits(self):
        self.spawn("a", "jab")
        self.spawn("b", "jab")
        self.tracker.resolve(target_id="a", timing_grade="perfect", resolved_at_ms=1400)
        self.tracker.resolve(target_id="b", timing_grade="good", resolved_at_ms=1800)
        result = self.tracker.snapshot()["punch_stats"]["jab"]
        self.assertEqual((result["perfect"], result["good"], result["timing_hits"]), (1, 1, 2))
        self.assertEqual(result["timing_accuracy_pct"], 100)

    def test_expiry_and_duplicate_event(self):
        self.spawn("a", "hook")
        self.assertEqual(self.tracker.expire(now_ms=2999), [])
        self.assertEqual(len(self.tracker.expire(now_ms=3000)), 1)
        self.assertEqual(len(self.tracker.expire(now_ms=4000)), 0)
        self.assertIsNone(self.tracker.resolve(target_id="a", timing_grade="good", resolved_at_ms=4000))
        self.assertEqual(self.tracker.snapshot()["punch_stats"]["hook"]["miss"], 1)

    def test_no_attempts_is_null_accuracy(self):
        self.assertIsNone(self.tracker.snapshot()["punch_stats"]["uppercut"]["timing_accuracy_pct"])

    def test_classification_separate_from_timing(self):
        self.spawn("a", "hook")
        event = self.tracker.resolve(
            target_id="a", timing_grade="good", resolved_at_ms=1500,
            detected_punch="jab", classification_correct=False, classifier_confidence=0.92,
        )
        self.assertTrue(event["timing_hit"])
        self.assertFalse(event["classification_correct"])
        self.assertEqual(self.tracker.snapshot()["punch_stats"]["hook"]["timing_hits"], 1)

    def test_ungraded_backend_contact_does_not_fabricate_good(self):
        self.spawn("contact", "hook")
        event = self.tracker.resolve(target_id="contact", timing_grade=None,
                                     hit_target=True, resolved_at_ms=1500,
                                     detected_punch="jab", classification_correct=False)
        self.assertTrue(event["hit_target"])
        self.assertIsNone(event["timing_grade"])
        s = self.tracker.snapshot()["punch_stats"]["hook"]
        self.assertEqual(s["target_hits"], 1)
        self.assertEqual(s["good"], 0)
        self.assertEqual(s["incorrect_type"], 1)

    def test_cancel_not_miss(self):
        self.spawn("a", "uppercut")
        self.tracker.cancel_pending(now_ms=2000)
        result = self.tracker.snapshot()["punch_stats"]["uppercut"]
        self.assertEqual(result["cancelled_targets"], 1)
        self.assertEqual(result["miss"], 0)

    def test_invariants(self):
        for idx, grade in enumerate(("perfect", "good", "miss")):
            self.spawn(f"t{idx}", "jab")
            self.tracker.resolve(target_id=f"t{idx}", timing_grade=grade, resolved_at_ms=1900)
        s = self.tracker.snapshot()
        self.assertEqual(s["totals"]["completed_targets"], 3)
        self.assertEqual(s["totals"]["timing_hits"] + s["totals"]["misses"], 3)


if __name__ == "__main__":
    unittest.main()

class TestDatavisContract(unittest.TestCase):
    def test_selection_history_and_classified_counts(self):
        t = TargetOutcomeTracker('s')
        for i,punch in enumerate(('jab','jab','hook','hook')):
            t.spawn(target_id=f't{i}',requested_punch=punch,requested_hand='left',spawned_at_ms=1000,expires_at_ms=3000)
        t.resolve(target_id='t2',timing_grade='good',resolved_at_ms=1200,classification_correct=False,detected_punch='jab')
        s=t.snapshot()
        self.assertEqual(s['selection_history'], ['jab','jab','hook','hook'])
        self.assertEqual(s['last_selected_punch'], 'hook')
        self.assertEqual(s['consecutive_punch_count'], 2)
        self.assertEqual(s['punch_stats']['hook']['incorrect_type'], 1)
        self.assertEqual(s['punch_stats']['hook']['correct_type'], 0)

    def test_landmark_contract(self):
        from perfectpunch_backend.game.datavis_contract import landmark_payload
        lms=[{'x':0.5,'y':0.6,'visibility':0.99} for _ in range(33)]
        data=landmark_payload(lms,960,540,requested_punch='jab',requested_hand='left')
        self.assertEqual(data['landmarks']['left_elbow']['x'], 0.5)
        self.assertEqual(data['coordinate_space'], 'unmirrored_image_normalized')

    def test_validate_region(self):
        from perfectpunch_backend.game.datavis_contract import validate_target_region
        self.assertEqual(validate_target_region({'min_x':.2,'max_x':.5,'min_y':.3,'max_y':.7})['max_x'],.5)
        with self.assertRaises(ValueError):
            validate_target_region({'min_x':.8,'max_x':.5,'min_y':.3,'max_y':.7})
