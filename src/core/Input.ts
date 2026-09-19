/** Keyboard state. Modes read an axis; they never bind keys themselves. */
export class Input {
  private readonly down = new Set<string>();

  attach(target: Window | HTMLElement = window): () => void {
    const onDown = (e: Event) => {
      const k = (e as KeyboardEvent).key.toLowerCase();
      this.down.add(k);
      if (MOVEMENT_KEYS.has(k)) e.preventDefault();
    };
    const onUp = (e: Event) => this.down.delete((e as KeyboardEvent).key.toLowerCase());
    const onBlur = () => this.down.clear();
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

  /** -1 / 0 / +1 on each axis; y is positive downward to match field space. */
  axis(): { x: number; y: number } {
    const x = (this.isDown('arrowright', 'd') ? 1 : 0) - (this.isDown('arrowleft', 'a') ? 1 : 0);
    const y = (this.isDown('arrowdown', 's') ? 1 : 0) - (this.isDown('arrowup', 'w') ? 1 : 0);
    return { x, y };
  }
}

const MOVEMENT_KEYS = new Set(['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'w', 'a', 's', 'd']);
