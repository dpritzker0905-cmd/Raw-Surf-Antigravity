"""Offline surf-truth latent model (T1 P4 / anchors D), pre-registered in
docs/weather-program/log/2026-11-16-surf-truth-model-preregistration.md (#989, amendments 1-2 and their definitions).

Runs OFFLINE only (an Actions job or a laptop), never on Render. `prep` and `gate` need numpy only; `model` needs
NumPyro/JAX from backend/requirements-surf-truth-fit.txt, which no production or CI lane installs.
Nothing here serves a number: the output is truth FOR TESTING, never shown to observers, never fed back as data.
"""
