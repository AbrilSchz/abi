#!/usr/bin/env python3
"""
Validador de contratos de interfaz (Sección 4 de ORQUESTADOR.md) para Marswalk 3D.
No requiere librerías externas (usa únicamente la biblioteca estándar de Python).

Valida para cada carpeta en public/data/<dataset_id>/:
  - 4.1 metadata.json + binario heightmap.f32 (tamaño exacto rows*cols*4, NaN/Inf, rango de elevación)
  - 4.2 config_fisio.json (gravedad, altura de ojos, velocidades, reserva de O2, tabla slope_cost_factors)
  - 4.3 route.json (opcional: dataset_id, algorithm in {"astar","qaoa"}, path_m, metrics)
  - 4.4 poi.json (opcional: dataset_id, points con id, name, position_m, type, description, source)
"""

import json
import math
import struct
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "public" / "data"


class ContractValidationError(Exception):
    pass


def require(cond: bool, msg: str):
    if not cond:
        raise ContractValidationError(msg)


def validate_metadata_and_f32(ds_dir: Path, ds_id: str) -> dict:
    meta_path = ds_dir / "metadata.json"
    require(meta_path.is_file(), f"[{ds_id}] Falta metadata.json (Contrato 4.1)")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))

    required_str = ["dataset_id", "label", "source", "crs", "acquisition_date", "uncertainty_note"]
    for field in required_str:
        require(isinstance(meta.get(field), str) and len(meta[field].strip()) > 0,
                f"[{ds_id}] metadata.{field} debe ser un string no vacío")

    require(meta["dataset_id"] == ds_id,
            f"[{ds_id}] metadata.dataset_id ('{meta['dataset_id']}') no coincide con la carpeta '{ds_id}'")

    shape = meta.get("shape")
    require(isinstance(shape, list) and len(shape) == 2 and all(isinstance(x, int) and x > 1 for x in shape),
            f"[{ds_id}] metadata.shape inválido: {shape}")
    rows, cols = shape

    res_m = meta.get("resolution_m")
    require(isinstance(res_m, (int, float)) and res_m > 0,
            f"[{ds_id}] metadata.resolution_m inválido: {res_m}")

    size_m = meta.get("size_m")
    require(isinstance(size_m, list) and len(size_m) == 2 and all(isinstance(x, (int, float)) and x > 0 for x in size_m),
            f"[{ds_id}] metadata.size_m inválido: {size_m}")

    elev_range = meta.get("elevation_range_m")
    require(isinstance(elev_range, list) and len(elev_range) == 2 and elev_range[0] <= elev_range[1],
            f"[{ds_id}] metadata.elevation_range_m inválido: {elev_range}")

    hm = meta.get("heightmap")
    require(
        isinstance(hm, dict)
        and isinstance(hm.get("file"), str)
        and hm.get("format") == "float32-le"
        and hm.get("units") == "m",
        f"[{ds_id}] metadata.heightmap debe tener file, format='float32-le' y units='m' (Contrato 4.1)",
    )

    f32_path = ds_dir / hm["file"]
    require(f32_path.is_file(), f"[{ds_id}] No existe el binario {f32_path.name}")

    expected_bytes = rows * cols * 4
    actual_bytes = f32_path.stat().st_size
    require(actual_bytes == expected_bytes,
            f"[{ds_id}] Tamaño de {f32_path.name} ({actual_bytes} B) != rows*cols*4 ({expected_bytes} B)")

    raw = f32_path.read_bytes()
    step = max(1, (rows * cols) // 5000)
    for idx in range(0, rows * cols, step):
        val = struct.unpack_from("<f", raw, idx * 4)[0]
        require(math.isfinite(val), f"[{ds_id}] Valor NaN/Inf detectado en heightmap.f32 índice {idx}")

    require(isinstance(meta.get("layers"), list) and len(meta["layers"]) >= 1,
            f"[{ds_id}] metadata.layers debe contener al menos la capa base")
    return meta


def validate_config_fisio(ds_dir: Path, ds_id: str):
    fisio_path = ds_dir / "config_fisio.json"
    require(fisio_path.is_file(), f"[{ds_id}] Falta config_fisio.json (Contrato 4.2)")
    fisio = json.loads(fisio_path.read_text(encoding="utf-8"))

    num_fields = [
        "gravity_ms2",
        "eye_height_m",
        "walk_speed_ms",
        "run_speed_ms",
        "max_safe_slope_deg",
        "o2_reserve_l",
        "o2_base_consumption_l_per_h",
    ]
    for f in num_fields:
        require(isinstance(fisio.get(f), (int, float)) and fisio[f] > 0,
                f"[{ds_id}] config_fisio.{f} debe ser número > 0")

    require(isinstance(fisio.get("notes"), str) and len(fisio["notes"].strip()) > 0,
            f"[{ds_id}] config_fisio.notes debe documentar fuentes y supuestos")

    factors = fisio.get("slope_cost_factors")
    require(isinstance(factors, list) and len(factors) >= 2,
            f"[{ds_id}] config_fisio.slope_cost_factors debe ser lista con >= 2 tramos")
    for item in factors:
        require(
            isinstance(item, dict)
            and isinstance(item.get("from_deg"), (int, float))
            and isinstance(item.get("to_deg"), (int, float))
            and isinstance(item.get("factor"), (int, float))
            and item["factor"] > 0,
            f"[{ds_id}] Entrada inválida en slope_cost_factors: {item}",
        )


def validate_route_if_present(ds_dir: Path, ds_id: str):
    route_path = ds_dir / "route.json"
    if not route_path.is_file():
        return False
    route = json.loads(route_path.read_text(encoding="utf-8"))
    require(route.get("dataset_id") == ds_id,
            f"[{ds_id}] route.dataset_id ('{route.get('dataset_id')}') != '{ds_id}'")
    require(route.get("algorithm") in ("astar", "qaoa"),
            f"[{ds_id}] route.algorithm debe ser 'astar' o 'qaoa' (Contrato 4.3)")
    path_m = route.get("path_m")
    require(isinstance(path_m, list) and len(path_m) >= 2,
            f"[{ds_id}] route.path_m debe tener al menos 2 puntos")
    for pt in path_m:
        require(isinstance(pt, list) and len(pt) == 2 and all(isinstance(v, (int, float)) for v in pt),
                f"[{ds_id}] Punto inválido en route.path_m: {pt}")
    metrics = route.get("metrics", {})
    for mf in ("distance_m", "oxygen_l", "max_slope_deg", "risk_score"):
        require(isinstance(metrics.get(mf), (int, float)) and metrics[mf] >= 0,
                f"[{ds_id}] route.metrics.{mf} inválido")
    return True


def validate_poi_if_present(ds_dir: Path, ds_id: str, meta: dict):
    poi_path = ds_dir / "poi.json"
    if not poi_path.is_file():
        return 0
    poi_data = json.loads(poi_path.read_text(encoding="utf-8"))
    require(poi_data.get("dataset_id") == ds_id,
            f"[{ds_id}] poi.dataset_id ('{poi_data.get('dataset_id')}') != '{ds_id}'")
    points = poi_data.get("points")
    require(isinstance(points, list) and len(points) >= 1,
            f"[{ds_id}] poi.points debe ser una lista no vacía (Contrato 4.4)")

    half_w = meta["size_m"][0] * 0.5
    half_d = meta["size_m"][1] * 0.5

    for p in points:
        for sf in ("id", "name", "type", "description", "source"):
            require(isinstance(p.get(sf), str) and len(p[sf].strip()) > 0,
                    f"[{ds_id}] POI '{p.get('id')}' campo '{sf}' vacío o inválido")
        require(p["type"] in ("sampling", "hazard", "shelter"),
                f"[{ds_id}] POI '{p['id']}' type inválido: {p['type']}")
        coords = p.get("position_m")
        require(isinstance(coords, list) and len(coords) == 2 and all(isinstance(v, (int, float)) for v in coords),
                f"[{ds_id}] POI '{p['id']}' position_m inválido: {coords}")
        require(-half_w <= coords[0] <= half_w and -half_d <= coords[1] <= half_d,
                f"[{ds_id}] POI '{p['id']}' position_m {coords} fuera de límites del DEM")
    return len(points)
def validate_config_health_if_present(ds_dir: Path, ds_id: str) -> bool:
    """Contrato 4.5 — opcional. Si existe, valida schema y rangos."""
    cfg_path = ds_dir / "config_health.json"
    if not cfg_path.is_file():
        return False
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    require(cfg.get("dataset_id") == ds_id,
            f"[{ds_id}] config_health.dataset_id != '{ds_id}'")

    if "group_size" in cfg:
        gs = cfg["group_size"]
        require(isinstance(gs, int) and 1 <= gs <= 8,
                f"[{ds_id}] config_health.group_size debe ser entero en [1, 8]")

    members = cfg.get("members")
    if members is not None:
        require(isinstance(members, list) and 1 <= len(members) <= 8,
                f"[{ds_id}] config_health.members debe ser lista de 1..8")
        ids = set()
        for m in members:
            require(isinstance(m, dict), f"[{ds_id}] member no es objeto")
            mid = m.get("id")
            require(isinstance(mid, str) and mid and mid not in ids,
                    f"[{ds_id}] member.id inválido o duplicado: {mid}")
            ids.add(mid)
            if "body_mass_kg" in m:
                require(isinstance(m["body_mass_kg"], (int, float)) and 40 <= m["body_mass_kg"] <= 150,
                        f"[{ds_id}] member '{mid}' body_mass_kg fuera de [40, 150]")
            if "age_years" in m:
                require(isinstance(m["age_years"], (int, float)) and 20 <= m["age_years"] <= 70,
                        f"[{ds_id}] member '{mid}' age_years fuera de [20, 70]")
            if "sex" in m:
                require(m["sex"] in ("female", "male", "unspecified"),
                        f"[{ds_id}] member '{mid}' sex inválido")
            if "fitness_level" in m:
                require(m["fitness_level"] in ("nominal", "fit", "deconditioned"),
                        f"[{ds_id}] member '{mid}' fitness_level inválido")
    return True
def main() -> int:
    if not DATA_DIR.is_dir():
        print(f"ERROR: No existe el directorio {DATA_DIR}", file=sys.stderr)
        return 1

    datasets = sorted([d for d in DATA_DIR.iterdir() if d.is_dir() and not d.name.startswith(".")])
    if not datasets:
        print(f"ERROR: No se encontraron datasets en {DATA_DIR}", file=sys.stderr)
        return 1

    print(f"=== Validando contratos de datos en {DATA_DIR} ===")
    all_ok = True
    for ds_dir in datasets:
        ds_id = ds_dir.name
        try:
            has_health = validate_config_health_if_present(ds_dir, ds_id)
            meta = validate_metadata_and_f32(ds_dir, ds_id)
            validate_config_fisio(ds_dir, ds_id)
            has_route = validate_route_if_present(ds_dir, ds_id)
            n_pois = validate_poi_if_present(ds_dir, ds_id, meta)
            rows, cols = meta["shape"]
            w_m, d_m = meta["size_m"]
            print(
                f"  [OK] {ds_id}: DEM {cols}×{rows} ({w_m:.0f}×{d_m:.0f} m, {meta['resolution_m']} m/px) · "
                f"config_fisio OK · POIs={n_pois} · route.json={'OK' if has_route else 'dinámico'}"
            )
        except Exception as exc:
            all_ok = False
            print(f"  [ERROR] {ds_id}: {exc}", file=sys.stderr)

    if not all_ok:
        return 1
    print("=== Todos los contratos (4.1, 4.2, 4.3, 4.4) validados correctamente ===")
    print(f"  [OK] {ds_id}: DEM {cols}×{rows} ({w_m:.0f}×{d_m:.0f} m, {meta['resolution_m']} m/px) · "
                f"config_fisio OK · POIs={n_pois} · route.json={'OK' if has_route else 'dinámico'} · "
                f"health_override={'OK' if has_health else 'defaults'}"
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())