import * as THREE from 'three';

/** what is drawn above a player's head when they speak: white letters with a black outline and shadow, bigger than the name tag */
const FONT = '700 64px "Barlow Condensed", system-ui, sans-serif';
const MAX_TEXT_WIDTH = 760;
const LINE_HEIGHT = 74;
const PAD = 22;
const MAX_LINES = 3;
/** canvas pixels per metre: 64 px letters come out about 0.27 m tall (the name tag's letters are about 0.15 m) */
const PX_PER_M = 240;
/** fade-out at the end of the life (s) */
const FADE = 0.8;

/** words are put on lines no wider than `maxWidth`; a word longer than a line is broken; more than MAX_LINES lines end in an ellipsis */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  const push = (): void => {
    if (line) lines.push(line);
    line = '';
  };
  for (const word of text.split(' ')) {
    let w = word;
    while (ctx.measureText(w).width > maxWidth) {
      // a single word wider than the bubble: break it where it fits
      let n = w.length;
      while (n > 1 && ctx.measureText(w.slice(0, n)).width > maxWidth) n--;
      push();
      lines.push(w.slice(0, n));
      w = w.slice(n);
    }
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= maxWidth) line = next;
    else {
      push();
      line = w;
    }
  }
  push();
  if (lines.length > MAX_LINES) {
    lines.length = MAX_LINES;
    let last = lines[MAX_LINES - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[MAX_LINES - 1] = `${last}…`;
  }
  return lines;
}

/** how long a bubble stays (s): longer messages take longer to read */
export const bubbleLife = (text: string): number => Math.min(10, 4.5 + text.length * 0.07);

/**
 * A speech bubble above a head: a canvas drawn once, shown as a sprite that always faces the camera.
 * `position` is the point just above the head: the bubble grows upward from it.
 */
export class ChatBubble {
  readonly sprite: THREE.Sprite;
  private readonly texture: THREE.CanvasTexture;
  private readonly material: THREE.SpriteMaterial;
  private readonly life: number;
  private age = 0;

  constructor(text: string) {
    this.life = bubbleLife(text);
    const canvas = document.createElement('canvas');
    const probe = document.createElement('canvas').getContext('2d');
    let lines = [text];
    let textW = 0;
    if (probe) {
      probe.font = FONT;
      lines = wrapLines(probe, text, MAX_TEXT_WIDTH);
      textW = Math.max(...lines.map((l) => probe.measureText(l).width));
    }
    canvas.width = Math.max(64, Math.ceil(textW + PAD * 2));
    canvas.height = lines.length * LINE_HEIGHT + PAD * 2;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.font = FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 14;
      ctx.strokeStyle = '#000000';
      ctx.fillStyle = '#ffffff';
      lines.forEach((l, i) => {
        const x = canvas.width / 2;
        const y = PAD + LINE_HEIGHT * i + LINE_HEIGHT / 2;
        // black border (with a soft black shadow), then the white letters on top
        ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 3;
        ctx.strokeText(l, x, y);
        ctx.shadowColor = 'transparent';
        ctx.fillText(l, x, y);
      });
    }
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.material = new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false, fog: false });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.center.set(0.5, 0); // the sprite's position is the middle of its bottom edge
    this.sprite.scale.set(canvas.width / PX_PER_M, canvas.height / PX_PER_M, 1);
    this.sprite.renderOrder = 11;
    this.sprite.frustumCulled = false;
  }

  /** ages the bubble; false once it has faded out completely (the owner then disposes it) */
  update(dt: number): boolean {
    this.age += dt;
    const left = this.life - this.age;
    this.material.opacity = Math.max(0, Math.min(1, left / FADE));
    return left > 0;
  }

  dispose(): void {
    this.sprite.removeFromParent();
    this.texture.dispose();
    this.material.dispose();
  }
}

/** the local player's own bubble: the same look, placed above the player's head from the engine's loop */
export class LocalChatBubble {
  private bubble: ChatBubble | null = null;

  constructor(private readonly scene: THREE.Scene) {}

  say(text: string): void {
    this.bubble?.dispose();
    this.bubble = new ChatBubble(text);
    this.scene.add(this.bubble.sprite);
  }

  /** (x, y, z) = the player's feet */
  update(dt: number, x: number, y: number, z: number): void {
    if (!this.bubble) return;
    if (!this.bubble.update(dt)) {
      this.bubble.dispose();
      this.bubble = null;
      return;
    }
    this.bubble.sprite.position.set(x, y + LOCAL_BUBBLE_HEIGHT, z);
  }

  dispose(): void {
    this.bubble?.dispose();
    this.bubble = null;
  }
}

/** height of the bottom of a bubble above the feet (m): the local player has no name tag, other players have one just below their bubble */
export const LOCAL_BUBBLE_HEIGHT = 2.2;
export const REMOTE_BUBBLE_HEIGHT = 2.4;
