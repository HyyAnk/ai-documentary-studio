from __future__ import annotations

import io
import logging
import os
import threading
from typing import Optional

import torch
import torchaudio
from chatterbox.tts import ChatterboxTTS
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field


class StructuredFormatter(logging.Formatter):
    colors = {
        "INFO": "\033[36m",
        "WARNING": "\033[33m",
        "ERROR": "\033[1;31m",
    }

    def format(self, record: logging.LogRecord) -> str:
        timestamp = self.formatTime(record, "%H:%M:%S")
        color = self.colors.get(record.levelname, "")
        reset = "\033[0m" if color else ""
        return f"\033[2m{timestamp}\033[0m {color}[{record.levelname}]{reset} [T:{threading.get_ident()}] [STEP:{getattr(record, 'step', 'runtime')}] {record.getMessage()}"


logger = logging.getLogger("documentary-tts")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(StructuredFormatter())
    logger.addHandler(handler)
logger.setLevel(logging.INFO)
logger.propagate = False


class SynthesizeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=50_000)
    voice_reference_path: Optional[str] = None
    exaggeration: float = Field(default=0.5, ge=0.0, le=1.0)
    cfg_weight: float = Field(default=0.5, ge=0.0, le=1.0)


DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
MODEL: Optional[ChatterboxTTS] = None
MODEL_ERROR: Optional[str] = None

logger.info("Starting Chatterbox sidecar device=%s model=ChatterboxTTS mode=local", DEVICE, extra={"step": "startup"})
try:
    MODEL = ChatterboxTTS.from_pretrained(device=DEVICE)
    logger.info("Chatterbox model loaded", extra={"step": "load_model"})
except Exception as error:  # pragma: no cover - depends on local model and hardware
    MODEL_ERROR = str(error)
    logger.error("Chatterbox model unavailable: %s", MODEL_ERROR, extra={"step": "load_model"})

app = FastAPI(title="Documentary Studio TTS", docs_url=None, redoc_url=None)


@app.get("/health")
async def health() -> JSONResponse:
    ready = MODEL is not None
    return JSONResponse(
        status_code=200 if ready else 503,
        content={"status": "ok" if ready else "loading", "model_loaded": ready, "device": DEVICE, "error": MODEL_ERROR},
    )


def synthesize(request: SynthesizeRequest) -> bytes:
    if MODEL is None:
        raise RuntimeError("Chatterbox model is not loaded")
    reference = request.voice_reference_path
    if reference in (None, "", "default"):
        reference = None
    with torch.inference_mode():
        waveform = MODEL.generate(
            request.text,
            audio_prompt_path=reference,
            exaggeration=request.exaggeration,
            cfg_weight=request.cfg_weight,
        )
    output = io.BytesIO()
    torchaudio.save(output, waveform.detach().cpu(), MODEL.sr, format="wav")
    return output.getvalue()


@app.post("/synthesize")
async def synthesize_audio(request: SynthesizeRequest) -> Response:
    if MODEL is None:
        raise HTTPException(status_code=503, detail="Audio service unavailable")
    try:
        audio = await __import__("asyncio").to_thread(synthesize, request)
    except Exception as error:
        logger.error("Synthesis failed: %s", error, extra={"step": "synthesize"})
        raise HTTPException(status_code=503, detail="Audio service unavailable") from error
    logger.info("Generated WAV bytes=%s", len(audio), extra={"step": "synthesize"})
    return Response(content=audio, media_type="audio/wav", headers={"cache-control": "no-store"})
