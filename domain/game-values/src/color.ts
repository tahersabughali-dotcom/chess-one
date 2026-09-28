export const COLORS = ["white", "black"] as const;

export type Color = (typeof COLORS)[number];

export function oppositeColor(color: Color): Color {
  return color === "white" ? "black" : "white";
}
