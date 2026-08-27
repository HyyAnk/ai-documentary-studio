from __future__ import annotations

import io
import logging
import math
import os
import re
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
    target_duration_seconds: Optional[float] = Field(default=None, ge=10.0, le=7_200.0)


DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
MODEL: Optional[object] = None
MODEL_ERROR: Optional[str] = None
# Turbo is the production default because narration scripts can contain native
# [chuckle]/[laugh] cues. Keep the environment override for troubleshooting or
# compatibility, but never silently fall back to the cue-less model by default.
MODEL_KIND = "turbo" if os.getenv("CHATTERBOX_MODEL", "turbo").strip().lower() == "turbo" else "original"
MODEL_SUPPORTS_PARALINGUISTICS = MODEL_KIND == "turbo"

def patch_chatterbox_float32():
    try:
        import numpy as np

        # 1. Patch T3Cond to ensure all float tensors are converted to torch.float32
        try:
            from chatterbox.models.t3.modules.cond_enc import T3Cond
            def safe_t3cond_to(self, *, device=None, dtype=None):
                for k, v in self.__dict__.items():
                    if torch.is_tensor(v):
                        is_fp = v.dtype in (torch.float16, torch.float32, torch.float64, torch.bfloat16)
                        target_dtype = dtype if dtype is not None else (torch.float32 if is_fp else None)
                        setattr(self, k, v.to(device=device, dtype=target_dtype if is_fp else None))
                return self
            T3Cond.to = safe_t3cond_to
        except Exception as exc:
            logger.warning("Could not patch T3Cond: %s", exc)

        # 2. Patch Conditionals container
        def safe_cond_to(self, device):
            if hasattr(self, "t3") and self.t3 is not None:
                self.t3 = self.t3.to(device=device)
            if hasattr(self, "gen") and isinstance(self.gen, dict):
                for k, v in self.gen.items():
                    if torch.is_tensor(v):
                        is_fp = v.dtype in (torch.float16, torch.float32, torch.float64, torch.bfloat16)
                        self.gen[k] = v.to(device=device, dtype=torch.float32 if is_fp else None)
            return self

        try:
            from chatterbox.tts import Conditionals as TTSConditionals
            TTSConditionals.to = safe_cond_to
        except Exception:
            pass
        try:
            from chatterbox.tts_turbo import Conditionals as TurboConditionals
            TurboConditionals.to = safe_cond_to
        except Exception:
            pass

        # 3. Patch VoiceEncoder forward, inference, and embeds_from_mels to enforce float32
        try:
            from chatterbox.models.voice_encoder.voice_encoder import VoiceEncoder

            orig_ve_forward = VoiceEncoder.forward
            def safe_ve_forward(self, mels: torch.FloatTensor):
                if torch.is_tensor(mels):
                    mels = mels.to(device=self.device, dtype=torch.float32)
                return orig_ve_forward(self, mels)
            VoiceEncoder.forward = safe_ve_forward

            orig_ve_inference = VoiceEncoder.inference
            def safe_ve_inference(self, mels: torch.Tensor, mel_lens, overlap=0.5, rate: float = None, min_coverage=0.8, batch_size=None):
                if torch.is_tensor(mels):
                    mels = mels.to(dtype=torch.float32)
                return orig_ve_inference(self, mels, mel_lens, overlap=overlap, rate=rate, min_coverage=min_coverage, batch_size=batch_size)
            VoiceEncoder.inference = safe_ve_inference

            orig_ve_embeds_from_mels = VoiceEncoder.embeds_from_mels
            def safe_embeds_from_mels(self, mels, mel_lens=None, as_spk=False, batch_size=32, **kwargs):
                if isinstance(mels, list):
                    mels = [np.asarray(m, dtype=np.float32) for m in mels]
                elif torch.is_tensor(mels):
                    mels = mels.to(dtype=torch.float32)
                return orig_ve_embeds_from_mels(self, mels, mel_lens=mel_lens, as_spk=as_spk, batch_size=batch_size, **kwargs)
            VoiceEncoder.embeds_from_mels = safe_embeds_from_mels
        except Exception as exc:
            logger.warning("Could not patch VoiceEncoder: %s", exc)

        # 4. Patch S3Tokenizer _prepare_audio and log_mel_spectrogram to normalize spectrogram tensors
        try:
            from chatterbox.models.s3tokenizer.s3tokenizer import S3Tokenizer

            def safe_prepare_audio(self, wavs):
                processed_wavs = []
                for wav in wavs:
                    if isinstance(wav, np.ndarray):
                        wav = torch.from_numpy(wav.astype(np.float32)).float()
                    elif torch.is_tensor(wav):
                        wav = wav.to(dtype=torch.float32)
                    if wav.dim() == 1:
                        wav = wav.unsqueeze(0)
                    processed_wavs.append(wav.to(dtype=torch.float32))
                return processed_wavs
            S3Tokenizer._prepare_audio = safe_prepare_audio

            orig_log_mel = S3Tokenizer.log_mel_spectrogram
            def safe_log_mel_spectrogram(self, audio: torch.Tensor, padding: int = 0):
                if isinstance(audio, np.ndarray):
                    audio = torch.from_numpy(audio.astype(np.float32)).float()
                elif torch.is_tensor(audio):
                    audio = audio.to(dtype=torch.float32)
                if hasattr(self, "_mel_filters") and torch.is_tensor(self._mel_filters):
                    self._mel_filters = self._mel_filters.to(dtype=torch.float32)
                if hasattr(self, "window") and torch.is_tensor(self.window):
                    self.window = self.window.to(dtype=torch.float32)
                return orig_log_mel(self, audio, padding=padding).to(dtype=torch.float32)
            S3Tokenizer.log_mel_spectrogram = safe_log_mel_spectrogram
        except Exception as exc:
            logger.warning("Could not patch S3Tokenizer: %s", exc)

        # 5. Patch ChatterboxTTS and ChatterboxTurboTTS prepare_conditionals to synchronize conditional embeddings
        def _sanitize_conds(tts_instance):
            if hasattr(tts_instance, "conds") and tts_instance.conds is not None:
                if hasattr(tts_instance.conds, "t3") and tts_instance.conds.t3 is not None:
                    tts_instance.conds.t3 = tts_instance.conds.t3.to(device=tts_instance.device, dtype=torch.float32)
                if hasattr(tts_instance.conds, "gen") and isinstance(tts_instance.conds.gen, dict):
                    for k, v in tts_instance.conds.gen.items():
                        if torch.is_tensor(v):
                            is_fp = v.dtype in (torch.float16, torch.float32, torch.float64, torch.bfloat16)
                            tts_instance.conds.gen[k] = v.to(device=tts_instance.device, dtype=torch.float32 if is_fp else None)

        try:
            from chatterbox.tts import ChatterboxTTS
            orig_cb_prep = ChatterboxTTS.prepare_conditionals
            def safe_cb_prep(self, wav_fpath, exaggeration=0.5, **kwargs):
                orig_cb_prep(self, wav_fpath, exaggeration=exaggeration, **kwargs)
                _sanitize_conds(self)
            ChatterboxTTS.prepare_conditionals = safe_cb_prep
        except Exception as exc:
            logger.warning("Could not patch ChatterboxTTS: %s", exc)

        try:
            from chatterbox.tts_turbo import ChatterboxTurboTTS
            orig_turbo_prep = ChatterboxTurboTTS.prepare_conditionals
            def safe_turbo_prep(self, wav_fpath, exaggeration=0.5, norm_loudness=True, **kwargs):
                orig_turbo_prep(self, wav_fpath, exaggeration=exaggeration, norm_loudness=norm_loudness, **kwargs)
                _sanitize_conds(self)
            ChatterboxTurboTTS.prepare_conditionals = safe_turbo_prep
        except Exception as exc:
            logger.warning("Could not patch ChatterboxTurboTTS: %s", exc)

        logger.info("Chatterbox float32 / device patches applied successfully")
    except Exception as exc:
        logger.warning("Failed to apply chatterbox float32 patches: %s", exc)

