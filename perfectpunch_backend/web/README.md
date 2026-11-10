# Perfect Punch Web Version

A browser-based boxing game using webcam input and real-time pose detection.

## Quick Start

### Local Development

From the project root:

```powershell
.venv\Scripts\python.exe -m http.server 8000 --directory web
```

Then open **http://localhost:8000** in your browser.

### Without Python

If you don't have the venv, use any static HTTP server:

```bash
# Node.js (if installed)
npx http-server web -p 8000

# Or use your preferred static server (nginx, Apache, etc.)
```

## Deployment

The web version is **completely static** — no server-side code needed. You can deploy it anywhere static hosting is available:

- **GitHub Pages** — push to `docs/` or use branch deployment
- **Netlify** — connect your repo, set build output to `web/`
- **Vercel** — same as Netlify
- **Any static host** — AWS S3, Cloudflare Pages, etc.

## Files

| File | Purpose |
|---|---|
| `index.html` | Entry point; UI and DOM setup |
| `game.js` | Main game loop (offense + defense) |
| `pipeline.js` | Pose processing (mirror, normalize, extract clips) |
| `punchDetector.js` | Punch classification (model inference) |
| `punch_model.onnx` | Neural network weights (ONNX format) |

## Dependencies

All dependencies are loaded from **CDN** (no npm install needed):

- **MediaPipe Vision** — pose detection
- **ONNX Runtime Web** — model inference
- **OpenCV.js** (optional) — image processing

Versions are pinned in `game.js` for stability.

## Notes

- **Webcam access requires HTTPS or localhost** (browser security policy)
- **Keep `punch_model.onnx` synced** with the Python model via `web/tools/export_model.py`
- All detection is **2D** (uses MediaPipe landmarks only)
