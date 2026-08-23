import math
import os
import struct
import wave

SAMPLE_RATE = 48000

def create_wav(filepath: str, samples: list[float]):
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with wave.open(filepath, 'w') as wav_file:
        wav_file.setnchannels(1)  # Mono
        wav_file.setsampwidth(2)  # 16-bit
        wav_file.setframerate(SAMPLE_RATE)
        
        # Normalize and convert to 16-bit integer
        max_val = max(max(abs(s) for s in samples), 0.0001)
        scaling = 0.95 / max_val
        
        packed = bytearray()
        for sample in samples:
            val = max(-1.0, min(1.0, sample * scaling))
            int_val = int(val * 32767.0)
            packed.extend(struct.pack('<h', int_val))
        wav_file.writeframes(packed)
    print(f"Generated {filepath} ({len(samples)/SAMPLE_RATE:.2f}s)")

def generate_ui_pop():
    # 0.12s quick pop 950Hz -> 200Hz
    duration = 0.12
    num_samples = int(duration * SAMPLE_RATE)
    samples = []
    phase = 0.0
    for i in range(num_samples):
        t = i / SAMPLE_RATE
        freq = 200.0 + 750.0 * math.exp(-38.0 * t)
        phase += 2.0 * math.pi * freq / SAMPLE_RATE
        env = (t / 0.003) if t < 0.003 else math.exp(-32.0 * (t - 0.003))
        val = (math.sin(phase) + 0.35 * math.sin(2.0 * phase)) * env
        samples.append(val)
    return samples

def generate_bubble_splash():
    # 0.65s multi-bubble chirp + whoosh
    duration = 0.65
    num_samples = int(duration * SAMPLE_RATE)
    samples = [0.0] * num_samples
    
    bubbles = [
        (0.00, 320.0, 900.0, 0.14),
        (0.09, 450.0, 1150.0, 0.13),
        (0.18, 380.0, 1050.0, 0.16),
        (0.28, 520.0, 1300.0, 0.12),
    ]
    for start_t, start_f, end_f, b_dur in bubbles:
        start_idx = int(start_t * SAMPLE_RATE)
        b_samples = int(b_dur * SAMPLE_RATE)
        phase = 0.0
        for i in range(b_samples):
            idx = start_idx + i
            if idx >= num_samples:
                break
            t = i / SAMPLE_RATE
            progress = t / b_dur
            freq = start_f + (end_f - start_f) * (progress ** 1.5)
            phase += 2.0 * math.pi * freq / SAMPLE_RATE
            env = math.sin(math.pi * progress) ** 1.2
            samples[idx] += math.sin(phase) * env * 0.7
            
    import random
    rng = random.Random(42)
    for i in range(num_samples):
        t = i / SAMPLE_RATE
        whoosh_env = math.exp(-((t - 0.25) / 0.15) ** 2)
        noise = (rng.random() * 2.0 - 1.0) * whoosh_env * 0.15
        samples[i] += noise
        
    return samples

def generate_lightning_brush():
    # 0.7s energetic saw sweep + electrical zap
    duration = 0.70
    num_samples = int(duration * SAMPLE_RATE)
    samples = []
    phase = 0.0
    import random
    rng = random.Random(1337)
    for i in range(num_samples):
        t = i / SAMPLE_RATE
        if t < 0.25:
            freq = 200.0 + 1600.0 * (t / 0.25)
        else:
            freq = 1800.0 * math.exp(-6.0 * (t - 0.25))
        phase += 2.0 * math.pi * freq / SAMPLE_RATE
        saw = 2.0 * (phase / (2.0 * math.pi) - math.floor(phase / (2.0 * math.pi) + 0.5))
        sine = math.sin(phase)
        env = (t / 0.04) if t < 0.04 else math.exp(-6.5 * (t - 0.04))
        crackle = (rng.random() * 2.0 - 1.0) * 0.2 * env if rng.random() > 0.6 else 0.0
        val = (0.5 * saw + 0.5 * sine + crackle) * env
        samples.append(val)
    return samples

def generate_countdown_tick():
    # 0.08s wooden block click / marimba tick
    duration = 0.08
    num_samples = int(duration * SAMPLE_RATE)
    samples = []
    phase1 = 0.0
    phase2 = 0.0
    freq1 = 1350.0
    freq2 = 2700.0
    for i in range(num_samples):
        t = i / SAMPLE_RATE
        phase1 += 2.0 * math.pi * freq1 / SAMPLE_RATE
        phase2 += 2.0 * math.pi * freq2 / SAMPLE_RATE
        env = (t / 0.002) if t < 0.002 else math.exp(-55.0 * (t - 0.002))
        val = (math.sin(phase1) + 0.4 * math.sin(phase2)) * env
        samples.append(val)
    return samples

