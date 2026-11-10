"""Export the punch CNN to web/punch_model.onnx and write a fixture that
check_pipeline.mjs uses to prove the JS pipeline matches the Python one.

Run from the repo root:  .venv\\Scripts\\python.exe web\\tools\\export_model.py
"""
import json
import os
import sys
import types

import numpy as np
import onnxruntime as ort
import torch

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WEB = os.path.join(ROOT, "web")
sys.path.insert(0, ROOT)

# Everything before the camera setup is constants, the pipeline and the model class.
src = open(os.path.join(ROOT, "main_python_analysis.py"), encoding="utf-8").read()
ns = {"__file__": os.path.join(ROOT, "main_python_analysis.py"), "__name__": "export"}
exec(src[:src.index("# ── Camera backend helpers")], ns)

model = ns["PerfectPunchCNN"](num_classes=ns["N_CLASSES"])
model.load_state_dict(torch.load(os.path.join(ROOT, "models", "best_punch_model.pt"), map_location="cpu"))
model.eval()

onnx_path = os.path.join(WEB, "punch_model.onnx")
dummy = torch.zeros(1, 7, ns["CLIP_FRAMES"], 4, 3)
torch.onnx.export(model, dummy, onnx_path, input_names=["input"], output_names=["logits"],
                  opset_version=17, dynamo=False)
sess = ort.InferenceSession(onnx_path)

# Synthetic world landmarks: a still pose plus one fast arm swing, 30 fps.
rng = np.random.default_rng(0)
base = rng.normal(0, 0.3, (33, 3))
raw = []
for t in range(90):
    f = base + rng.normal(0, 0.005, (33, 3))
    f[[13, 15]] += np.exp(-((t - 60) / 4.0) ** 2) * np.array([0.2, -0.1, -0.5])
    raw.append(np.concatenate([f, rng.uniform(0.5, 1, (33, 1))], axis=1))

frames = [ns["normalize_skeleton"]([types.SimpleNamespace(x=a, y=b, z=c, visibility=v) for a, b, c, v in r])
          for r in raw]
clip = ns["extract_live_clip"](frames, 30.0)
cases = {}
for name, c in (("plain", clip), ("mirrored", ns["mirror_skeleton"](clip))):
    tensor = ns["build_tensor"](c)
    with torch.no_grad():
        logits = model(torch.tensor(tensor).unsqueeze(0))[0].numpy()
    onnx_logits = sess.run(None, {"input": tensor[None]})[0][0]
    assert np.allclose(logits, onnx_logits, atol=1e-4), (logits, onnx_logits)
    cases[name] = {"tensor": tensor.ravel().tolist(), "logits": logits.tolist()}

with open(os.path.join(os.path.dirname(__file__), "fixture.json"), "w") as f:
    json.dump({"fps": 30.0, "raw": np.array(raw).tolist(), **cases}, f)
print(f"wrote {onnx_path} ({os.path.getsize(onnx_path) / 1e6:.1f} MB); ONNX logits match PyTorch")
