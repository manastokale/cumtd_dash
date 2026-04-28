#!/usr/bin/env python3

from __future__ import annotations

import csv
import io
import json
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path


GTFS_URL = "https://developer.mtd.org/gtfs/google_transit.zip"
CORE_OUTPUT_PATH = Path("data/gtfs-map.json")
TRIP_STOPS_OUTPUT_PATH = Path("data/gtfs-trip-stops.json")
RUNTIME_CONFIG_PATH = Path("data/runtime-config.json")
SIMPLIFY_TOLERANCE = 0.00004


def main() -> None:
    archive = download_zip(GTFS_URL)
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        routes = read_csv(bundle, "routes.txt")
        trips = read_csv(bundle, "trips.txt")
        shapes = read_csv(bundle, "shapes.txt")
        stops = read_csv(bundle, "stops.txt")
        stop_times = read_csv(bundle, "stop_times.txt")

    routes_by_gtfs_route_id = {
        row["route_id"]: {
            "gtfsRouteId": row["route_id"],
            "shortName": row.get("route_short_name", "").strip(),
            "longName": row.get("route_long_name", "").strip(),
            "color": normalize_color(row.get("route_color", "")),
            "textColor": normalize_color(row.get("route_text_color", "")),
        }
        for row in routes
        if row.get("route_id")
    }

    trip_shape_index: dict[str, str] = {}
    shape_route_index: dict[str, str] = {}
    used_shape_ids: set[str] = set()

    for row in trips:
        trip_id = row.get("trip_id", "").strip()
        shape_id = row.get("shape_id", "").strip()
        route_id = row.get("route_id", "").strip()
        if not trip_id or not shape_id:
            continue
        trip_shape_index[trip_id] = shape_id
        if route_id and shape_id not in shape_route_index:
            shape_route_index[shape_id] = route_id
        used_shape_ids.add(shape_id)

    shape_points: dict[str, list[tuple[int, float, float]]] = defaultdict(list)
    for row in shapes:
        shape_id = row.get("shape_id", "").strip()
        if shape_id not in used_shape_ids:
            continue
        try:
            sequence = int(float(row["shape_pt_sequence"]))
            lat = float(row["shape_pt_lat"])
            lon = float(row["shape_pt_lon"])
        except (KeyError, ValueError):
            continue
        shape_points[shape_id].append((sequence, lat, lon))

    simplified_shapes: dict[str, list[list[float]]] = {}
    for shape_id, raw_points in shape_points.items():
        ordered = [(lat, lon) for sequence, lat, lon in sorted(raw_points)]
        deduped = dedupe_points(ordered)
        simplified = simplify_path(deduped, SIMPLIFY_TOLERANCE)
        if len(simplified) >= 2:
            simplified_shapes[shape_id] = [[round(lat, 6), round(lon, 6)] for lat, lon in simplified]

    stops_by_id: dict[str, dict[str, object]] = {}
    for row in stops:
        stop_id = row.get("stop_id", "").strip()
        if not stop_id:
            continue
        try:
            lat = float(row["stop_lat"])
            lon = float(row["stop_lon"])
        except (KeyError, ValueError):
            continue
        stop_name = row.get("stop_name", "").strip()
        stop_desc = row.get("stop_desc", "").strip()
        stops_by_id[stop_id] = {
            "id": stop_id,
            "name": stop_name,
            "description": stop_desc,
            "displayName": stop_name if not stop_desc else f"{stop_name} ({stop_desc})",
            "code": row.get("stop_code", "").strip(),
            "location": [round(lat, 6), round(lon, 6)],
        }

    stop_route_ids: dict[str, set[str]] = defaultdict(set)
    trip_stops: dict[str, list[dict[str, object]]] = defaultdict(list)
    for row in stop_times:
        trip_id = row.get("trip_id", "").strip()
        stop_id = row.get("stop_id", "").strip()
        shape_id = trip_shape_index.get(trip_id)
        route_id = shape_route_index.get(shape_id, "")
        stop = stops_by_id.get(stop_id)
        if not shape_id or not stop:
            continue
        if route_id:
            stop_route_ids[stop_id].add(route_id)

        try:
            stop_sequence = int(float(row.get("stop_sequence", "0") or "0"))
        except ValueError:
            stop_sequence = 0
        trip_stops[trip_id].append(
            {
                "stopId": stop_id,
                "stopSequence": stop_sequence,
                "arrivalTime": row.get("arrival_time", "").strip(),
                "departureTime": row.get("departure_time", "").strip(),
            }
        )

    ordered_trip_stops = {
        trip_id: sorted(stops_for_trip, key=lambda item: int(item["stopSequence"]))
        for trip_id, stops_for_trip in trip_stops.items()
    }

    CORE_OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    CORE_OUTPUT_PATH.write_text(
        json.dumps(
            {
                "source": GTFS_URL,
                "routesByGtfsRouteId": routes_by_gtfs_route_id,
                "tripShapeIndex": trip_shape_index,
                "shapeRouteIndex": shape_route_index,
                "shapes": simplified_shapes,
                "stopsById": stops_by_id,
                "stopRouteIdsByStopId": {
                    stop_id: sorted(route_ids) for stop_id, route_ids in stop_route_ids.items()
                },
            },
            separators=(",", ":"),
        )
    )
    TRIP_STOPS_OUTPUT_PATH.write_text(
        json.dumps(
            {
                "tripStopsByTripId": ordered_trip_stops,
            },
            separators=(",", ":"),
        )
    )
    write_runtime_config()
    print(f"Wrote {CORE_OUTPUT_PATH}")
    print(f"Wrote {TRIP_STOPS_OUTPUT_PATH}")


