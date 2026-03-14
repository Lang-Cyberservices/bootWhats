#!/usr/bin/env python3
import argparse
import os
import json
import numpy as np
import random


def load_laion_safety_model():
    os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")
    import autokeras as ak
    import tensorflow as tf
    import zipfile
    from urllib.request import urlretrieve

    try:
        tf.config.set_visible_devices([], "GPU")
    except Exception:
        pass

    cache_folder = os.path.expanduser("~/.cache/laion_nsfw")
    os.makedirs(cache_folder, exist_ok=True)

    model_dir = os.path.join(cache_folder, "clip_autokeras_nsfw_b32")
    dim = 512
    url_model = "https://raw.githubusercontent.com/LAION-AI/CLIP-based-NSFW-Detector/main/clip_autokeras_nsfw_b32.zip"

    if not os.path.exists(model_dir):
        zip_path = os.path.join(cache_folder, os.path.basename(url_model))
        if not os.path.exists(zip_path):
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
        input_kwargs = None
        if sig.structured_input_signature and sig.structured_input_signature[1]:
            input_kwargs = sig.structured_input_signature[1]
        input_name = next(iter(input_kwargs.keys())) if input_kwargs else None
        input_dtype = input_kwargs[input_name].dtype if input_kwargs else tf.float32

        def predict(x_np):
            x_np = np.asarray(x_np)
            x_tf = tf.constant(x_np, dtype=input_dtype)
            if input_name:
                y = sig(**{input_name: x_tf})[out_key]
            else:
                y = sig(x_tf)[out_key]
            return y.numpy()

        return predict

    try:
        from tensorflow.keras.models import load_model
        model = load_model(model_dir, custom_objects=ak.CUSTOM_OBJECTS)
        return model, dim
    except Exception:
        predict_fn = load_savedmodel_predictor(model_dir)

        class SavedModelWrapper:
            def __init__(self, fn):
                self._fn = fn

            def predict(self, x, batch_size=None):
                return self._fn(x)

        return SavedModelWrapper(predict_fn), dim


def laion_score(image_path, device="cpu"):
    import torch
    import open_clip
    from PIL import Image

    os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")
    os.environ.setdefault("TF_DETERMINISTIC_OPS", "1")
    os.environ.setdefault("PYTHONHASHSEED", "0")

    random.seed(0)
    np.random.seed(0)
    torch.manual_seed(0)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(0)
    try:
        torch.use_deterministic_algorithms(True)
    except Exception:
        pass

    # Force CPU for reproducibility in VPS environments.
    device = "cpu"

    model, _, preprocess = open_clip.create_model_and_transforms(
        "ViT-B-32",
        pretrained="openai",
        device=device,
    )
    model.eval()

    safety_model, dim = load_laion_safety_model()

    img = Image.open(image_path).convert("RGB")
    with torch.no_grad():
        image_input = preprocess(img).unsqueeze(0).to(device)
        image_features = model.encode_image(image_input)
        image_features = image_features / image_features.norm(dim=-1, keepdim=True)
        emb = image_features.cpu().numpy().astype("float32")
        if emb.shape[1] != dim:
            raise ValueError(f"Embedding dim mismatch: got {emb.shape[1]} expected {dim}")
        pred = safety_model.predict(emb, batch_size=1).reshape(-1)[0]
    return float(pred)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--device", default="cpu")
    args = parser.parse_args()
    score = laion_score(args.image, device=args.device)
    print(json.dumps({"score": score}))


if __name__ == "__main__":
    main()
