"""Feedback-driven reward-profile helpers for lightweight adaptive tuning."""

from typing import Any, Dict, Mapping


DEFAULT_REWARD_WEIGHTS: Dict[str, float] = {
    "relevance": 1.0,
    "coverage": 1.0,
    "authority": 1.0,
    "evidenceDensity": 1.0,
    "diversity": 1.0,
    "structure": 1.0,
    "coherence": 1.0,
    "titleSpecificity": 1.0,
    "antiRedundancy": 1.0,
}


def clamp_reward_weight(value: Any) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        numeric = 1.0
    return max(0.82, min(1.35, numeric))


def normalize_reward_profile(reward_profile: Mapping[str, Any] | None) -> Dict[str, Any]:
    if not isinstance(reward_profile, Mapping):
        reward_profile = {}

    raw_weights = reward_profile.get("weights")
    if not isinstance(raw_weights, Mapping):
        raw_weights = {}

    weights = {
        key: clamp_reward_weight(raw_weights.get(key, default))
        for key, default in DEFAULT_REWARD_WEIGHTS.items()
    }
    dominant_issues = reward_profile.get("dominantIssues")
    if not isinstance(dominant_issues, list):
        dominant_issues = []

    return {
        "sampleSize": int(reward_profile.get("sampleSize", 0) or 0),
        "positiveSignals": int(reward_profile.get("positiveSignals", 0) or 0),
        "negativeSignals": int(reward_profile.get("negativeSignals", 0) or 0),
        "dominantIssues": [str(issue) for issue in dominant_issues[:3] if issue],
        "weights": weights,
        "updatedAt": reward_profile.get("updatedAt"),
    }


def reward_weight(reward_profile: Mapping[str, Any] | None, key: str) -> float:
    normalized_profile = normalize_reward_profile(reward_profile)
    return float(normalized_profile["weights"].get(key, 1.0))
