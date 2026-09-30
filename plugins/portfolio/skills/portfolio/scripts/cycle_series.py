#!/usr/bin/env python3
"""Read a verified monthly CSV; calculate a reproducible exploratory comparison."""
import argparse
import csv
from datetime import date
import hashlib
import io
import json
import math
from pathlib import Path
import sys


class DataError(ValueError):
    pass


def month_number(day):
    return day.year * 12 + day.month - 1


def percentile(value, history):
    return 100 * (sum(x < value for x in history)
                  + 0.5 * sum(x == value for x in history)) / len(history)


def stage(rank, displacement):
    score = 0 if rank < 5 else 25 if rank < 25 else 50 if rank <= 75 else 75 if rank <= 95 else 100
    if (score < 50 and displacement >= 0) or (score > 50 and displacement <= 0):
        return 50
    return score


def calculate(rows, as_of, mode="speed"):
    if mode not in ("speed", "metric"):
        raise DataError("unsupported mode")
    # Exclude the whole current month: no partial-month/month-end mixing.
    cutoff = month_number(as_of)
    months = {}
    for row in rows:
        day = date.fromisoformat(row["date"])
        if month_number(day) >= cutoff:
            continue
        value = float(row["value"])
        if not math.isfinite(value) or (mode == "speed" and value <= 0):
            raise DataError("non-finite value or non-positive price")
        month = month_number(day)
        if month in months:
            raise DataError("duplicate month")
        months[month] = (day, value)
    if not months or max(months) != cutoff - 1:
        raise DataError("latest completed month is missing; stale series")
    ordered = sorted(months)
    # Only the window actually consumed must be continuous.
    used = ordered[-217:] if mode == "speed" else ordered[-181:]
    if any(b != a + 1 for a, b in zip(used, used[1:])):
        raise DataError("missing month in comparison window")
    points = [months[m] for m in used]
    required = 157 if mode == "speed" else 121
    if len(points) < required:
        raise DataError(f"need at least {required} continuous monthly observations")
    if mode == "speed":
        logs = [math.log(v) for _, v in points]
        observations = [(points[i][0], logs[i] - sum(logs[i-36:i]) / 36)
                        for i in range(36, len(points))]
    else:
        observations = points
    history = observations[:-1][-180:]
    current_day, value = observations[-1]
    rank = percentile(value, [v for _, v in history])
    result = {
        "status": "calculated",
        "method": "speed-v1" if mode == "speed" else "monthly-metric-percentile-v1",
        "as_of": as_of.isoformat(),
        "observation_date": current_day.isoformat(),
        "current_value": value,
        "comparison_start": history[0][0].isoformat(),
        "comparison_end": history[-1][0].isoformat(),
        "comparison_count": len(history),
        "percentile": rank,
        "excluded_current_month": True,
    }
    if mode == "speed":
        change = points[-1][1] / points[-13][1] - 1
        result.update({
            "price": points[-1][1],
            "distance_from_geometric_mean_pct": 100 * math.expm1(value),
            "score": stage(rank, value),
            "direction_guard_applied": (rank < 25 and value >= 0) or (rank > 75 and value <= 0),
            "return_12m_pct": change * 100,
            "trend": "rising" if change > 0.05 else "falling" if change < -0.05 else "sideways",
        })
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_path", type=Path)
    parser.add_argument("--as-of", required=True, type=date.fromisoformat)
    parser.add_argument("--source", required=True)
    parser.add_argument("--basis", required=True)
    parser.add_argument("--mode", choices=("speed", "metric"), default="speed")
    args = parser.parse_args()
    try:
        if not args.source.startswith(("https://", "http://")) or not args.basis.strip():
            raise DataError("source URL and basis description are required")
        raw = args.csv_path.read_bytes()
        rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
        result = calculate(rows, args.as_of, args.mode)
        result.update({"source": args.source, "basis": args.basis,
                       "csv_sha256": hashlib.sha256(raw).hexdigest()})
    except (ValueError, OSError, KeyError) as error:
        print(json.dumps({"status": "unavailable", "reason": str(error)}, ensure_ascii=False))
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
