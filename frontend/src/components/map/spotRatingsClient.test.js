import { mapSpotRatingsResponse } from './spotRatingsClient';
import { RATING_COLOR, RATING_LABEL } from './surfRating';

describe('mapSpotRatingsResponse', () => {
  it('maps a rated spot to the glyph shape, keyed by spot_id', () => {
    const out = mapSpotRatingsResponse([
      { spot_id: 'uuid-a', score: 72.4, level: 'good', confidence: 'high', why: 'clean 12s' },
    ]);
    expect(out['uuid-a']).toEqual({
      score: 72,                       // rounded
      level: 'good',
      color: RATING_COLOR['good'],
      label: RATING_LABEL['good'],
      confidence: 'high',
      why: 'clean 12s',
      source: 'endpoint',
    });
  });

  it('skips unrated spots (null score) — they fall back to a plain pin', () => {
    const out = mapSpotRatingsResponse([
      { spot_id: 'rated', score: 30, level: 'poor' },
      { spot_id: 'flat', score: null, level: 'unknown' },
      { spot_id: 'missing', level: 'fair' },           // no score field
    ]);
    expect(out.rated).toBeDefined();
    expect(out.flat).toBeUndefined();
    expect(out.missing).toBeUndefined();
  });

  it('skips entries without a spot_id and tolerates bad input', () => {
    expect(mapSpotRatingsResponse([{ score: 50, level: 'fair' }])).toEqual({});
    expect(mapSpotRatingsResponse(null)).toEqual({});
    expect(mapSpotRatingsResponse(undefined)).toEqual({});
    expect(mapSpotRatingsResponse('nope')).toEqual({});
  });

  it('defaults level to unknown and confidence to low when absent', () => {
    const out = mapSpotRatingsResponse([{ spot_id: 'x', score: 10 }]);
    expect(out.x.level).toBe('unknown');
    expect(out.x.confidence).toBe('low');
  });
});
