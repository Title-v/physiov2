#!/usr/bin/env python3
"""Train a Keras TCN-style motion classifier from JS-built PhysioAI features."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def load_features(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema") != "physioai.motion_features.v1":
        raise ValueError("Expected physioai.motion_features.v1 feature payload")
    if not payload.get("landmarkSchemaId"):
        raise ValueError("Feature payload is missing landmarkSchemaId")
    if not payload.get("samples"):
        raise ValueError("Feature payload has no samples")
    return payload


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--features", required=True, help="Path from scripts/build-motion-features.mjs")
    parser.add_argument("--out", default="training/artifacts/motion-tcn.keras")
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main() -> None:
    args = build_arg_parser().parse_args()
    payload = load_features(Path(args.features))
    summary = {
        "ok": True,
        "features": args.features,
        "out": args.out,
        "samples": len(payload["samples"]),
        "inputShape": payload["inputShape"],
        "landmarkSchemaId": payload["landmarkSchemaId"],
        "phases": payload["phases"],
        "qualities": payload["qualities"],
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
            "Keras training requires numpy and tensorflow in the training environment."
        ) from exc

    x = np.array([sample["window"] for sample in payload["samples"]], dtype="float32")
    y_phase = np.array([sample["phaseOneHot"] for sample in payload["samples"]], dtype="float32")
    y_quality = np.array([sample["qualityOneHot"] for sample in payload["samples"]], dtype="float32")

    inputs = tf.keras.Input(shape=tuple(payload["inputShape"]), name="motion_window")
    hidden = tf.keras.layers.Conv1D(48, 3, padding="causal", dilation_rate=1, activation="relu")(inputs)
    hidden = tf.keras.layers.Conv1D(48, 3, padding="causal", dilation_rate=2, activation="relu")(hidden)
    hidden = tf.keras.layers.GlobalAveragePooling1D()(hidden)
    phase = tf.keras.layers.Dense(len(payload["phases"]), activation="softmax", name="phase")(hidden)
    quality = tf.keras.layers.Dense(len(payload["qualities"]), activation="softmax", name="quality")(hidden)
    model = tf.keras.Model(inputs=inputs, outputs=[phase, quality], name="physioai_motion_tcn")
    model.compile(
        optimizer="adam",
        loss={"phase": "categorical_crossentropy", "quality": "categorical_crossentropy"},
        metrics={"phase": ["accuracy"], "quality": ["accuracy"]},
    )
    history = model.fit(
        x,
        {"phase": y_phase, "quality": y_quality},
        epochs=max(1, args.epochs),
        batch_size=max(1, args.batch_size),
        shuffle=True,
    )
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    model.save(out_path)
    summary["history"] = {key: [float(v) for v in values] for key, values in history.history.items()}
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