patch_chatterbox_float32()

logger.info("Starting Chatterbox sidecar device=%s model=%s paralinguistic_tags=%s mode=local", DEVICE, MODEL_KIND, MODEL_SUPPORTS_PARALINGUISTICS, extra={"step": "startup"})
try:
    if MODEL_KIND == "turbo":
        from chatterbox.tts_turbo import ChatterboxTurboTTS
        MODEL = ChatterboxTurboTTS.from_pretrained(device=DEVICE)
    else:
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
        content={"status": "ok" if ready else "loading", "model_loaded": ready, "device": DEVICE, "model": MODEL_KIND, "paralinguistic_tags": MODEL_SUPPORTS_PARALINGUISTICS, "error": MODEL_ERROR},
    )


SYNTHESIS_LOCK = threading.Lock()
MERGE_LOCK = threading.Lock()


def prepare_text(text: str) -> str:
    if MODEL_SUPPORTS_PARALINGUISTICS:
        return text
    # The original and multilingual Chatterbox tokenizers do not support the
    # Turbo paralinguistic vocabulary. Remove cues instead of letting them be
    # read aloud as literal words.
    return re.sub(r"\s{2,}", " ", re.sub(r"\[(?:chuckle|laugh)\]", "", text, flags=re.IGNORECASE)).strip()