def generate_countdown_final():
    # 0.35s urgent dual-tone arcade beep
    duration = 0.35
    num_samples = int(duration * SAMPLE_RATE)
    samples = []
    phase1 = 0.0
    phase2 = 0.0
    for i in range(num_samples):
        t = i / SAMPLE_RATE
        f1 = 980.0 + 30.0 * math.sin(2.0 * math.pi * 14.0 * t)
        f2 = 1470.0 + 45.0 * math.sin(2.0 * math.pi * 14.0 * t)
        phase1 += 2.0 * math.pi * f1 / SAMPLE_RATE
        phase2 += 2.0 * math.pi * f2 / SAMPLE_RATE
        env = (t / 0.01) if t < 0.01 else math.exp(-9.0 * (t - 0.01))
        val = (0.6 * math.sin(phase1) + 0.4 * math.sin(phase2)) * env
        samples.append(val)
    return samples

def generate_correct_ding():
    # 1.1s C6 - E6 - G6 chime chord
    duration = 1.10
    num_samples = int(duration * SAMPLE_RATE)
    samples = [0.0] * num_samples
    notes = [
        (0.00, 1046.5),  # C6
        (0.06, 1318.5),  # E6
        (0.12, 1567.98), # G6
    ]
    for start_t, freq in notes:
        start_idx = int(start_t * SAMPLE_RATE)
        rem_samples = num_samples - start_idx
        phase = 0.0
        for i in range(rem_samples):
            idx = start_idx + i
            t = i / SAMPLE_RATE
            phase += 2.0 * math.pi * freq / SAMPLE_RATE
            env = (t / 0.006) if t < 0.006 else math.exp(-4.2 * (t - 0.006))
            h2 = math.sin(2.0 * phase) * 0.3
            h3 = math.sin(3.0 * phase) * 0.15
            h4 = math.sin(4.0 * phase) * 0.08
            bell = (math.sin(phase) + h2 + h3 + h4) * env
            samples[idx] += bell * 0.65
    return samples

def generate_correct_triumph():
    # 1.5s C6 - E6 - G6 - C7 fanfare chord
    duration = 1.50
    num_samples = int(duration * SAMPLE_RATE)
    samples = [0.0] * num_samples
    notes = [
        (0.00, 1046.5),   # C6
        (0.07, 1318.5),   # E6
        (0.14, 1567.98),  # G6
        (0.22, 2093.0),   # C7
    ]
    for start_t, freq in notes:
        start_idx = int(start_t * SAMPLE_RATE)
        rem_samples = num_samples - start_idx
        phase = 0.0
        for i in range(rem_samples):
            idx = start_idx + i
            t = i / SAMPLE_RATE
            phase += 2.0 * math.pi * freq / SAMPLE_RATE
            env = (t / 0.008) if t < 0.008 else math.exp(-3.2 * (t - 0.008))
            h2 = math.sin(2.0 * phase) * 0.35
            h3 = math.sin(3.0 * phase) * 0.15
            bell = (math.sin(phase) + h2 + h3) * env
            samples[idx] += bell * 0.55
    return samples

def generate_streak():
    # 1.2s rising coin arpeggio
    duration = 1.20
    num_samples = int(duration * SAMPLE_RATE)
    samples = [0.0] * num_samples
    arpeggio = [
        (0.00, 1174.66), # D6
        (0.05, 1479.98), # F#6
        (0.10, 1760.00), # A6
        (0.16, 2349.32), # D7
    ]
    for start_t, freq in arpeggio:
        start_idx = int(start_t * SAMPLE_RATE)
        rem_samples = num_samples - start_idx
        phase = 0.0
        for i in range(rem_samples):
            idx = start_idx + i
            t = i / SAMPLE_RATE
            phase += 2.0 * math.pi * freq / SAMPLE_RATE
            env = (t / 0.004) if t < 0.004 else math.exp(-4.5 * (t - 0.004))
            samples[idx] += (math.sin(phase) + 0.25 * math.sin(2.0 * phase)) * env * 0.6
    return samples

def main():
    dest_dirs = [
        os.path.join("templates", "sfx"),
        os.path.join("assets", "audio", "sfx"),
    ]
    
    generators = {
        "ui_pop.wav": generate_ui_pop,
        "bubble_splash.wav": generate_bubble_splash,
        "lightning_brush.wav": generate_lightning_brush,
        "countdown_tick.wav": generate_countdown_tick,
        "countdown_final.wav": generate_countdown_final,
        "correct_ding.wav": generate_correct_ding,
        "correct_triumph.wav": generate_correct_triumph,
        "streak.wav": generate_streak,
    }
    
    for filename, gen_func in generators.items():
        data = gen_func()
        for d in dest_dirs:
            filepath = os.path.join(d, filename)
            create_wav(filepath, data)

    print("All SFX assets successfully generated!")

if __name__ == "__main__":
    main()
