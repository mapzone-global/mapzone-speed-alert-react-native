import polyline from '@mapbox/polyline';
import type { LocationFix } from '@mapzone/speed-alert';

type Point = { lat: number; lng: number };

const EARTH_RADIUS_METERS = 6371000;
const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;
const radiansToDegrees = (radians: number) => (radians * 180) / Math.PI;

function haversineMeters(from: Point, to: Point): number {
  const latitudeDeltaRadians = degreesToRadians(to.lat - from.lat);
  const longitudeDeltaRadians = degreesToRadians(to.lng - from.lng);
  const halfChordSquared =
    Math.sin(latitudeDeltaRadians / 2) ** 2 +
    Math.cos(degreesToRadians(from.lat)) *
      Math.cos(degreesToRadians(to.lat)) *
      Math.sin(longitudeDeltaRadians / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(halfChordSquared));
}

function bearingDegrees(from: Point, to: Point): number {
  const longitudeDeltaRadians = degreesToRadians(to.lng - from.lng);
  const eastComponent = Math.sin(longitudeDeltaRadians) * Math.cos(degreesToRadians(to.lat));
  const northComponent =
    Math.cos(degreesToRadians(from.lat)) * Math.sin(degreesToRadians(to.lat)) -
    Math.sin(degreesToRadians(from.lat)) *
      Math.cos(degreesToRadians(to.lat)) *
      Math.cos(longitudeDeltaRadians);
  return (radiansToDegrees(Math.atan2(eastComponent, northComponent)) + 360) % 360;
}

/**
 * Drives a fake vehicle along an encoded track at a constant speed and emits
 * one `LocationFix` per second, the same cadence a real GPS would give. The
 * zone engine needs no route: the track only decides where the fixes go.
 *
 *   polyline ──decode──► [p0..pn] ──advance v·Δt along segments──► fix @ 1 Hz
 */
export class TrackSimulator {
  private readonly points: Point[];
  private segmentIndex = 0;
  private segmentOffsetMeters = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    encodedPolyline: string,
    private readonly onFix: (fix: LocationFix) => void,
    private readonly onEnd: () => void
  ) {
    this.points = polyline.decode(encodedPolyline, 6).map(([lat, lng]) => ({ lat, lng }));
  }

  /** Vehicle speed in km/h; may be changed while running. */
  speedKmh = 60;

  get running() {
    return this.timer !== null;
  }

  start() {
    if (this.timer || this.points.length < 2) return;
    this.timer = setInterval(() => this.tick(1000), 1000);
    this.tick(0); // Emit the start position immediately.
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Back to the first point; keeps the speed setting. */
  reset() {
    this.stop();
    this.segmentIndex = 0;
    this.segmentOffsetMeters = 0;
  }

  private tick(elapsedMillis: number) {
    let remainingMeters = (this.speedKmh / 3.6) * (elapsedMillis / 1000);
    while (remainingMeters > 0 && this.segmentIndex < this.points.length - 1) {
      const segmentLengthMeters = haversineMeters(
        this.points[this.segmentIndex],
        this.points[this.segmentIndex + 1]
      );
      const leftInSegmentMeters = segmentLengthMeters - this.segmentOffsetMeters;
      if (remainingMeters < leftInSegmentMeters) {
        this.segmentOffsetMeters += remainingMeters;
        remainingMeters = 0;
      } else {
        remainingMeters -= leftInSegmentMeters;
        this.segmentIndex += 1;
        this.segmentOffsetMeters = 0;
      }
    }

    const isAtEnd = this.segmentIndex >= this.points.length - 1;
    const segmentStart = this.points[Math.min(this.segmentIndex, this.points.length - 2)];
    const segmentEnd = this.points[Math.min(this.segmentIndex + 1, this.points.length - 1)];
    const segmentLengthMeters = haversineMeters(segmentStart, segmentEnd);
    const fractionAlongSegment = isAtEnd
      ? 1
      : segmentLengthMeters === 0
        ? 0
        : this.segmentOffsetMeters / segmentLengthMeters;

    this.onFix({
      lat: segmentStart.lat + (segmentEnd.lat - segmentStart.lat) * fractionAlongSegment,
      lng: segmentStart.lng + (segmentEnd.lng - segmentStart.lng) * fractionAlongSegment,
      bearing: bearingDegrees(segmentStart, segmentEnd),
      speedKmh: isAtEnd ? 0 : this.speedKmh,
      accuracy: 5,
      fixTimeMillis: Date.now(),
    });

    if (isAtEnd) {
      this.stop();
      this.onEnd();
    }
  }
}
