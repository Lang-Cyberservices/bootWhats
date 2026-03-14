#!/usr/bin/env python3
import argparse
import csv
import os
import sys
import json
import math
import time
from pathlib import Path

import numpy as np


def read_dataset(csv_path, image_root=None):
    rows = []
    with open(csv_path, "r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if "path" not in reader.fieldnames or "label" not in reader.fieldnames:
            raise ValueError("CSV must have columns: path,label")
        for row in reader:
            path = row["path"].strip()
            label_raw = row["label"].strip().lower()
            if label_raw in ("1", "nsfw", "unsafe", "true", "yes"):
                label = 1
            elif label_raw in ("0", "safe", "false", "no"):
                label = 0
            else:
                raise ValueError(f"Invalid label: {row['label']}")
            if image_root:
                path = str(Path(image_root) / path)
            rows.append((path, label))
    return rows


def metrics_from_scores(scores, labels, threshold):
    tp = fp = tn = fn = 0
    for s, y in zip(scores, labels):
        pred = 1 if s >= threshold else 0
        if pred == 1 and y == 1:
            tp += 1
        elif pred == 1 and y == 0:
            fp += 1
        elif pred == 0 and y == 0:
            tn += 1
        else:
            fn += 1
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
    acc = (tp + tn) / max(1, (tp + tn + fp + fn))
    fpr = fp / (fp + tn) if (fp + tn) else 0.0
    fnr = fn / (fn + tp) if (fn + tp) else 0.0
    return {
        "threshold": threshold,
        "accuracy": acc,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "fpr": fpr,
        "fnr": fnr,
        "tp": tp,
        "fp": fp,
        "tn": tn,
        "fn": fn,
    }


def load_laion_safety_model(clip_model):
    os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")
    import autokeras as ak
    import tensorflow as tf
    from urllib.request import urlretrieve
    import zipfile

    cache_folder = os.path.expanduser("~/.cache/laion_nsfw")
    os.makedirs(cache_folder, exist_ok=True)

    if clip_model == "ViT-L/14":
        model_dir = os.path.join(cache_folder, "clip_autokeras_binary_nsfw")
        dim = 768
        url_model = "https://raw.githubusercontent.com/LAION-AI/CLIP-based-NSFW-Detector/main/clip_autokeras_binary_nsfw.zip"
    elif clip_model == "ViT-B/32":
        model_dir = os.path.join(cache_folder, "clip_autokeras_nsfw_b32")
        dim = 512
        url_model = "https://raw.githubusercontent.com/LAION-AI/CLIP-based-NSFW-Detector/main/clip_autokeras_nsfw_b32.zip"
    else:
        raise ValueError("Unknown CLIP model. Use ViT-B/32 or ViT-L/14.")

    if not os.path.exists(model_dir):
        zip_path = os.path.join(cache_folder, os.path.basename(url_model))
        print(f"Downloading LAION NSFW model to {zip_path}...")
        urlretrieve(url_model, zip_path)
        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            zip_ref.extractall(cache_folder)

    def load_savedmodel_predictor(path):
        saved = tf.saved_model.load(path)
        sig = saved.signatures.get("serving_default")
        if sig is None:
            sig = next(iter(saved.signatures.values()))
        outputs = sig.structured_outputs
        if not outputs:
            raise ValueError("SavedModel has no outputs")
        out_key = next(iter(outputs.keys()))

        def predict(x_np):
            x_np = np.asarray(x_np)
            input_kwargs = None
            if sig.structured_input_signature and sig.structured_input_signature[1]:
                input_kwargs = sig.structured_input_signature[1]
            if input_kwargs:
                input_name = next(iter(input_kwargs.keys()))
                input_dtype = input_kwargs[input_name].dtype
                x_tf = tf.constant(x_np, dtype=input_dtype)
                y = sig(**{input_name: x_tf})[out_key]
            else:
                x_tf = tf.constant(x_np, dtype=tf.float32)
                y = sig(x_tf)[out_key]
            return y.numpy()

        return predict

    try:
        from tensorflow.keras.models import load_model

        model = load_model(model_dir, custom_objects=ak.CUSTOM_OBJECTS)
        # Warm-up
        model.predict(np.random.rand(1000, dim).astype("float32"), batch_size=1000)
        return model, dim
    except Exception:
        predict_fn = load_savedmodel_predictor(model_dir)
        # Warm-up
        _ = predict_fn(np.random.rand(1000, dim).astype("float32"))

        class SavedModelWrapper:
            def __init__(self, fn):
                self._fn = fn

            def predict(self, x, batch_size=None):
                return self._fn(x)

        return SavedModelWrapper(predict_fn), dim


def laion_scores(image_paths, clip_model="ViT-B/32", batch_size=16, device="cpu"):
    import torch
    import open_clip
    from PIL import Image

    model, _, preprocess = open_clip.create_model_and_transforms(
        clip_model.replace("/", "-"),
        pretrained="openai",
        device=device,
    )
    model.eval()

    safety_model, dim = load_laion_safety_model(clip_model)

    scores = []
    batch_imgs = []
    batch_paths = []

    def flush_batch():
        if not batch_imgs:
            return
        with torch.no_grad():
            image_input = torch.stack(batch_imgs).to(device)
            image_features = model.encode_image(image_input)
            image_features = image_features / image_features.norm(dim=-1, keepdim=True)
            emb = image_features.cpu().numpy().astype("float32")
            if emb.shape[1] != dim:
                raise ValueError(f"Embedding dim mismatch: got {emb.shape[1]} expected {dim}")
            preds = safety_model.predict(emb, batch_size=len(batch_imgs)).reshape(-1)
            scores.extend([float(p) for p in preds])
        batch_imgs.clear()
        batch_paths.clear()

    for p in image_paths:
        img = Image.open(p).convert("RGB")
        batch_imgs.append(preprocess(img))
        batch_paths.append(p)
        if len(batch_imgs) >= batch_size:
            flush_batch()
    flush_batch()

    return scores


def ensure_nudenet_model(model_type="320n"):
    import urllib.request
    import onnxruntime
    cache_dir = os.path.expanduser("~/.cache/nudenet")
    os.makedirs(cache_dir, exist_ok=True)
    if model_type == "320n":
        urls = [
            "https://huggingface.co/zhangsongbo365/nudenet_onnx/resolve/main/320n.onnx",
            "https://github.com/notAI-tech/NudeNet/releases/download/v3.4-weights/320n.onnx",
        ]
        filename = "320n.onnx"
    elif model_type == "640m":
        urls = [
            "https://huggingface.co/zhangsongbo365/nudenet_onnx/resolve/main/640m.onnx",
            "https://github.com/notAI-tech/NudeNet/releases/download/v3.4-weights/640m.onnx",
        ]
        filename = "640m.onnx"
    else:
        raise ValueError("Unknown NudeNet model type. Use 320n or 640m.")

    path = os.path.join(cache_dir, filename)

    def download():
        tmp_path = f"{path}.part"
        for url in urls:
            print(f"Downloading NudeNet model to {path}...")
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            try:
                urllib.request.urlretrieve(url, tmp_path)
                os.replace(tmp_path, path)
                if validate():
                    return
            except Exception:
                if os.path.exists(tmp_path):
                    try:
                        os.remove(tmp_path)
                    except OSError:
                        pass
                continue
        raise RuntimeError(f"Failed to download a valid NudeNet model to {path}")

    def validate():
        try:
            onnxruntime.InferenceSession(path)
            return True
        except Exception:
            return False

    if not os.path.exists(path):
        download()
    if not validate():
        # File likely truncated/corrupted; re-download once
        try:
            os.remove(path)
        except OSError:
            pass
        download()
        if not validate():
            raise RuntimeError(f"Downloaded NudeNet model is invalid: {path}")

    return path


def nudenet_scores(image_paths, model_type="320n", explicit_classes=None):
    from nudenet import NudeDetector

    model_path = ensure_nudenet_model(model_type)
    inference_resolution = 640 if model_type == "640m" else 320
    detector = NudeDetector(model_path=model_path, inference_resolution=inference_resolution)
    if explicit_classes is None:
        explicit_classes = {
            "EXPOSED_GENITALIA_F",
            "EXPOSED_GENITALIA_M",
            "EXPOSED_BREAST_F",
            "EXPOSED_BREAST_M",
            "EXPOSED_ANUS",
            "EXPOSED_BUTTOCKS",
        }

    scores = []
    for p in image_paths:
        detections = detector.detect(p)
        max_score = 0.0
        for det in detections:
            label = det.get("label") or det.get("class")
            score = det.get("score", 0.0)
            if label in explicit_classes and score > max_score:
                max_score = float(score)
        scores.append(max_score)
    return scores


def main():
    parser = argparse.ArgumentParser(description="A/B test LAION NSFW vs NudeNet on a labeled image set.")
    parser.add_argument("--csv", required=True, help="CSV with columns path,label")
    parser.add_argument("--image-root", default=None, help="Optional root folder for relative paths")
    parser.add_argument("--laion", action="store_true", help="Run LAION CLIP+NSFW detector")
    parser.add_argument("--nudenet", action="store_true", help="Run NudeNet detector")
    parser.add_argument("--clip-model", default="ViT-B/32", choices=["ViT-B/32", "ViT-L/14"])
    parser.add_argument("--laion-threshold", type=float, default=0.01)
    parser.add_argument("--nudenet-threshold", type=float, default=0.0)
    parser.add_argument("--nudenet-model", default="320n", choices=["320n", "640m"])
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--device", default="cpu", help="cpu or cuda")
    parser.add_argument("--out", default=None, help="Optional JSON output with per-image scores")

    args = parser.parse_args()
    if not args.laion and not args.nudenet:
        print("Select at least one model: --laion and/or --nudenet")
        return 1

    data = read_dataset(args.csv, args.image_root)
    image_paths = [p for p, _ in data]
    labels = [y for _, y in data]

    results = {}
    per_image = {"path": image_paths, "label": labels}

    if args.laion:
        print("Running LAION CLIP+NSFW detector...")
        laion = laion_scores(
            image_paths,
            clip_model=args.clip_model,
            batch_size=args.batch_size,
            device=args.device,
        )
        per_image["laion_score"] = laion
        results["laion"] = metrics_from_scores(laion, labels, args.laion_threshold)

    if args.nudenet:
        print("Running NudeNet detector...")
        nudes = nudenet_scores(image_paths, model_type=args.nudenet_model)
        per_image["nudenet_score"] = nudes
        results["nudenet"] = metrics_from_scores(nudes, labels, args.nudenet_threshold)

    print(json.dumps(results, indent=2))

    def print_per_image():
        print("\nPer-image results:")
        for i, path in enumerate(image_paths):
            label = labels[i]
            laion_score = per_image.get("laion_score", [None] * len(image_paths))[i]
            nudenet_score = per_image.get("nudenet_score", [None] * len(image_paths))[i]
            laion_pred = (
                "NSFW" if laion_score is not None and laion_score >= args.laion_threshold else "SAFE"
            )
            nudenet_pred = (
                "NSFW" if nudenet_score is not None and nudenet_score >= args.nudenet_threshold else "SAFE"
            )
            print(
                f"- {path} | label={label} | laion={laion_score:.4f} ({laion_pred}) | "
                f"nudenet={nudenet_score:.4f} ({nudenet_pred})"
            )

    print_per_image()

    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump({"results": results, "per_image": per_image}, f, indent=2)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
    try:
        tf.config.set_visible_devices([], "GPU")
    except Exception:
        pass