def synthesize(request: SynthesizeRequest) -> bytes:
    if MODEL is None:
        raise RuntimeError("Chatterbox model is not loaded")
    reference = request.voice_reference_path
    if reference in (None, "", "default"):
        reference = None
    with SYNTHESIS_LOCK:
        with torch.inference_mode():
            waveform = MODEL.generate(
                prepare_text(request.text),
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
        import traceback
        logger.error("Synthesis failed: %s\n%s", error, traceback.format_exc(), extra={"step": "synthesize"})
        raise HTTPException(status_code=503, detail=f"Audio service unavailable: {error}") from error
    logger.info("Generated WAV bytes=%s", len(audio), extra={"step": "synthesize"})
    return Response(content=audio, media_type="audio/wav", headers={"cache-control": "no-store"})


def merge_audio(paths: list[str], gap_ms: int, target_duration_seconds: Optional[float] = None) -> bytes:
    with MERGE_LOCK:
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
        if target_duration_seconds is not None:
            target_frames = round(sample_rate * target_duration_seconds)
            current_frames = merged.shape[1]
            rate = current_frames / max(1, target_frames)
            if not 0.72 <= rate <= 1.28:
                raise ValueError(f"Requested duration change is too large ({rate:.3f}x playback rate)")
            if abs(target_frames - current_frames) > sample_rate:
                n_fft = 1024
                hop_length = 256
                window = torch.hann_window(n_fft, device=merged.device)
                spectrum = torch.stft(merged, n_fft=n_fft, hop_length=hop_length, window=window, return_complex=True)
                phase_advance = torch.linspace(0, math.pi * hop_length, spectrum.shape[-2], device=merged.device)[..., None]
                stretched = torchaudio.functional.phase_vocoder(spectrum, rate=rate, phase_advance=phase_advance)
                merged = torch.istft(stretched, n_fft=n_fft, hop_length=hop_length, window=window, length=target_frames)
                peak = merged.abs().max()
                if peak > 0.99:
                    merged = merged * (0.99 / peak)
        output = io.BytesIO()
        torchaudio.save(output, merged.cpu(), sample_rate, format="wav")
        return output.getvalue()


@app.post("/merge")
async def merge_audio_files(request: MergeRequest) -> Response:
    if MODEL is None:
        raise HTTPException(status_code=503, detail="Audio service unavailable")
    try:
        audio = await __import__("asyncio").to_thread(merge_audio, request.paths, request.gap_ms, request.target_duration_seconds)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        logger.error("Merge failed: %s", error, extra={"step": "merge"})
        raise HTTPException(status_code=503, detail="Audio merge failed") from error
    logger.info("Merged WAV files=%s bytes=%s gap_ms=%s target_seconds=%s", len(request.paths), len(audio), request.gap_ms, request.target_duration_seconds, extra={"step": "merge"})
    return Response(content=audio, media_type="audio/wav", headers={"cache-control": "no-store"})
