"""Financial-data integrity checks for the bundled monthly comparison calculator."""
import importlib.util
from datetime import date
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
path = Path(__file__).resolve().parents[1] / "plugins/portfolio/skills/portfolio/scripts/cycle_series.py"
spec = importlib.util.spec_from_file_location("cycle_series", path)
cycle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cycle)


def series(count=217):
    result = []
    for offset in range(count):
        month = 2026 * 12 + 7 - (count - 1) + offset
        year, zero_month = divmod(month, 12)
        # A valid last trading-day label; no calendar-day interpolation.
        result.append({"date": f"{year:04d}-{zero_month+1:02d}-28", "value": str(100 + offset)})
    return result


class CycleDataTests(unittest.TestCase):
    def test_current_and_future_months_do_not_change_result(self):
        rows = series()
        expected = cycle.calculate(rows, date(2026, 9, 29))
        rows += [{"date": "2026-09-29", "value": "10000000"},
                 {"date": "2027-01-28", "value": "1"}]
        self.assertEqual(expected, cycle.calculate(rows, date(2026, 9, 29)))
        self.assertEqual(expected["comparison_count"], 180)
        self.assertEqual(expected["comparison_end"], "2026-07-28")

    def test_missing_duplicate_stale_and_short_inputs_fail(self):
        for rows in [series()[:-1], series(156), series() + [series()[-1]],
                     series()[:90] + series()[91:]]:
            with self.subTest(length=len(rows)), self.assertRaises(cycle.DataError):
                cycle.calculate(rows, date(2026, 9, 29))

    def test_invalid_prices_fail(self):
        for value in ["0", "-1", "NaN", "inf"]:
            rows = series()
            rows[-1]["value"] = value
            with self.subTest(value=value), self.assertRaises(cycle.DataError):
                cycle.calculate(rows, date(2026, 9, 29))

    def test_boundary_and_direction_semantics(self):
        self.assertEqual([cycle.stage(p, -1 if p < 25 else 1) for p in [0, 5, 25, 75, 95, 96]],
                         [0, 25, 50, 50, 75, 100])
        self.assertEqual(cycle.stage(2, 1), 50)
        self.assertEqual(cycle.stage(99, -1), 50)
        self.assertEqual(cycle.percentile(2, [1, 2, 2, 3]), 50)

    def test_flat_series_is_neutral_and_metrics_do_not_emit_speed_score(self):
        rows = series()
        for row in rows:
            row["value"] = "100"
        result = cycle.calculate(rows, date(2026, 9, 29))
        self.assertEqual(result["score"], 50)
        self.assertEqual(result["trend"], "sideways")
        self.assertNotIn("score", cycle.calculate(rows, date(2026, 9, 29), "metric"))


if __name__ == "__main__":
    unittest.main()
