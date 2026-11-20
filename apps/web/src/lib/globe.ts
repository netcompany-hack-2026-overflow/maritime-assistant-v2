import type { GlobeMethods } from "react-globe.gl";

/**
 * Zoom limits for both globes, as camera altitude above the surface in globe radii.
 * 0.6 is about 3,800 km up: a whole sea (e.g. the Mediterranean) with readable coastlines;
 * closer than that the dotted land turns into big blobs. 2.0 keeps the whole globe filling
 * about three quarters of a wide view. On a narrow (portrait) view the limit is raised just
 * enough for the whole globe to fit across.
 */
export const GLOBE_MIN_ALTITUDE = 0.6;
export const GLOBE_MAX_ALTITUDE = 2.0;

/** Starting view: the Mediterranean and the Middle East, where most of the demo fleet sails. */
const HOME = { lat: 24, lng: 25, altitude: 1.8 };

/** Altitude at which the whole globe fits the narrower side of the view, with a small margin. */
function fitAltitude(globe: GlobeMethods, width: number, height: number): number {
  const vHalf = ((globe.camera() as { fov?: number }).fov ?? 50) * (Math.PI / 360);
  const hHalf = Math.atan(Math.tan(vHalf) * (width / Math.max(1, height)));
  return 1 / Math.sin(Math.min(vHalf, hHalf) * 0.92) - 1;
}

function maxAltitude(globe: GlobeMethods, width: number, height: number): number {
  return Math.max(GLOBE_MAX_ALTITUDE, fitAltitude(globe, width, height));
}

/** The starting view for a view of this size: the whole globe visible. */
export function globeHomeView(globe: GlobeMethods, width: number, height: number) {
  return { lat: HOME.lat, lng: HOME.lng, altitude: Math.max(HOME.altitude, fitAltitude(globe, width, height)) };
}

/** The globe never turns by itself, and zooms only between the two limits. Call again when the view resizes. */
export function setupGlobeControls(globe: GlobeMethods, width: number, height: number) {
  const controls = globe.controls();
  controls.autoRotate = false;
  const radius = globe.getGlobeRadius();
  controls.minDistance = radius * (1 + GLOBE_MIN_ALTITUDE);
  controls.maxDistance = radius * (1 + maxAltitude(globe, width, height));
}
