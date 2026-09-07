#!/usr/bin/env python3
"""Append GitHub traffic data to a committed history.

GitHub keeps only a 14-day rolling window and discards everything older, so any
day nobody snapshots is lost permanently. This merges each fetch into a
cumulative file keyed by date.

Re-running the same day is safe: a date already present is overwritten with the
newer figure, because a day's count keeps rising until the day closes.

Usage:  snapshot-traffic.py <clones.json> <views.json> <referrers.json>
        (each argument is a file containing that endpoint's raw response)
"""
import json, pathlib, sys, datetime

HERE = pathlib.Path(__file__).resolve().parent.parent / "traffic"


def merge_daily(path: pathlib.Path, incoming: list[dict]) -> tuple[int, int]:
    """Merge daily buckets by timestamp. Returns (total_days, new_days)."""
    existing = json.loads(path.read_text()) if path.exists() else []
    by_date = {row["timestamp"]: row for row in existing}
    before = len(by_date)
    for row in incoming:
        # Later fetch wins: today's bucket grows as the day goes on.
        by_date[row["timestamp"]] = {
            "timestamp": row["timestamp"],
            "count": row.get("count", 0),
            "uniques": row.get("uniques", 0),
        }
    merged = sorted(by_date.values(), key=lambda r: r["timestamp"])
    path.write_text(json.dumps(merged, indent=2) + "\n")
    return len(merged), len(by_date) - before


def summarise() -> str:
    """A committed summary, so the numbers are readable without running anything."""
    lines = ["# Traffic history", "",
             "Snapshotted daily because GitHub only retains 14 days.", ""]
    for name, label in (("clones", "Clones"), ("views", "Views")):
        p = HERE / f"{name}.json"
        if not p.exists():
            continue
        rows = json.loads(p.read_text())
        if not rows:
            continue
        total = sum(r["count"] for r in rows)
        uniq = sum(r["uniques"] for r in rows)
        last14 = rows[-14:]
        lines += [
            f"## {label}", "",
            f"- **{total}** total, **{uniq}** unique, across {len(rows)} recorded days",
            f"- last 14 recorded days: {sum(r['count'] for r in last14)} total,"
            f" {sum(r['uniques'] for r in last14)} unique",
            f"- first recorded: `{rows[0]['timestamp'][:10]}`,"
            f" latest: `{rows[-1]['timestamp'][:10]}`", "",
        ]
    ref = HERE / "referrers.json"
    if ref.exists():
        snaps = json.loads(ref.read_text())
        if snaps:
            newest = snaps[-1]
            lines += ["## Top referrers (most recent snapshot)", "",
                      f"_as of {newest['snapshot_date']}_", ""]
            for r in newest.get("referrers", [])[:10]:
                lines.append(f"- {r['referrer']} — {r['count']} ({r['uniques']} unique)")
            lines.append("")
    lines += ["---", "",
              "Clones cover every install path (`claude plugin marketplace add`,",
              "`npx skills add`, manual `git clone`) and cannot distinguish between",
              "them. `claude plugin update` re-fetches, so repeat updates inflate",
              "`count`; `uniques` is the better proxy for people. Nothing here",
              "measures actual *use* of the skill - only acquisition.", ""]
    return "\n".join(lines)


def main() -> int:
    clones_f, views_f, refs_f = (pathlib.Path(a) for a in sys.argv[1:4])
    HERE.mkdir(exist_ok=True)

    for src, name in ((clones_f, "clones"), (views_f, "views")):
        payload = json.loads(src.read_text())
        total, new = merge_daily(HERE / f"{name}.json", payload.get(name, []))
        print(f"  {name:<9} {total} days recorded ({new} new)")

    # Referrers are a 14-day aggregate, not per-day - keep dated snapshots.
    refs = json.loads(refs_f.read_text())
    path = HERE / "referrers.json"
    snaps = json.loads(path.read_text()) if path.exists() else []
    today = datetime.date.today().isoformat()
    snaps = [s for s in snaps if s["snapshot_date"] != today]
    snaps.append({"snapshot_date": today, "referrers": refs})
    snaps.sort(key=lambda s: s["snapshot_date"])
    path.write_text(json.dumps(snaps[-90:], indent=2) + "\n")  # ~3 months of snapshots
    print(f"  referrers {len(snaps)} snapshots recorded")

    (HERE / "SUMMARY.md").write_text(summarise())
    print("  SUMMARY.md regenerated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
