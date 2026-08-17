# Setup

## One-click startup on Windows

Use [`run dashboard.bat`](../run%20dashboard.bat) as the normal launcher. It checks Node.js, Python, Corepack, pnpm, and workspace dependencies, then:

1. creates `services/tts/.venv` when needed;
2. installs Chatterbox, PyTorch, FastAPI, and Uvicorn once;
3. starts the local Chatterbox sidecar on `127.0.0.1:8890`;
4. waits for the model to finish loading;
5. starts the dashboard only after audio is ready.

The first startup can take several minutes and uses substantial disk space because PyTorch and the Chatterbox model are downloaded. Later startups reuse the ignored virtual environment and cached model. If installation or model loading fails, the launcher stops with a readable error and points to `.documentary-studio/logs/tts.stderr.log` instead of opening a dashboard that cannot generate audio.

The current Chatterbox package requires Python 3.10 or newer and is tested upstream on Python 3.11. The launcher prefers Python 3.11, then 3.10, then 3.13. If no suitable Python is installed, it attempts to install Python 3.11 through winget.

## Manual development startup

For frontend/backend development without the managed audio bootstrap:

```text
pnpm install
pnpm dev
```

To prepare and run audio manually instead:

```text
python -m venv services/tts/.venv
services/tts/.venv/Scripts/python -m pip install -r services/tts/requirements.txt
cd services/tts
.venv/Scripts/python -m uvicorn app:app --host 127.0.0.1 --port 8890
```

Check `http://127.0.0.1:8890/health`. It returns ready only after the model is loaded. The Node server talks to this service over loopback HTTP; it never imports Python packages directly.

Audio settings are available in Settings. The service URL, Chatterbox controls, and optional per-channel WAV voice reference are stored locally. Voice references and generated WAV files stay in the selected content storage folder, which is ignored by Git.

On the first launch, the dashboard asks for a local content storage folder. It creates `channels/`, `.documentary-studio/tasks/`, `.documentary-studio/codex/`, and `.documentary-studio/logs/` inside that folder. The code, templates, and shared rules remain in the Git project.

The selected folder is saved locally in `.documentary-studio/storage.local.json`, which is ignored by Git. Change it later from Settings → Storage folder. Existing content is not moved automatically when switching folders. To use a different code project root, set `STUDIO_ROOT` before starting the server. To enable extra structured diagnostics, set `STUDIO_DEBUG=1`.
