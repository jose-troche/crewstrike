import {
  boresightTarget, enemyById, leadPoint, lockCone, TRAINING_STEPS, dist, dist2d, type GameState, type V3,
} from '@crewstrike/game-core';
import type { GameScene, Projected } from '../game/scene';
import type { PaletteColors } from './palette';

/** Full-screen 2D layer: boresight, lead marker, lock ring, enemy brackets, objective marker, speed streaks. */
export class Overlay {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private streaks: { a: number; r: number; len: number; life: number }[] = [];
  reducedMotion = false;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'overlay';
    this.ctx = this.canvas.getContext('2d');
  }

  private fit(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w !== this.w || h !== this.h || dpr !== this.dpr) {
      this.w = w;
      this.h = h;
      this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
  }

  /** Where the objective is now: ring, target or exit. */
  objective(s: GameState): { pos: V3; color: 'magenta' | 'green' | 'cyan'; label: string } {
    const tr = s.training;
    if (tr && TRAINING_STEPS[tr.step]?.kind === 'rings') {
      const ring = tr.rings[tr.ringIndex];
      if (ring) return { pos: ring, color: 'cyan', label: 'RING' };
    }
    if (tr && TRAINING_STEPS[tr.step]?.kind === 'drone') {
      const d = s.enemies.find(e => e.alive && e.groupId === 'train');
      if (d) return { pos: d.pos, color: 'cyan', label: 'DRONE' };
    }
    if (s.target.alive) return { pos: s.target.pos, color: 'magenta', label: 'TARGET' };
    return { pos: s.mission.exit.center, color: 'green', label: 'EXIT' };
  }

  draw(s: GameState, scene: GameScene, col: PaletteColors, nowMs: number, dtMs: number): void {
    this.fit();
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (s.status === 'lost') return;
    const p = s.player;
    const bore = scene.boresight(s);
    const fovRad = (scene.camera.fov * Math.PI) / 180;
    const pxPerRad = this.h / 2 / Math.tan(fovRad / 2);

    this.drawStreaks(ctx, s, col, dtMs);

    // Enemy brackets.
    ctx.lineWidth = 1.6;
    ctx.font = '700 11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    for (const e of s.enemies) {
      if (!e.alive || e.isTarget) continue;
      const d = dist(p.pos, e.pos);
      if (d > 26000) continue;
      const pr = scene.project(e.pos);
      if (!pr.onScreen) continue;
      const size = Math.max(7, Math.min(26, 4000 / Math.max(d, 1) * 6));
      const air = e.kind === 'fighter' || e.kind === 'drone';
      const color = e.kind === 'aaa' ? 'rgb(255,150,40)' : col.red;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      if (air) this.brackets(ctx, pr, size);
      else {
        ctx.beginPath();
        ctx.arc(pr.x, pr.y + size * 0.4, size * 0.8, Math.PI, 0);
        ctx.closePath();
        ctx.stroke();
      }
      if (p.lockTargetId === e.id && p.lockState !== 'none') {
        ctx.strokeStyle = p.lockState === 'locked' ? col.green : col.amber;
        ctx.lineWidth = 2.4;
        ctx.strokeRect(pr.x - size - 5, pr.y - size - 5, (size + 5) * 2, (size + 5) * 2);
        ctx.lineWidth = 1.6;
      }
      if (d < 15000 && (e.kind !== 'drone' || d < 6000)) ctx.fillText((d / 1000).toFixed(1), pr.x, pr.y + size + 13);
    }

    // Lead marker for the cannon.
    const tgt = enemyById(s, p.lockTargetId) ?? boresightTarget(s, 0.35, 3000, false);
    if (tgt && dist(p.pos, tgt.pos) < 3000) {
      const lp = scene.project(leadPoint(s, tgt));
      if (lp.onScreen) {
        ctx.strokeStyle = col.cyan;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(lp.x, lp.y, 6, 0, Math.PI * 2);
        ctx.moveTo(lp.x - 11, lp.y);
        ctx.lineTo(lp.x - 6, lp.y);
        ctx.moveTo(lp.x + 6, lp.y);
        ctx.lineTo(lp.x + 11, lp.y);
        ctx.stroke();
      }
    }

    // Missile markers.
    for (const m of s.missiles) {
      if (m.targetId !== 'player') continue;
      const pr = scene.project(m.pos);
      if (!pr.onScreen) continue;
      ctx.fillStyle = col.red;
      ctx.beginPath();
      ctx.moveTo(pr.x, pr.y - 9);
      ctx.lineTo(pr.x + 7, pr.y + 7);
      ctx.lineTo(pr.x - 7, pr.y + 7);
      ctx.closePath();
      ctx.fill();
    }

    // Boresight and heat-seeker lock ring.
    if (bore.onScreen) {
      const ringR = Math.tan(lockCone(s)) * pxPerRad;
      ctx.strokeStyle = p.lockState === 'locked' ? col.green : p.lockState === 'seeking' ? col.amber : 'rgba(242,246,250,0.35)';
      ctx.lineWidth = p.lockState === 'none' ? 1 : 2;
      if (p.missiles > 0) {
        ctx.beginPath();
        ctx.arc(bore.x, bore.y, Math.min(ringR, Math.min(this.h * 0.15, this.w * 0.13)), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = col.white;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bore.x - 16, bore.y);
      ctx.lineTo(bore.x - 6, bore.y);
      ctx.lineTo(bore.x - 3, bore.y + 4);
      ctx.lineTo(bore.x, bore.y);
      ctx.lineTo(bore.x + 3, bore.y + 4);
      ctx.lineTo(bore.x + 6, bore.y);
      ctx.lineTo(bore.x + 16, bore.y);
      ctx.stroke();
    }

    // Objective: diamond when visible, arrow at the screen edge when not.
    const obj = this.objective(s);
    const color = col[obj.color];
    const d = dist2d(p.pos, obj.pos);
    const pr = scene.project(obj.pos);
    const km = `${(d / 1000).toFixed(1)} km`;
    if (pr.onScreen) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(pr.x, pr.y - 12);
      ctx.lineTo(pr.x + 12, pr.y);
      ctx.lineTo(pr.x, pr.y + 12);
      ctx.lineTo(pr.x - 12, pr.y);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = '800 12px ui-sans-serif, system-ui';
      ctx.fillText(`${obj.label} ${km}`, pr.x, pr.y - 18);
      if (s.target.alive && p.strikeLock !== 'none' && obj.label === 'TARGET') {
        ctx.strokeStyle = p.strikeLock === 'locked' ? col.green : col.amber;
        ctx.strokeRect(pr.x - 22, pr.y - 22, 44, 44);
      }
    } else {
      this.edgeArrow(ctx, pr, color, km, nowMs);
    }
  }

  private brackets(ctx: CanvasRenderingContext2D, pr: Projected, s: number): void {
    const k = s * 0.45;
    ctx.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const x = pr.x + sx * s;
      const y = pr.y + sy * s;
      ctx.moveTo(x - sx * k, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y - sy * k);
    }
    ctx.stroke();
  }

  private edgeArrow(ctx: CanvasRenderingContext2D, pr: Projected, color: string, label: string, nowMs: number): void {
    const cx = this.w / 2;
    const cy = this.h / 2;
    let dx = pr.x - cx;
    let dy = pr.y - cy;
    if (pr.behind) {
      dx = -dx;
      dy = -dy;
      if (Math.abs(dy) < 1 && Math.abs(dx) < 1) dy = 1;
    }
    const a = Math.atan2(dy, dx);
    const mx = this.w / 2 - 60;
    const my = this.h / 2 - 60;
    const t = Math.min(mx / Math.max(Math.abs(Math.cos(a)), 1e-3), my / Math.max(Math.abs(Math.sin(a)), 1e-3));
    const x = cx + Math.cos(a) * t;
    const y = cy + Math.sin(a) * t;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = color;
    const bob = this.reducedMotion ? 0 : Math.sin(nowMs / 220) * 3;
    ctx.beginPath();
    ctx.moveTo(20 + bob, 0);
    ctx.lineTo(-4 + bob, -13);
    ctx.lineTo(2 + bob, 0);
    ctx.lineTo(-4 + bob, 13);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = color;
    ctx.font = '800 12px ui-sans-serif, system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(label, x - Math.cos(a) * 30, y - Math.sin(a) * 30 + 4);
  }

  /** Faint streaks at the screen edges show speed without any field-of-view change. */
  private drawStreaks(ctx: CanvasRenderingContext2D, s: GameState, col: PaletteColors, dtMs: number): void {
    const p = s.player;
    const intensity = Math.max(0, (p.speed - 230) / 250) + (p.boost ? 0.5 : 0);
    const rate = (this.reducedMotion ? 0.3 : 1) * intensity * 40;
    const spawn = Math.min(6, Math.floor(rate * (dtMs / 1000) + Math.random()));
    for (let i = 0; i < spawn; i++) this.streaks.push({ a: Math.random() * Math.PI * 2, r: 0.62 + Math.random() * 0.2, len: 0.05 + Math.random() * 0.08, life: 1 });
    const cx = this.w / 2;
    const cy = this.h / 2;
    const R = Math.hypot(cx, cy);
    ctx.strokeStyle = col.white;
    ctx.lineWidth = 1;
    for (const st of this.streaks) {
      st.r += (dtMs / 1000) * (0.9 + intensity);
      st.life -= dtMs / 600;
      ctx.globalAlpha = Math.max(0, st.life) * 0.25 * (this.reducedMotion ? 0.5 : 1);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(st.a) * st.r * R, cy + Math.sin(st.a) * st.r * R);
      ctx.lineTo(cx + Math.cos(st.a) * (st.r + st.len) * R, cy + Math.sin(st.a) * (st.r + st.len) * R);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    this.streaks = this.streaks.filter(st => st.life > 0 && st.r < 1.2);
  }
}
