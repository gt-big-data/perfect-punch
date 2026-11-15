import unittest
from perfectpunch_backend.game.datavis_contract import landmark_payload, validate_target_region
from perfectpunch_backend.game.target_tracker import TargetOutcomeTracker

class TestDataVisContract(unittest.TestCase):
    def test_raw_landmarks(self):
        pts = [{'x': 0.5, 'y': 0.6, 'visibility': 0.9} for _ in range(33)]
        result = landmark_payload(pts, 960, 540, requested_punch='jab', requested_hand='left')
        self.assertEqual(result['coordinate_space'], 'unmirrored_image_normalized')
        self.assertEqual(result['landmarks']['left_shoulder']['x'], 0.5)
        self.assertEqual(result['frame_width'], 960)

    def test_validate_bounds(self):
        region = dict(min_x=.3, max_x=.7, min_y=.25, max_y=.75)
        self.assertEqual(validate_target_region(region), region)
        with self.assertRaises(ValueError):
            validate_target_region(dict(min_x=.7, max_x=.3, min_y=.25, max_y=.75))

    def test_no_sample_is_not_zero_accuracy(self):
        tracker = TargetOutcomeTracker('s')
        self.assertIsNone(tracker.snapshot()['punch_stats']['hook']['timing_accuracy_pct'])

if __name__ == '__main__':
    unittest.main()
