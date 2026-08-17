#!/usr/bin/env python3
import argparse
import os
import sys
import json
import numpy as np
import random


_BASE_URL = "https://raw.githubusercontent.com/LAION-AI/CLIP-based-NSFW-Detector/main"

# Backbone e cabeça de classificação precisam casar em dimensão, então uma
# variante amarra o par — deixar os dois configuráveis em separado permitiria
# combinações inválidas.
#
# Os pesos `openai` do CLIP foram treinados com QuickGELU. O open_clip 3.x monta
# o "ViT-B-32" com GELU comum e avisa `QuickGELU mismatch`: os embeddings saem
# errados e a cabeça do LAION, treinada em embeddings corretos, erra junto.
# `b32-legacy` preserva esse comportamento só para servir de linha de base na
# comparação feita por tools/nsfw_eval.js.
VARIANTS = {
    "b32": {
        "clip": "ViT-B-32-quickgelu",
        "head": "clip_autokeras_nsfw_b32",
        "dim": 512,
    },
    "l14": {
        "clip": "ViT-L-14-quickgelu",
        "head": "clip_autokeras_binary_nsfw",
        "dim": 768,
    },
    "b32-legacy": {
        "clip": "ViT-B-32",
        "head": "clip_autokeras_nsfw_b32",
        "dim": 512,
    },
}

DEFAULT_VARIANT = os.environ.get("LAION_VARIANT", "b32")


def resolve_variant(name):
    key = (name or DEFAULT_VARIANT).strip()
    if key not in VARIANTS:
        raise ValueError(f"Variante desconhecida: {key}. Use uma de: {', '.join(VARIANTS)}")
    return key, VARIANTS[key]


def download_with_retry(url, dest, attempts=5):
    """Baixa com backoff. O raw.githubusercontent.com devolve 429 com facilidade,
    e sem retry um limite de taxa passageiro inutiliza a variante inteira no
    primeiro uso. Escreve em arquivo temporário para um download interrompido não
    deixar um zip truncado no cache.
    """
    import time
    from urllib.error import HTTPError, URLError
    from urllib.request import urlretrieve

    tmp_dest = f"{dest}.part"
    for attempt in range(1, attempts + 1):
        try:
            urlretrieve(url, tmp_dest)
            os.replace(tmp_dest, dest)
            return dest
        except (HTTPError, URLError, OSError) as err:
            try:
                os.unlink(tmp_dest)
            except OSError:
                pass
            if attempt == attempts:
                raise
            delay = min(60, 2 ** attempt)
            print(
                f"[laion] falha ao baixar {os.path.basename(url)} ({err}); "
                f"nova tentativa em {delay}s ({attempt}/{attempts - 1})",
                file=sys.stderr,
            )
            time.sleep(delay)


def load_laion_safety_model(variant):
    os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")
    import autokeras as ak
    import tensorflow as tf
    import zipfile

    try:
        tf.config.set_visible_devices([], "GPU")
    except Exception:
        pass

    head = variant["head"]
    dim = variant["dim"]

    # O zip extrai numa pasta com o nome da própria cabeça, e as cabeças das
    # variantes têm nomes distintos — então elas já não colidem no mesmo cache.
    cache_folder = os.path.expanduser("~/.cache/laion_nsfw")
    os.makedirs(cache_folder, exist_ok=True)

    model_dir = os.path.join(cache_folder, head)
    url_model = f"{_BASE_URL}/{head}.zip"

    if not os.path.exists(model_dir):
        zip_path = os.path.join(cache_folder, os.path.basename(url_model))

        # Um zip truncado ou vazio no cache travaria a variante para sempre, já
        # que a existência do arquivo é o que dispensa o download.
        if os.path.exists(zip_path) and not zipfile.is_zipfile(zip_path):
            print(f"[laion] {os.path.basename(zip_path)} corrompido no cache; baixando de novo", file=sys.stderr)
            os.unlink(zip_path)

        if not os.path.exists(zip_path):
            download_with_retry(url_model, zip_path)

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


_LOADED = None


def load_models(device="cpu", variant_name=None):
    """Carrega CLIP + safety model uma única vez por processo.

    No modo --serve isto roda no start e o custo (~90s, >1GB) é pago uma vez
    para todas as imagens, em vez de uma vez por imagem.
    """
    global _LOADED
    if _LOADED is not None:
        return _LOADED

    variant_key, variant = resolve_variant(variant_name)

    import torch
    import open_clip

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
        variant["clip"],
        pretrained="openai",
        device=device,
    )
    model.eval()

    safety_model, dim = load_laion_safety_model(variant)

    print(
        f"[laion] variante={variant_key} clip={variant['clip']} dim={dim}",
        file=sys.stderr,
    )

    _LOADED = (model, preprocess, safety_model, dim, device)
    return _LOADED


def laion_score(image_path, device="cpu", variant_name=None):
    import torch
    from PIL import Image

    model, preprocess, safety_model, dim, device = load_models(device, variant_name)

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


def emit(payload):
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def serve(device="cpu", variant_name=None):
    """Modo daemon: uma requisição JSON por linha no stdin, uma resposta por linha
    no stdout. Consumido por services/analyzer/LaionClient.js.

    Entrada:  {"id": <qualquer>, "path": "/caminho/da/imagem"}
    Saída:    {"id": ..., "score": 0.87} ou {"id": ..., "error": "..."}
    """
    try:
        load_models(device, variant_name)
    except Exception as err:  # falha no carregamento é fatal: o cliente reinicia
        emit({"ready": False, "error": f"{type(err).__name__}: {err}"})
        return 1

    variant_key, _ = resolve_variant(variant_name)
    emit({"ready": True, "variant": variant_key})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            image_path = request.get("path")
            if not image_path:
                raise ValueError("campo 'path' ausente")
            emit({
                "id": request_id,
                "score": laion_score(image_path, device=device, variant_name=variant_name)
            })
        except Exception as err:
            emit({"id": request_id, "error": f"{type(err).__name__}: {err}"})

    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image")
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--device", default="cpu")
    parser.add_argument(
        "--variant",
        default=DEFAULT_VARIANT,
        choices=sorted(VARIANTS),
        help="par backbone CLIP + cabeça de classificação a usar",
    )
    args = parser.parse_args()

    if args.serve:
        return serve(device=args.device, variant_name=args.variant)

    if not args.image:
        parser.error("--image é obrigatório fora do modo --serve")

    score = laion_score(args.image, device=args.device, variant_name=args.variant)
    print(json.dumps({"score": score, "variant": args.variant}))
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
