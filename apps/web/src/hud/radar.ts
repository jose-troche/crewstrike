import { AAA_RADIUS, samRange, type Enemy, type GameState, type V3 } from '@crewstrike/game-core';
import type { PaletteColors } from './palette';

export const RADAR_RANGES = [10000, 20000, 40000] as const;

/** Round, heading-up, top-down radar drawn on a canvas. */
export class Radar {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  rangeIndex = 1;
  private size = 0;
  /** Last drawn mapping, for tap-to-target. */
  private map: { cx: number; cy: number; scale: number; heading: number; px: number; pz: number } | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
  }

  get range(): number {
    return RADAR_RANGES[this.rangeIndex] ?? 20000;
  }

  cycleRange(): void {
    this.rangeIndex = (this.rangeIndex + 1) % RADAR_RANGES.length;
  }

  private fit(): void {
    const css = this.canvas.clientWidth;
    const px = Math.round(css * Math.min(window.devicePixelRatio || 1, 2));
    if (px > 0 && px !== this.size) {
      this.size = px;
      this.canvas.width = px;
      this.canvas.height = px;
    }
  }

  /** World point to canvas point (heading-up). */
  private toCanvas(p: V3): [number, number] {
    const m = this.map!;
    const dx = p[0] - m.px;
    const dz = p[2] - m.pz;
    const c = Math.cos(-m.heading);
    const s = Math.sin(-m.heading);
    const rx = dx * c - dz * s;
    const rz = dx * s + dz * c;
    return [m.cx + rx * m.scale, m.cy + rz * m.scale];
  }

  /** Nearest air enemy to a tap on the radar, or null. */
  enemyAt(s: GameState, clientX: number, clientY: number): Enemy | null {
    if (!this.map) return null;
    const r = this.canvas.getBoundingClientRect();
    const k = this.size / Math.max(1, r.width);
    const x = (clientX - r.left) * k;
    const y = (clientY - r.top) * k;
    let best: Enemy | null = null;
    let bd = 30 * k;
    for (const e of s.enemies) {
      if (!e.alive || (e.kind !== 'fighter' && e.kind !== 'drone')) continue;
      const [ex, ey] = this.toCanvas(e.pos);
      const d = Math.hypot(ex - x, ey - y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  draw(s: GameState, col: PaletteColors): void {
    this.fit();
    const ctx = this.ctx;
    if (!ctx || this.size === 0) return;
    const W = this.size;
    const R = W / 2;
    const p = s.player;
    this.map = { cx: R, cy: R, scale: (R * 0.94) / this.range, heading: p.heading, px: p.pos[0], pz: p.pos[2] };
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(4, 14, 22, 0.55)';
    ctx.fillRect(0, 0, W, W);

    // Range rings.
    ctx.strokeStyle = 'rgba(150, 210, 255, 0.18)';
    ctx.lineWidth = Math.max(1, W / 200);
    for (const f of [0.33, 0.66]) {
      ctx.beginPath();
      ctx.arc(R, R, R * 0.94 * f, 0, Math.PI * 2);
      ctx.stroke();
    }
    const sc = this.map.scale;
    const lw = Math.max(1, W / 160);

    // Storm cells.
    for (const st of s.storms) {
      if (!st.active) continue;
      const [x, y] = this.toCanvas(st.pos);
      ctx.fillStyle = 'rgba(176, 123, 255, 0.25)';
      ctx.strokeStyle = col.purple;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(x, y, st.radius * sc, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Zones.
    const zone = (c: V3, r: number, color: string, fill: string): void => {
      const [x, y] = this.toCanvas(c);
      ctx.strokeStyle = color;
      ctx.fillStyle = fill;
      ctx.lineWidth = lw;
      ctx.setLineDash([W / 50, W / 70]);
      ctx.beginPath();
      ctx.arc(x, y, r * sc, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    };
    if (!s.training) {
      if (s.target.alive) zone(s.mission.strikeZone.center, s.mission.strikeZone.radius, col.magenta, 'rgba(255, 60, 240, 0.08)');
      zone(s.mission.exit.center, s.mission.exit.radius, col.green, 'rgba(61, 255, 138, 0.1)');
    }

    // Threat domes and flak zones.
    const samR = samRange(s);
    for (const e of s.enemies) {
      if (!e.alive) continue;
      if (e.kind === 'sam' || (e.kind === 'ship' && !e.isTarget)) {
        const [x, y] = this.toCanvas(e.pos);
        const active = e.state === 'tracking' || e.state === 'locked' || e.state === 'launch';
        ctx.strokeStyle = active ? col.red : 'rgba(255, 59, 59, 0.45)';
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.arc(x, y, (e.kind === 'sam' ? samR : 14000) * sc, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (e.kind === 'aaa' || e.kind === 'ship') {
        const [x, y] = this.toCanvas(e.pos);
        ctx.fillStyle = 'rgba(255, 150, 40, 0.28)';
        ctx.beginPath();
        ctx.arc(x, y, (e.kind === 'aaa' ? AAA_RADIUS : 4000) * sc, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Route waypoint.
    if (p.waypoint) {
      const [x, y] = this.toCanvas(p.waypoint);
      ctx.strokeStyle = col.cyan;
      ctx.setLineDash([W / 60, W / 60]);
      ctx.beginPath();
      ctx.moveTo(R, R);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Target and exit markers.
    const diamond = (c: V3, color: string, size: number): void => {
      const [x, y] = this.toCanvas(c);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, y - size);
      ctx.lineTo(x + size, y);
      ctx.lineTo(x, y + size);
      ctx.lineTo(x - size, y);
      ctx.closePath();
      ctx.fill();
    };
    if (s.target.alive) diamond(s.target.pos, col.magenta, W / 30);
    if (s.training && s.training.step === 0) {
      const ring = s.training.rings[s.training.ringIndex];
      if (ring) diamond(ring, col.cyan, W / 40);
    }

    // Contacts. Inside a storm the radar shows static instead.
    if (!s.inStorm) {
      const drawn = new Set<string>();
      for (const e of s.enemies) {
        if (!e.alive || e.isTarget) continue;
        const [x, y] = this.toCanvas(e.pos);
        const rel = e.heading - p.heading;
        ctx.save();
        ctx.translate(x, y);
        if (e.kind === 'fighter') {
          const locked = s.player.lockTargetId === e.id;
          ctx.rotate(rel);
          ctx.fillStyle = col.red;
          ctx.beginPath();
          const k = W / 40;
          ctx.moveTo(0, -k);
          ctx.lineTo(k * 0.8, k * 0.7);
          ctx.lineTo(0, k * 0.2);
          ctx.lineTo(-k * 0.8, k * 0.7);
          ctx.closePath();
          ctx.fill();
          if (locked) {
            ctx.strokeStyle = col.cyan;
            ctx.lineWidth = lw;
            ctx.strokeRect(-k * 1.4, -k * 1.4, k * 2.8, k * 2.8);
          }
        } else if (e.kind === 'drone') {
          ctx.fillStyle = col.red;
          ctx.beginPath();
          ctx.arc(0, 0, W / 110, 0, Math.PI * 2);
          ctx.fill();
          const g = e.groupId ?? e.id;
          if (!drawn.has(g)) {
            drawn.add(g);
            const n = s.enemies.filter(o => o.alive && o.groupId === g).length;
            ctx.font = `700 ${Math.round(W / 16)}px ui-monospace, monospace`;
            ctx.fillText(`×${n}`, W / 40, -W / 40);
          }
        } else if (e.kind === 'sam' || e.kind === 'aaa') {
          const active = e.state === 'tracking' || e.state === 'locked' || e.state === 'launch';
          ctx.fillStyle = e.kind === 'aaa' ? 'rgb(255,150,40)' : active ? col.red : 'rgba(255,59,59,0.7)';
          ctx.beginPath();
          ctx.arc(0, W / 120, W / 32, Math.PI, 0);
          ctx.closePath();
          ctx.fill();
        } else if (e.kind === 'ship') {
          ctx.rotate(rel);
          ctx.fillStyle = col.red;
          ctx.beginPath();
          const k = W / 30;
          ctx.moveTo(0, -k);
          ctx.lineTo(k * 0.4, -k * 0.2);
          ctx.lineTo(k * 0.4, k);
          ctx.lineTo(-k * 0.4, k);
          ctx.lineTo(-k * 0.4, -k * 0.2);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
      if (s.target.alive && s.target.kind === 'warship') {
        const [x, y] = this.toCanvas(s.target.pos);
        ctx.strokeStyle = col.magenta;
        ctx.lineWidth = lw * 1.5;
        ctx.strokeRect(x - W / 24, y - W / 24, W / 12, W / 12);
      }
      // Missiles as arrows.
      for (const m of s.missiles) {
        const [x, y] = this.toCanvas(m.pos);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(m.heading - p.heading);
        ctx.strokeStyle = m.owner === 'player' ? col.cyan : col.red;
        ctx.lineWidth = lw * 1.4;
        const k = W / 45;
        ctx.beginPath();
        ctx.moveTo(0, k);
        ctx.lineTo(0, -k);
        ctx.moveTo(-k * 0.5, -k * 0.4);
        ctx.lineTo(0, -k);
        ctx.lineTo(k * 0.5, -k * 0.4);
        ctx.stroke();
        ctx.restore();
      }
    } else {
      // Radar static.
      const n = 260;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * R;
        ctx.fillStyle = `rgba(176, 123, 255, ${0.2 + Math.random() * 0.5})`;
        ctx.fillRect(R + Math.cos(a) * r, R + Math.sin(a) * r, W / 120, W / 120);
      }
    }

    // Own jet.
    ctx.fillStyle = col.cyan;
    ctx.beginPath();
    const k = W / 26;
    ctx.moveTo(R, R - k);
    ctx.lineTo(R + k * 0.7, R + k * 0.7);
    ctx.lineTo(R, R + k * 0.3);
    ctx.lineTo(R - k * 0.7, R + k * 0.7);
    ctx.closePath();
    ctx.fill();

    // North tick.
    const nAngle = -p.heading;
    ctx.fillStyle = col.white;
    ctx.font = `700 ${Math.round(W / 14)}px ui-sans-serif, system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', R + Math.sin(nAngle) * R * 0.86, R - Math.cos(nAngle) * R * 0.86);
    ctx.restore();
  }
}
