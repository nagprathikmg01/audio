"""
behavior.py — Behavioral speech analysis module.
Extracts speech metrics: rate, pauses, filler words.
"""

import re
from dataclasses import dataclass, asdict

FILLER_WORDS = {
    "uh", "um", "like", "you know", "basically", "literally",
    "actually", "so", "well", "right", "okay", "i mean",
    "kind of", "sort of", "you see", "hmm", "er", "ah",
}


@dataclass
class SpeechMetrics:
    speech_rate: float       # words per second
    pause_count: int         # estimated pause count
    filler_count: int        # raw filler word count
    filler_ratio: float      # filler words / total words
    word_count: int
    duration_seconds: float
    behavior_score: float    # 0–1, higher = more scripted-looking


def analyze_behavior(transcript: str, duration_seconds: float) -> dict:
    """
    Analyze a transcript for behavioral signals that may indicate
    scripted or memorized delivery.

    Args:
        transcript: The full transcribed text.
        duration_seconds: How long the response took in seconds.

    Returns:
        Dictionary of SpeechMetrics fields.
    """
    if not transcript.strip() or duration_seconds <= 0:
        return asdict(
            SpeechMetrics(
                speech_rate=0.0,
                pause_count=0,
                filler_count=0,
                filler_ratio=0.0,
                word_count=0,
                duration_seconds=duration_seconds,
                behavior_score=0.0,
            )
        )

    # Normalize
    text_lower = transcript.lower()
    words = re.findall(r"\b\w+\b", text_lower)
    word_count = len(words)

    # --- Speech Rate ---
    speech_rate = word_count / duration_seconds if duration_seconds > 0 else 0.0

    # --- Pause Count ---
    # Estimate pauses from punctuation gaps, ellipses, repeated words
    pause_markers = re.findall(r"[,;\.]{1}|\.\.\.", transcript)
    pause_count = len(pause_markers)
    # Extra credit: extremely short words sequences between punctuation = pauses
    sentences = re.split(r"[.!?]+", transcript)
    pause_count += sum(1 for s in sentences if len(s.strip().split()) <= 2 and s.strip())

    # --- Filler Words ---
    filler_count = 0
    for filler in FILLER_WORDS:
        filler_count += len(re.findall(r"\b" + re.escape(filler) + r"\b", text_lower))
    filler_ratio = filler_count / max(word_count, 1)

    # --- Behavior Score (0–1, higher = more scripted) ---
    # Scripted delivery traits: high rate, zero fillers, few pauses
    rate_score = _normalize(speech_rate, low=1.0, high=4.5)
    filler_score = 1.0 - min(filler_ratio * 8.0, 1.0)    # 0 fillers → 1.0 (scripted)
    pause_score = 1.0 - _normalize(pause_count, low=0, high=15)  # 0 pauses → 1.0 (scripted)

    behavior_score = round(
        0.40 * rate_score + 0.35 * filler_score + 0.25 * pause_score, 4
    )

    return asdict(
        SpeechMetrics(
            speech_rate=round(speech_rate, 3),
            pause_count=pause_count,
            filler_count=filler_count,
            filler_ratio=round(filler_ratio, 4),
            word_count=word_count,
            duration_seconds=round(duration_seconds, 2),
            behavior_score=behavior_score,
        )
    )


def _normalize(value: float, low: float, high: float) -> float:
    """Clamp and normalize a value to [0, 1]."""
    if high == low:
        return 0.0
    return min(max((value - low) / (high - low), 0.0), 1.0)
