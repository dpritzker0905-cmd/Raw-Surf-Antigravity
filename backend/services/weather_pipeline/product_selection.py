import logging
from typing import List, Tuple, Optional, Any

logger = logging.getLogger(__name__)

def _split_bbox(w: float, s: float, e: float, n: float) -> List[Tuple[float, float, float, float]]:
    """
    Splits a bounding box into 1 or 2 standard boxes if it crosses the antimeridian.
    """
    if w <= e:
        return [(w, s, e, n)]
    else:
        # Box crosses antimeridian: left piece to 180, right piece from -180
        return [(w, s, 180.0, n), (-180.0, s, e, n)]

def _intersect_standard_boxes(b1: Tuple[float, float, float, float], b2: Tuple[float, float, float, float]) -> float:
    """
    Calculates intersection area of two standard (non-wrapping) boxes.
    """
    w1, s1, e1, n1 = b1
    w2, s2, e2, n2 = b2
    
    int_w = max(w1, w2)
    int_e = min(e1, e2)
    int_s = max(s1, s2)
    int_n = min(n1, n2)
    
    if int_w < int_e and int_s < int_n:
        return (int_e - int_w) * (int_n - int_s)
    return 0.0

def bbox_intersection_area(req_w: float, req_s: float, req_e: float, req_n: float, cov) -> float:
    """
    Calculates the geographical intersection area between a requested box and a coverage box,
    supporting antimeridian crossings in either or both.
    """
    req_boxes = _split_bbox(req_w, req_s, req_e, req_n)
    cov_boxes = _split_bbox(cov.west, cov.south, cov.east, cov.north)
    
    total_area = 0.0
    for r in req_boxes:
        for c in cov_boxes:
            total_area += _intersect_standard_boxes(r, c)
    return total_area

def get_bbox_area(west: float, south: float, east: float, north: float) -> float:
    """
    Calculates the total coverage area of a bounding box, supporting antimeridian crossing.
    """
    boxes = _split_bbox(west, south, east, north)
    area = 0.0
    for w, s, e, n in boxes:
        area += (e - w) * (n - s)
    return area

def _select_best_from_list(
    candidates: List[Tuple[Any, float]],
    req_w: Optional[float] = None,
    req_s: Optional[float] = None,
    req_e: Optional[float] = None,
    req_n: Optional[float] = None
) -> Optional[Any]:
    """
    Selects the best product from a single list of candidates.
    Matches by largest intersection area, breaking ties with smallest coverage area,
    and then with smallest time diff.
    """
    best_item = None
    best_diff = float("inf")
    best_intersection = -1.0
    
    for p, diff in candidates:
        if req_w is not None:
            # We have a requested bounding box
            intersection_area = bbox_intersection_area(req_w, req_s, req_e, req_n, p.coverage)
            if intersection_area > 0.0:
                if intersection_area > best_intersection + 0.0001:
                    best_intersection = intersection_area
                    best_diff = diff
                    best_item = p
                elif abs(intersection_area - best_intersection) < 0.0001:
                    # Tie in intersection area
                    cov_area = get_bbox_area(p.coverage.west, p.coverage.south, p.coverage.east, p.coverage.north)
                    best_cov_area = get_bbox_area(best_item.coverage.west, best_item.coverage.south, best_item.coverage.east, best_item.coverage.north)
                    if cov_area < best_cov_area - 0.0001:
                        best_intersection = intersection_area
                        best_diff = diff
                        best_item = p
                    elif abs(cov_area - best_cov_area) < 0.0001:
                        if diff < best_diff:
                            best_diff = diff
                            best_item = p
        else:
            # No bounding box requested, match purely on time difference
            if diff < best_diff:
                best_diff = diff
                best_item = p
                
    return best_item

def select_best_candidate(
    authoritative_candidates: List[Tuple[Any, float]],
    estimated_candidates: List[Tuple[Any, float]],
    req_w: Optional[float] = None,
    req_s: Optional[float] = None,
    req_e: Optional[float] = None,
    req_n: Optional[float] = None
) -> Optional[Any]:
    """
    Finds the best product from candidates.
    Strictly prioritizes authoritative candidates before estimated candidates.
    For global/wide queries, filters out non-global candidates if at least one global product exists.
    """
    # Identify wide/global requests (longitude span > 180 or latitude span > 90)
    is_global_request = False
    if req_w is not None and req_s is not None and req_e is not None and req_n is not None:
        if req_w <= req_e:
            lon_span = req_e - req_w
        else:
            lon_span = 360.0 - (req_w - req_e)
        lat_span = req_n - req_s
        if lon_span > 180.0 or lat_span > 90.0:
            is_global_request = True

    if is_global_request:
        # Check if there is at least one global product in either list.
        # A global product is one with coverage longitude span >= 350.0.
        def is_global_product(p: Any) -> bool:
            if not hasattr(p, "coverage") or p.coverage is None:
                return False
            west = getattr(p.coverage, "west", None)
            east = getattr(p.coverage, "east", None)
            if west is None or east is None:
                return False
            if west <= east:
                span = east - west
            else:
                span = 360.0 - (west - east)
            return span >= 350.0

        has_global = any(is_global_product(p) for p, _ in authoritative_candidates) or \
                     any(is_global_product(p) for p, _ in estimated_candidates)
        
        if has_global:
            authoritative_candidates = [(p, diff) for p, diff in authoritative_candidates if is_global_product(p)]
            estimated_candidates = [(p, diff) for p, diff in estimated_candidates if is_global_product(p)]

    # Step 1: Find best from each category
    best_auth = _select_best_from_list(authoritative_candidates, req_w, req_s, req_e, req_n)
    best_est = _select_best_from_list(estimated_candidates, req_w, req_s, req_e, req_n)

    if best_auth and best_est:
        # Find the time diffs for each winner
        auth_diff = min(diff for p, diff in authoritative_candidates if p is best_auth)
        est_diff = min(diff for p, diff in estimated_candidates if p is best_est)
        # If estimated is a near-exact match (<=30 min) AND auth is significantly farther (>30 min),
        # prefer the estimated product. This prevents stale overlapping auth products from
        # overshadowing correct estimated products.
        if est_diff <= 1800 and auth_diff > 1800:
            return best_est
        # Otherwise, prefer authoritative as usual
        return best_auth
    if best_auth:
        return best_auth
    return best_est
