/**
 * Circle area calculator (Self-healed by M.I.K.E.)
 */
export function calculateCircleArea(radius: number): number {
  if (radius < 0) {
    throw new Error("Radius cannot be negative");
  }
  return Math.PI * radius * radius;
}
