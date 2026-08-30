const HUE_START = 225;
const HUE_END = 145;

export function flowHue(index: number, total: number): number {
  if (total <= 1) {
    return HUE_START;
  }
  return HUE_START + ((HUE_END - HUE_START) * index) / (total - 1);
}
