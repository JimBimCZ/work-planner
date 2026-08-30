const HUE_START = 225;
const HUE_END = 145;

export function flowHue(index: number, total: number): number {
  if (total <= 1) {
    return HUE_START;
  }
  return HUE_START + ((HUE_END - HUE_START) * index) / (total - 1);
}

// The spectrum's saturation and lightness are fixed; only hue carries meaning.
// One definition so the board, the proof sheet and the wash cannot drift apart.
const SATURATION = 60;
const LIGHTNESS = 45;

export function flowColor(hue: number, alpha = 1): string {
  const base = `${hue} ${SATURATION}% ${LIGHTNESS}%`;
  return alpha === 1 ? `hsl(${base})` : `hsl(${base} / ${alpha})`;
}
