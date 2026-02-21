export interface MouseTraceSegment {
  x: number[];
  y: number[];
  t: number[];
  velocity: number[];
  curvature: number[];
  meta?: {
    targetSize?: number;
    distance?: number;
    isClick?: boolean;
    resolution?: { width: number; height: number };
  };
}
