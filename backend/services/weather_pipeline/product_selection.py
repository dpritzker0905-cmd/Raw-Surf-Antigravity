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
    """
    best_item = _select_best_from_list(authoritative_candidates, req_w, req_s, req_e, req_n)
    if best_item:
        return best_item
    return _select_best_from_list(estimated_candidates, req_w, req_s, req_e, req_n)
