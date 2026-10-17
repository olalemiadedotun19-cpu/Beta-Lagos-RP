import * as THREE from 'three';

/** A floating name above a remote player: a canvas drawn once, shown as a sprite that always faces the camera. */
export class NameTag {
  readonly sprite: THREE.Sprite;
  private readonly texture: THREE.CanvasTexture;
  private readonly material: THREE.SpriteMaterial;
  private readonly canvas: HTMLCanvasElement;
  private hp: number | null = null;

  /** the sprite is taller than the name alone (the health bar hangs below it): its middle sits this far (m) below the name's */
  static readonly DROP = 0.065;

  constructor(private readonly text: string, hp?: number) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 160;
    this.canvas = canvas;
    this.hp = hp === undefined ? null : NameTag.clampHp(hp);
    this.draw();
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false, fog: false });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.scale.set(1.5, 0.469, 1);
    this.sprite.renderOrder = 10;
    this.sprite.frustumCulled = false;
  }

  private static clampHp(v: number): number {
    return Math.max(0, Math.min(100, Math.round(v)));
  }

  /** sets the health shown in the bar under the name; only redraws when the number changed */
  setHealth(hp: number | undefined): void {
    const next = hp === undefined ? null : NameTag.clampHp(hp);
    if (next === this.hp) return;
    this.hp = next;
    this.draw();
    this.texture.needsUpdate = true;
  }

  private draw(): void {
    const canvas = this.canvas;
    const text = this.text;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const label = text.length > 24 ? `${text.slice(0, 23)}…` : text;
      ctx.font = '600 52px "Barlow Condensed", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const w = Math.min(500, ctx.measureText(label).width + 56);
      const x = (canvas.width - w) / 2;
      ctx.fillStyle = 'rgba(8, 12, 20, 0.62)';
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') ctx.roundRect(x, 8, w, 96, 48);
      else ctx.rect(x, 8, w, 96);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, canvas.width / 2, 58);

      // health: a red bar under the name, always (full when the player's version does not send health)
      {
        const bw = 300;
        const bh = 22;
        const bx = (canvas.width - bw) / 2;
        const by = 118;
        const f = (this.hp ?? 100) / 100;
        ctx.fillStyle = 'rgba(8, 12, 20, 0.7)';
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') ctx.roundRect(bx - 5, by - 5, bw + 10, bh + 10, 16);
        else ctx.rect(bx - 5, by - 5, bw + 10, bh + 10);
        ctx.fill();
        if (f > 0) {
          ctx.fillStyle = '#ff2d2d';
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') ctx.roundRect(bx, by, Math.max(bh, bw * f), bh, 11);
          else ctx.rect(bx, by, Math.max(bh, bw * f), bh);
          ctx.fill();
        }
      }
    }
  }

  dispose(): void {
    this.sprite.removeFromParent();
    this.texture.dispose();
    this.material.dispose();
  }
}
