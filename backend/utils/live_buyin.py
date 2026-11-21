def resolve_live_buyin(live_price: float | None, session_price: float | None = None) -> float:
    if live_price is not None:
        return live_price
    return session_price if session_price is not None else 25.0
