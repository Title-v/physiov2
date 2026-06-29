#!/usr/bin/env python3
"""Evaluate a saved Keras PhysioAI motion model against JS-built features."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def load_features(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema") != "physioai.motion_features.v1":
        raise ValueError("Expected physioai.motion_features.v1 feature payload")
    if not payload.get("samples"):
        raise ValueError("Feature payload has no samples")
    return payload


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, help=".keras model produced by train_motion_tcn_keras.py")
    parser.add_argument("--features", required=True, help="Feature JSON produced by scripts/build-motion-features.mjs")
    parser.add_argument("--out", default="training/artifacts/evaluation.json")
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main() -> None:
    args = build_arg_parser().parse_args()
    payload = load_features(Path(args.features))
    summary = {
        "ok": True,
        "model": args.model,
        "features": args.features,
        "samples": len(payload["samples"]),
        "inputShape": payload["inputShape"],
        "landmarkSchemaId": payload.get("landmarkSchemaId"),
        "dryRun": args.dry_run,
    }
    if args.dry_run:
        print(json.dumps(summary, indent=2))
        return

    try:
        import numpy as np
        import tensorflow as tf
    except Exception as exc:  # pragma: no cover - depends on training env
        raise RuntimeError(
            "Keras evaluation requires numpy and tensorflow in the training environment."
        ) from exc

    model = tf.keras.models.load_model(args.model)
    x = np.array([sample["window"] for sample in payload["samples"]], dtype="float32")
    y_phase = np.array([sample["phaseOneHot"] for sample in payload["samples"]], dtype="float32")
    y_quality = np.array([sample["qualityOneHot"] for sample in payload["samples"]], dtype="float32")
    values = model.evaluate(x, {"phase": y_phase, "quality": y_quality}, verbose=0, return_dict=True)
    summary["metrics"] = {key: float(value) for key, value in values.items()}
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
