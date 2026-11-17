declare module "searoute-js" {
  type PointFeature = {
    type: "Feature";
    properties: Record<string, unknown>;
    geometry: { type: "Point"; coordinates: [number, number] };
  };
  type LineFeature = {
    type: "Feature";
    properties: { length: number; units: string };
    geometry: { type: "LineString"; coordinates: [number, number][] };
  };
  export default function searoute(
    origin: PointFeature,
    destination: PointFeature,
    units?: string
  ): LineFeature | null;
}
