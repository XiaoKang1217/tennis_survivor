#!/usr/bin/env python3
"""
Generate public settlement data for the Daily Jinx leaderboard.

The file records which players lost on settled dates, when each match started,
and the survivor live-pick count for each loser. Vote aggregation stays inside
Supabase through a security-definer RPC so raw vote rows are not exposed publicly.
"""
import json
import os
import re
from datetime import datetime, timedelta, timezone

import requests


BASE_URL = "https://www.live-tennis.cn"
OUT_PATH = os.path.join("data", "daily_jinx_settlements.json")
PICK_COUNTS_PATH = os.path.join("data", "daily_jinx_pick_counts.json")
START_DATE = datetime(2026, 5, 24).date()
REFRESH_DAYS = 10


def make_session():
    s = requests.Session()
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Referer": BASE_URL,
    })
    return s


def clean_html(text):
    text = re.sub(r"<[^>]+>", "", text or "")
    return re.sub(r"\s+", " ", text).strip()


def parse_open_stat_args(raw):
    return re.findall(r"&quot;([^&]*)&quot;", raw or "")


def unix_timestamp_to_iso(raw):
    try:
        ts = int(str(raw or "").strip())
    except ValueError:
        return None, None
    if ts <= 0:
        return None, None
    return ts, datetime.fromtimestamp(ts, timezone.utc).isoformat().replace("+00:00", "Z")


def parse_result_date(session, date_key):
    url = f"{BASE_URL}/zh/result/{date_key}"
    html = session.get(url, timeout=35).text
    records = []
    seen = set()

    tour_blocks = list(re.finditer(r'id="iResult([^"]+)"', html))
    for i, block in enumerate(tour_blocks):
        block_start = block.start()
        block_end = tour_blocks[i + 1].start() if i + 1 < len(tour_blocks) else len(html)
        seg = html[block_start:block_end]
        city_match = re.search(r'<div class="cResultTourInfoCity[^"]*"[^>]*>(.*?)</div>', seg, re.S)
        event_name = clean_html(city_match.group(1)) if city_match else block.group(1)

        for stat in re.finditer(r"open_stat\((.*?)\)", seg):
            args = parse_open_stat_args(stat.group(1))
            if len(args) < 8:
                continue
            event_id, tour_code, match_id, year, _p1id, _p2id, p1, p2 = args[:8]
            match_start = seg.rfind('<div class="cResultMatch', 0, stat.start())
            match_end = seg.find("</table>", stat.end())
            if match_start < 0 or match_end < 0:
                continue
            match_html = seg[match_start:match_end]
            if 'match-status="2"' not in match_html:
                continue
            if 'is-double="1"' in match_html:
                continue

            time_match = re.search(r"<div class=cResultMatchTime>(\d+)</div>", match_html)
            match_start_ts, match_start_at = unix_timestamp_to_iso(time_match.group(1) if time_match else "")
            gender_match = re.search(r"<div class=cResultMatchGender>([^<]+)</div>", match_html)
            round_match = re.search(r"<div class=cResultMatchRound>([^<]+)</div>", match_html)
            gender_text = clean_html(gender_match.group(1)) if gender_match else ""
            round_text = clean_html(round_match.group(1)) if round_match else ""
            if "Q" in round_text or "资格" in round_text:
                continue
            if gender_text == "男单":
                tour = "ATP"
            elif gender_text == "女单":
                tour = "WTA"
            else:
                continue

            rows = re.findall(r'<tr class="([^"]*)"', match_html)
            if len(rows) < 2:
                continue
            if "cResultMatchMidTableRowWinner" in rows[0]:
                loser = p2
            elif "cResultMatchMidTableRowWinner" in rows[1]:
                loser = p1
            else:
                continue
            loser = clean_html(loser)
            if not loser:
                continue

            key = (date_key, tour, event_id, match_id, loser)
            if key in seen:
                continue
            seen.add(key)
            records.append({
                "date": date_key,
                "tour": tour,
                "event_id": event_id,
                "event_name": event_name,
                "match_id": match_id,
                "round": round_text,
                "player_name": loser,
                "match_start_ts": match_start_ts,
                "match_start_at": match_start_at,
            })
    return records


def load_existing():
    if not os.path.exists(OUT_PATH):
        return []
    with open(OUT_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data.get("settlements", [])


def load_pick_count_snapshots():
    if not os.path.exists(PICK_COUNTS_PATH):
        return {}
    try:
        with open(PICK_COUNTS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return {}

    snapshots = {}
    for item in data.get("snapshots", []):
        key = (item.get("date"), item.get("tour"), item.get("event_id") or "")
        if item.get("date") and item.get("tour"):
            snapshots[key] = item.get("player_counts") or {}
    return snapshots


def attach_pick_counts(records, snapshots):
    out = []
    for item in records:
        row = dict(item)
        key = (row.get("date"), row.get("tour"), row.get("event_id") or "")
        player_counts = snapshots.get(key) or {}
        row["pick_count"] = int(player_counts.get(row.get("player_name"), row.get("pick_count") or 0) or 0)
        out.append(row)
    return out


def main():
    tz_cn = timezone(timedelta(hours=8))
    today = datetime.now(tz_cn).date()
    yesterday = today - timedelta(days=1)
    existing = load_existing()
    pick_count_snapshots = load_pick_count_snapshots()

    if yesterday < START_DATE:
        settlements = []
        settled_through = ""
    else:
        refresh_start = max(START_DATE, yesterday - timedelta(days=REFRESH_DAYS - 1))
        refresh_dates = []
        d = refresh_start
        while d <= yesterday:
            refresh_dates.append(d)
            d += timedelta(days=1)

        session = make_session()
        refreshed = []
        successful_refresh_dates = set()
        for d in refresh_dates:
            date_key = d.isoformat()
            try:
                day_records = parse_result_date(session, date_key)
                print(f"{date_key}: {len(day_records)} lost singles records")
                refreshed.extend(day_records)
                successful_refresh_dates.add(date_key)
            except Exception as exc:
                print(f"WARN: failed to parse {date_key}: {exc}")

        refresh_keys = successful_refresh_dates
        kept = [x for x in existing if x.get("date") not in refresh_keys]
        settlements = attach_pick_counts(kept + refreshed, pick_count_snapshots)
        settlements.sort(key=lambda x: (x.get("date", ""), x.get("tour", ""), x.get("event_id", ""), x.get("player_name", "")))
        settled_dates = {x.get("date") for x in settlements if x.get("date")}
        settled_dates.update(successful_refresh_dates)
        settled_through = max(settled_dates) if settled_dates else ""

    output = {
        "updated_at": datetime.now(tz_cn).strftime("%Y-%m-%d %H:%M:%S"),
        "start_date": START_DATE.isoformat(),
        "settled_through": settled_through,
        "refreshed_dates": sorted(successful_refresh_dates) if yesterday >= START_DATE else [],
        "settlements": settlements,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {OUT_PATH}: {len(settlements)} settlement records")


if __name__ == "__main__":
    main()
