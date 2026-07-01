#!/usr/bin/env python3
"""Export a Keras PhysioAI motion model to TFJS with v3 manifest metadata."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path


TCN_PHASES = ["rest", "moving_to_target", "target", "returning"]
TCN_QUALITIES = ["good", "incomplete", "wrong_path", "unstable"]


def load_json(path: str | Path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def load_features(path: str | Path) -> dict:
    payload = load_json(path)
    if payload.get("schema") != "physioai.motion_features.v1":
        raise ValueError("Expected physioai.motion_features.v1 feature payload")
    if not payload.get("landmarkSchemaId"):
        raise ValueError("Feature payload is missing landmarkSchemaId")
    if not isinstance(payload.get("inputShape"), list) or len(payload["inputShape"]) != 2:
        raise ValueError("Feature payload is missing inputShape [window, feature]")
    return payload


def load_evaluation(path: str | Path | None) -> tuple[dict | None, dict | None]:
    if not path:
        return None, None
    payload = load_json(path)
    return payload.get("evaluation", payload), payload.get("approval")


def build_manifest(features: dict, evaluation: dict | None, approval: dict | None, version: str) -> dict:
    return {
        "name": "motion-tcn",
        "version": version,
        "modelPath": "./model.json",
        "landmarkSchemaId": features["landmarkSchemaId"],
        "bodyRegion": features.get("bodyRegion"),
        "modelInputLandmarks": features.get("modelInputLandmarks", []),
        "primaryRequiredLandmarks": features.get("primaryRequiredLandmarks", []),
        "stabilizerRequiredLandmarks": features.get("stabilizerRequiredLandmarks", []),
        "jointNames": features.get("jointNames", []),
        "inputShape": features["inputShape"],
        "phases": features.get("phases") or TCN_PHASES,
        "qualities": features.get("qualities") or TCN_QUALITIES,
        "evaluation": evaluation,
        "approval": approval,
        "approved": False,
        "modelFormat": "tfjs-layers-model",
    }


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, help=".keras model produced by train_motion_tcn_keras.py")
    parser.add_argument("--features", required=True, help="Feature JSON produced by npm run features:tcn")
    parser.add_argument("--evaluation", default=None, help="Evaluation JSON produced by npm run evaluate:tcn:keras")
    parser.add_argument("--out", required=True, help="Output TFJS model directory")
    parser.add_argument("--version", required=True, help="Manifest version/model id")
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main() -> None:
    args = build_arg_parser().parse_args()
    features = load_features(args.features)
    evaluation, approval = load_evaluation(args.evaluation)
    manifest = build_manifest(features, evaluation, approval, args.version)
    summary = {
        "ok": True,
        "model": args.model,
        "features": args.features,
        "evaluation": args.evaluation,
        "out": args.out,
        "version": args.version,
        "dryRun": args.dry_run,
        "manifest": manifest,
    }
    if args.dry_run:
        print(json.dumps(summary, indent=2))
        return

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["tensorflowjs_converter", "--input_format", "keras", args.model, str(out)],
        check=True,
    )
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    if evaluation is not None:
        (out / "evaluation.json").write_text(
            json.dumps({"evaluation": evaluation, "approval": approval}, indent=2) + "\n",
            encoding="utf-8",
        )
    print(json.dumps({**summary, "dryRun": False}, indent=2))


if __name__ == "__main__":
    main()
