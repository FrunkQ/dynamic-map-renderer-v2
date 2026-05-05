/**
 * Easing functions and animation helper used by transition definitions.
 */

export function linear(t: number): number { return t; }
export function easeIn(t: number): number { return t * t; }
export function easeOut(t: number): number { return t * (2 - t); }
export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

/**
 * Runs an animation loop for `duration` ms, calling `draw` each frame
 * with a 0→1 progress value passed through the optional easing function.
 * Resolves when the animation completes (progress reaches 1.0).
 */
export function animate(
  duration: number,
  draw: (t: number) => void,
  ease: (t: number) => number = easeInOut,
): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = () => {
      const raw = Math.min((performance.now() - start) / duration, 1.0);
      draw(ease(raw));
      if (raw < 1.0) {
        requestAnimationFrame(tick);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });
}
