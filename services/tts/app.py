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


class MergeRequest(BaseModel):
    paths: list[str] = Field(min_length=1, max_length=128)
    gap_ms: int = Field(default=300, ge=0, le=10_000)


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


def merge_audio(paths: list[str], gap_ms: int) -> bytes:
    waveforms = []
    sample_rate: Optional[int] = None
    channels: Optional[int] = None
    for path in paths:
        if not os.path.isabs(path) or not os.path.isfile(path):
            raise ValueError("Audio file does not exist")
        waveform, current_rate = torchaudio.load(path)
        if sample_rate is None:
            sample_rate = current_rate
            channels = waveform.shape[0]
        elif current_rate != sample_rate:
            waveform = torchaudio.functional.resample(waveform, current_rate, sample_rate)
        if channels is not None and waveform.shape[0] != channels:
            if waveform.shape[0] == 1:
                waveform = waveform.repeat(channels, 1)
            elif channels == 1:
                waveform = waveform.mean(dim=0, keepdim=True)
            else:
                waveform = waveform.mean(dim=0, keepdim=True).repeat(channels, 1)
        waveforms.append(waveform)
    if not waveforms or sample_rate is None:
        raise ValueError("At least one audio file is required")
    gap_frames = round(sample_rate * gap_ms / 1000)
    pieces = []
    for index, waveform in enumerate(waveforms):
        if index > 0 and gap_frames > 0:
            pieces.append(torch.zeros((waveform.shape[0], gap_frames), dtype=waveform.dtype))
        pieces.append(waveform)
    merged = torch.cat(pieces, dim=1)
    output = io.BytesIO()
    torchaudio.save(output, merged.cpu(), sample_rate, format="wav")
    return output.getvalue()


@app.post("/merge")
async def merge_audio_files(request: MergeRequest) -> Response:
    if MODEL is None:
        raise HTTPException(status_code=503, detail="Audio service unavailable")
    try:
        audio = await __import__("asyncio").to_thread(merge_audio, request.paths, request.gap_ms)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        logger.error("Merge failed: %s", error, extra={"step": "merge"})
        raise HTTPException(status_code=503, detail="Audio merge failed") from error
    logger.info("Merged WAV files=%s bytes=%s gap_ms=%s", len(request.paths), len(audio), request.gap_ms, extra={"step": "merge"})
    return Response(content=audio, media_type="audio/wav", headers={"cache-control": "no-store"})
