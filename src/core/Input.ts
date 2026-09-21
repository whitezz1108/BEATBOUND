/**
 * Keyboard state.
 *
 * Modes read an axis or ask whether a key was pressed *this frame*; they never
 * bind keys themselves. Press-edge detection matters for the rhythm modes: a
 * held key must not re-trigger every frame.
 */

import { ARENA_MOVE_KEYS, type AxisKeys } from './controls';

export class Input {
  private readonly down = new Set<string>();
  private readonly pressedThisFrame = new Set<string>();

  attach(target: Window | HTMLElement = window): () => void {
    const onDown = (e: Event) => {
      const event = e as KeyboardEvent;
      const k = event.key.toLowerCase();
      if (!event.repeat && !this.down.has(k)) this.pressedThisFrame.add(k);
      this.down.add(k);
      if (HANDLED_KEYS.has(k)) e.preventDefault();
    };
    const onUp = (e: Event) => this.down.delete((e as KeyboardEvent).key.toLowerCase());
    const onBlur = () => { this.down.clear(); this.pressedThisFrame.clear(); };
    target.addEventListener('keydown', onDown);
    target.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }

  isDown(...keys: string[]): boolean {
    return keys.some((k) => this.down.has(k));
  }

  /** True only on the frame a key went down. Cleared by endFrame(). */
  wasPressed(...keys: string[]): boolean {
    return keys.some((k) => this.pressedThisFrame.has(k));
  }

  /** Called by the game loop once every mode has read its input. */
  endFrame(): void {
    this.pressedThisFrame.clear();
  }

  /** -1 / 0 / +1 on each axis; y is positive downward to match field space. */
  axis(): { x: number; y: number } {
    return this.axisFrom(ARENA_MOVE_KEYS);
  }

  /**
   * The same axis read against a different binding.
   *
   * ARENA uses this to narrow movement to WASD while a rhythm encounter is
   * reading the arrow keys. Nothing is stored: the mode chooses a map per
   * frame, so the moment the encounter ends the full binding is back with no
   * state to unwind.
   */
  axisFrom(keys: AxisKeys): { x: number; y: number } {
    const x = (this.isDown(...keys.right) ? 1 : 0) - (this.isDown(...keys.left) ? 1 : 0);
    const y = (this.isDown(...keys.down) ? 1 : 0) - (this.isDown(...keys.up) ? 1 : 0);
    return { x, y };
  }
}

const HANDLED_KEYS = new Set([
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ',
  'w', 'a', 's', 'd', 'f', 'j', 'k', '1', '2', '3', '4',
]);