def download_zip(url: str) -> bytes:
    with urllib.request.urlopen(url) as response:
        return response.read()


def read_csv(bundle: zipfile.ZipFile, filename: str) -> list[dict[str, str]]:
    with bundle.open(filename) as handle:
        text = io.TextIOWrapper(handle, encoding="utf-8-sig")
        return list(csv.DictReader(text))


def normalize_color(value: str) -> str:
    value = value.strip()
    if not value:
        return ""
    return value if value.startswith("#") else f"#{value}"


def write_runtime_config() -> None:
    env = read_env_file(Path(".env"))
    config = {
        "apiKey": env.get("API_KEY", ""),
        "refreshIntervalMs": int(env.get("REFRESH_INTERVAL_MS", "120000") or "120000"),
        "tileUrl": env.get("TILE_URL", "https://tile.openstreetmap.org/{z}/{x}/{y}.png"),
        "tileAttribution": env.get(
            "TILE_ATTRIBUTION",
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        ),
        "tileMaxZoom": int(env.get("TILE_MAX_ZOOM", "19") or "19"),
        "initialTheme": env.get("INITIAL_THEME", "light"),
    }
    RUNTIME_CONFIG_PATH.write_text(json.dumps(config, separators=(",", ":")))


def read_env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    values: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def dedupe_points(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    if not points:
        return []
    deduped = [points[0]]
    for point in points[1:]:
        if point != deduped[-1]:
            deduped.append(point)
    return deduped


def simplify_path(points: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    if len(points) <= 2:
        return points
    keep = [False] * len(points)
    keep[0] = True
    keep[-1] = True
    simplify_segment(points, 0, len(points) - 1, tolerance * tolerance, keep)
    return [point for point, include in zip(points, keep) if include]


def simplify_segment(
    points: list[tuple[float, float]],
    start_index: int,
    end_index: int,
    tolerance_sq: float,
    keep: list[bool],
) -> None:
    max_distance_sq = 0.0
    max_index = -1
    start = points[start_index]
    end = points[end_index]

    for index in range(start_index + 1, end_index):
        distance_sq = perpendicular_distance_sq(points[index], start, end)
        if distance_sq > max_distance_sq:
            max_distance_sq = distance_sq
            max_index = index

    if max_index != -1 and max_distance_sq > tolerance_sq:
        keep[max_index] = True
        simplify_segment(points, start_index, max_index, tolerance_sq, keep)
        simplify_segment(points, max_index, end_index, tolerance_sq, keep)


def perpendicular_distance_sq(
    point: tuple[float, float],
    start: tuple[float, float],
    end: tuple[float, float],
) -> float:
    sx, sy = start
    ex, ey = end
    px, py = point
    dx = ex - sx
    dy = ey - sy
    if dx == 0 and dy == 0:
        return (px - sx) ** 2 + (py - sy) ** 2
    t = max(0.0, min(1.0, ((px - sx) * dx + (py - sy) * dy) / (dx * dx + dy * dy)))
    proj_x = sx + dx * t
    proj_y = sy + dy * t
    return (px - proj_x) ** 2 + (py - proj_y) ** 2


if __name__ == "__main__":
    main()
