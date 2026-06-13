import { useSnappedCoordinates, calculateHaversineDistance } from '../hooks/useSnappedCoordinates';

jest.mock('react', () => ({
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
}));

describe('useSnappedCoordinates & Haversine Snapping logic (Pure JS Tests)', () => {
  const mockSpots = [
    { name: 'Spot A', latitude: 45.0, longitude: -120.0 },
    { name: 'Spot B', latitude: 45.0, longitude: -121.0 },
    { name: 'Spot Wrap West', latitude: 0.0, longitude: -179.9 },
    { name: 'Spot Wrap East', latitude: 0.0, longitude: 179.9 },
  ];

  test('calculateHaversineDistance correctly calculates distances', () => {
    // Distance between (45.0, -120.0) and (45.0, -121.0)
    const dist = calculateHaversineDistance(45.0, -120.0, 45.0, -121.0);
    // Approximately 78.6 km
    expect(dist).toBeCloseTo(78.6, 0);
  });

  test('calculateHaversineDistance is robust against NaN for antipodal coordinates', () => {
    // Antipodal points (exact opposite sides of earth): (90, 0) and (-90, 0)
    // Mathematically, a = 1.
    // Float rounding can push it past 1, returning NaN if not clamped.
    const dist = calculateHaversineDistance(90, 0, -90, 0);
    expect(isNaN(dist)).toBe(false);
    expect(dist).toBeCloseTo(20015, -1); // Half circumference of Earth
  });

  test('snaps to nearest spot using accurate geographic distance', () => {
    const { snappedCoordinates } = useSnappedCoordinates({
      surfSpots: mockSpots,
      userLocation: { lat: 45.0, lng: -120.1 }, // Closer to Spot A than Spot B
    });

    expect(snappedCoordinates.name).toBe('Spot A');
    expect(snappedCoordinates.source).toBe('gps_snapped');
  });

  test('resolves antimeridian wrapping correctly', () => {
    // Distance from -179.95 to 179.9 is only 0.15 degrees (wrapping across 180/-180)
    // Distance to -179.9 is 0.05 degrees.
    const { snappedCoordinates } = useSnappedCoordinates({
      surfSpots: mockSpots,
      userLocation: { lat: 0.0, lng: -179.95 },
    });

    expect(snappedCoordinates.name).toBe('Spot Wrap West');

    const { snappedCoordinates: snappedCoordinatesEast } = useSnappedCoordinates({
      surfSpots: mockSpots,
      userLocation: { lat: 0.0, lng: 179.95 },
    });

    expect(snappedCoordinatesEast.name).toBe('Spot Wrap East');
  });

  test('correctly accounts for latitude cosine distortion', () => {
    // At latitude 60 degrees, cos(60) = 0.5.
    // 1 degree longitude difference is physically half of 1 degree latitude difference.
    // Spot Latitude offset: Spot 1 is at (60, 0)
    // Spot 2 is at (60.9, 0) [0.9 degrees latitude away]
    // Spot 3 is at (60.0, 1.2) [1.2 degrees longitude away]
    // Physically, Spot 3 is closer:
    // Distance to Spot 2 = 0.9 degrees latitude ~ 100km
    // Distance to Spot 3 = 1.2 * cos(60) = 0.6 degrees longitude-equivalent ~ 66.7km
    // Euclidean distance in degrees (without cosine) would say Spot 2 is closer (0.9 < 1.2).
    // Haversine distance correctly identifies Spot 3 as closer.
    const spots = [
      { name: 'Spot Latitude Offset', latitude: 60.9, longitude: 0.0 },
      { name: 'Spot Longitude Offset', latitude: 60.0, longitude: 1.2 },
    ];

    const { snappedCoordinates } = useSnappedCoordinates({
      surfSpots: spots,
      userLocation: { lat: 60.0, lng: 0.0 },
    });

    expect(snappedCoordinates.name).toBe('Spot Longitude Offset');
  });

  test('returns null when all inputs are missing or invalid', () => {
    const { snappedCoordinates } = useSnappedCoordinates({
      surfSpots: mockSpots,
      userLocation: null,
    });

    expect(snappedCoordinates).toBeNull();
  });
});
