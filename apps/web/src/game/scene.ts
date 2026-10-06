import * as THREE from 'three';
import {
  forward, groundHeight, lerp, rng as makeRng, range, surfaceHeight, wrapPi,
  type Enemy, type GameState, type Missile, type V3,
} from '@crewstrike/game-core';
import { cameraRoll } from './camera';
import {
  makeAaa, makeBridge, makeDrone, makeJet, makeMissile, makeRadarStation, makeSam, makeShip, makeTrainingTower, softTexture,
} from './models';

export interface SceneOptions {
  lowPower: boolean;
}

export interface Projected {
  x: number;
  y: number;
  /** True when the point is behind the camera. */
  behind: boolean;
  onScreen: boolean;
}

const SKY_TOP = new THREE.Color(0x0d3157);
const SKY_HORIZON = new THREE.Color(0xa9d2ee);
const SEA_HORIZON = new THREE.Color(0xb7d9ee);

function terrainColor(h: number, sea: boolean): THREE.Color {
  if (h < -5) return new THREE.Color(sea ? 0x1b3f55 : 0x35505a);
  if (h < 30) return new THREE.Color(0xcdbb86);
  if (h < 350) return new THREE.Color(0x557f3c).lerp(new THREE.Color(0x6f8f48), h / 350);
  if (h < 750) return new THREE.Color(0x6f8f48).lerp(new THREE.Color(0x7d6c52), (h - 350) / 400);
  if (h < 1150) return new THREE.Color(0x7d6c52).lerp(new THREE.Color(0x8d8f93), (h - 750) / 400);
  return new THREE.Color(0xe9eef2);
}

interface Trail {
  line: THREE.Line;
  pts: Float32Array;
  count: number;
}

interface FxSprite {
  sprite: THREE.Sprite;
  id: number;
  kind: string;
  at: number;
  pos: V3;
}

/** Three.js scene: rendering only. It reads game state and never changes it. */
export class GameScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private world = new THREE.Group();
  private entities = new THREE.Group();
  private jet: { group: THREE.Group; glow: THREE.Mesh };
  private enemyMeshes = new Map<string, THREE.Object3D>();
  private missileMeshes = new Map<string, THREE.Object3D>();
  private trails = new Map<string, Trail>();
  private bullets: THREE.InstancedMesh;
  private flareSprites: THREE.Sprite[] = [];
  private fxPool: FxSprite[] = [];
  private seenFx = new Set<number>();
  private target: THREE.Object3D | null = null;
  private dish: THREE.Object3D | null = null;
  private strikeZone: THREE.Mesh | null = null;
  private exitZone: THREE.Mesh | null = null;
  private rings: THREE.Mesh[] = [];
  private storms: THREE.Group[] = [];
  private smoke: THREE.Group | null = null;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private flashUntil = 0;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private texSoft = softTexture();
  private texFire = softTexture('rgba(255,220,140,1)', 'rgba(255,80,0,0)');
  private texSmoke = softTexture('rgba(90,90,90,0.9)', 'rgba(60,60,60,0)');
  private texStorm = softTexture('rgba(70,40,110,0.95)', 'rgba(50,30,90,0)');
  private loadedMission = '';
  private scale = 1;
  private frameTimes: number[] = [];
  fullRoll = false;
  private tmpV = new THREE.Vector3();
  private dummy = new THREE.Object3D();

  constructor(private container: HTMLElement, private opts: SceneOptions) {
    this.renderer = new THREE.WebGLRenderer({ antialias: !opts.lowPower, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.setAttribute('data-testid', 'game-canvas');
    container.append(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(75, 1, 2, 70000);
    this.scene.add(this.world, this.entities);

    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x3a4a2a, 1.4);
    this.sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
    this.sun.position.set(-0.4, 0.8, -0.5).multiplyScalar(1000);
    this.scene.add(this.hemi, this.sun);
    this.scene.add(this.makeSky());

    this.jet = makeJet(0x8fa3b5, 0x35e0ff);
    this.entities.add(this.jet.group);

    const bulletGeo = new THREE.BoxGeometry(0.5, 0.5, 14);
    const bulletMat = new THREE.MeshBasicMaterial({ color: 0xfff080 });
    this.bullets = new THREE.InstancedMesh(bulletGeo, bulletMat, 256);
    this.bullets.frustumCulled = false;
    this.bullets.count = 0;
    this.entities.add(this.bullets);

    for (let i = 0; i < 40; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texFire, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.scale.setScalar(18);
      s.visible = false;
      this.flareSprites.push(s);
      this.entities.add(s);
    }
    for (let i = 0; i < 90; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texFire, transparent: true, depthWrite: false }));
      s.visible = false;
      this.entities.add(s);
      this.fxPool.push({ sprite: s, id: -1, kind: '', at: 0, pos: [0, 0, 0] });
    }
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private makeSky(): THREE.Mesh {
    const geo = new THREE.SphereGeometry(60000, 32, 16);
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: SKY_TOP }, horizon: { value: SKY_HORIZON }, sunDir: { value: new THREE.Vector3(-0.4, 0.5, -0.6).normalize() } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; varying vec3 vDir;
        void main(){ float h = clamp(vDir.y, -0.2, 1.0); vec3 c = mix(horizon, top, pow(max(h,0.0), 0.55));
        if (h < 0.0) c = mix(horizon, horizon*0.85, -h*4.0);
        float s = max(dot(normalize(vDir), sunDir), 0.0); c += vec3(1.0,0.9,0.7) * (pow(s, 600.0)*1.5 + pow(s, 12.0)*0.15);
        gl_FragColor = vec4(c, 1.0); }`,
    });
    const sky = new THREE.Mesh(geo, m);
    sky.name = 'sky';
    sky.frustumCulled = false;
    return sky;
  }

  setFov(fov: number): void {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.applyPixelRatio();
    this.renderer.setSize(w, h);
  }

  private applyPixelRatio(): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * this.scale * (this.opts.lowPower ? 0.85 : 1));
  }

  get resolutionScale(): number {
    return this.scale;
  }

  /** Dynamic resolution: lower pixel ratio before ever dropping frames. */
  trackFrame(ms: number): void {
    this.frameTimes.push(ms);
    if (this.frameTimes.length < 60) return;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 16;
    this.frameTimes = [];
    if (p90 > 18 && this.scale > 0.6) {
      this.scale = Math.max(0.6, this.scale - 0.1);
      this.applyPixelRatio();
    } else if (p90 < 12 && this.scale < 1) {
      this.scale = Math.min(1, this.scale + 0.1);
      this.applyPixelRatio();
    }
  }

  /** Build the static world for a mission (terrain, water, clouds, target, zones). */
  load(s: GameState): void {
    const m = s.mission;
    this.clearWorld();
    this.loadedMission = `${m.id}:${s.t === 0 ? 'start' : 'mid'}`;
    const sea = m.terrain.kind === 'sea';
    const horizon = sea ? SEA_HORIZON : SKY_HORIZON;
    this.scene.fog = new THREE.Fog(horizon, 9000, 52000);
    const sky = this.scene.getObjectByName('sky') as THREE.Mesh | undefined;
    if (sky) (sky.material as THREE.ShaderMaterial).uniforms.horizon!.value = horizon;

    // Terrain: one flat-shaded heightfield sampled from the same function the game uses.
    const cx = (m.start.pos[0] + m.target.pos[0]) / 2;
    const cz = (m.start.pos[2] + m.target.pos[2]) / 2;
    const size = 110000;
    const seg = this.opts.lowPower ? 200 : 300;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + cx;
      const z = pos.getZ(i) + cz;
      const h = groundHeight(m.terrain, x, z);
      pos.setY(i, h);
      const c = terrainColor(h, sea);
      const j = (Math.sin(x * 0.0123) * Math.cos(z * 0.0171) + 1) * 0.03;
      colors[i * 3] = c.r * (0.95 + j);
      colors[i * 3 + 1] = c.g * (0.95 + j);
      colors[i * 3 + 2] = c.b * (0.95 + j);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    terrain.position.set(cx, 0, cz);
    terrain.name = 'terrain';
    this.world.add(terrain);

    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(size * 1.6, size * 1.6),
      new THREE.MeshPhongMaterial({ color: sea ? 0x1f5f86 : 0x2b6a8a, shininess: 80, specular: 0x88aacc, transparent: true, opacity: 0.92 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(cx, 0, cz);
    water.name = 'water';
    this.world.add(water);

    // Clouds.
    const r = makeRng(m.seed + 99);
    const clouds = m.weather.clouds ?? 30;
    const cloudMat = new THREE.SpriteMaterial({ map: this.texSoft, color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, fog: true });
    for (let i = 0; i < clouds; i++) {
      const g = new THREE.Group();
      const bx = cx + range(r, -45000, 45000);
      const bz = cz + range(r, -45000, 45000);
      const by = range(r, 2400, 4200);
      for (let k = 0; k < 5; k++) {
        const sp = new THREE.Sprite(cloudMat);
        const sc = range(r, 700, 1600);
        sp.scale.set(sc * 1.6, sc, 1);
        sp.position.set(range(r, -900, 900), range(r, -150, 200), range(r, -900, 900));
        g.add(sp);
      }
      g.position.set(bx, by, bz);
      this.world.add(g);
    }

    // Storm cells: dark purple columns.
    this.storms = s.storms.map(st => {
      const g = new THREE.Group();
      const mat2 = new THREE.SpriteMaterial({ map: this.texStorm, transparent: true, opacity: 0.75, depthWrite: false });
      for (let k = 0; k < 36; k++) {
        const sp = new THREE.Sprite(mat2);
        const a = range(r, 0, Math.PI * 2);
        const d = range(r, 0, st.radius * 0.85);
        const sc = range(r, st.radius * 0.5, st.radius * 0.9);
        sp.scale.set(sc, sc * 0.8, 1);
        sp.position.set(Math.cos(a) * d, range(r, 600, 6500), Math.sin(a) * d);
        g.add(sp);
      }
      this.world.add(g);
      return g;
    });

    // Target.
    const t = s.target;
    let target: THREE.Object3D;
    if (t.kind === 'radar_station') {
      const rs = makeRadarStation();
      target = rs.group;
      this.dish = rs.dish;
    } else if (t.kind === 'warship') {
      target = makeShip(180);
      target.rotation.y = 0.6;
    } else if (t.kind === 'bridge') {
      target = makeBridge(700);
    } else {
      target = makeTrainingTower();
    }
    target.position.set(t.pos[0], t.pos[1], t.pos[2]);
    this.target = target;
    this.world.add(target);

    const zoneGeo = (radius: number): THREE.CylinderGeometry => new THREE.CylinderGeometry(radius, radius, 2600, 72, 1, true);
    const zoneMat = (color: number): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false, fog: false });
    this.strikeZone = new THREE.Mesh(zoneGeo(m.strikeZone.radius), zoneMat(0xff3cf0));
    this.strikeZone.position.set(m.strikeZone.center[0], 1300 + t.pos[1], m.strikeZone.center[2]);
    this.world.add(this.strikeZone);
    this.exitZone = new THREE.Mesh(zoneGeo(m.exit.radius), zoneMat(0x3dff8a));
    this.exitZone.position.set(m.exit.center[0], 1300 + surfaceHeight(m.terrain, m.exit.center[0], m.exit.center[2]), m.exit.center[2]);
    this.world.add(this.exitZone);

    this.rings = (s.training?.rings ?? []).map((p, i, all) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(130, 10, 8, 32), new THREE.MeshBasicMaterial({ color: 0x35e0ff, transparent: true, opacity: 0.85 }));
      ring.position.set(p[0], p[1], p[2]);
      const prev = all[i - 1] ?? m.start.pos;
      ring.lookAt(prev[0], p[1], prev[2]);
      this.world.add(ring);
      return ring;
    });

    this.jet.group.visible = true;
    this.seenFx.clear();
  }

  private clearWorld(): void {
    const dispose = (o: THREE.Object3D): void => {
      o.traverse(c => {
        const mesh = c as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
    };
    for (const c of [...this.world.children]) {
      dispose(c);
      this.world.remove(c);
    }
    for (const [, o] of this.enemyMeshes) this.entities.remove(o);
    for (const [, o] of this.missileMeshes) this.entities.remove(o);
    for (const [, tr] of this.trails) this.entities.remove(tr.line);
    this.enemyMeshes.clear();
    this.missileMeshes.clear();
    this.trails.clear();
    this.target = null;
    this.dish = null;
    this.smoke = null;
    this.rings = [];
    for (const f of this.fxPool) f.sprite.visible = false;
  }

  isLoaded(s: GameState): boolean {
    return this.loadedMission.startsWith(`${s.mission.id}:`);
  }

  private enemyMesh(e: Enemy): THREE.Object3D {
    let o = this.enemyMeshes.get(e.id);
    if (o) return o;
    switch (e.kind) {
      case 'fighter': o = makeJet(0x6d5a58, 0xff3b3b).group; break;
      case 'drone': o = makeDrone(); break;
      case 'sam': o = makeSam(); break;
      case 'aaa': o = makeAaa(); break;
      case 'ship': o = e.isTarget ? new THREE.Group() : makeShip(110); break;
    }
    if (e.kind === 'ship' && !e.isTarget) o.rotation.y = e.heading;
    this.enemyMeshes.set(e.id, o);
    this.entities.add(o);
    return o;
  }

  private missileMesh(m: Missile): THREE.Object3D {
    let o = this.missileMeshes.get(m.id);
    if (o) return o;
    o = makeMissile(m.owner === 'player' ? 0x35e0ff : 0xff3b3b);
    this.missileMeshes.set(m.id, o);
    this.entities.add(o);
    const pts = new Float32Array(48 * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: m.kind === 'strike' ? 0xffd0ff : 0xe8e8e8, transparent: true, opacity: 0.6 }));
    line.frustumCulled = false;
    this.entities.add(line);
    this.trails.set(m.id, { line, pts, count: 0 });
    return o;
  }

  private orient(o: THREE.Object3D, heading: number, pitch: number, bank: number): void {
    o.rotation.order = 'YXZ';
    o.rotation.set(pitch, -heading, -bank);
  }

  /** Draw one frame; alpha interpolates between the previous and the current fixed step. */
  render(s: GameState, alpha: number, nowMs: number): void {
    if (!this.isLoaded(s)) this.load(s);
    const p = s.player;
    const px = lerp(p.prevPos[0], p.pos[0], alpha);
    const py = lerp(p.prevPos[1], p.pos[1], alpha);
    const pz = lerp(p.prevPos[2], p.pos[2], alpha);
    const heading = p.prevHeading + wrapPi(p.heading - p.prevHeading) * alpha;
    const pitch = lerp(p.prevPitch, p.pitch, alpha);
    const bank = lerp(p.prevBank, p.bank, alpha);
    this.jet.group.position.set(px, py, pz);
    this.orient(this.jet.group, heading, pitch, bank);
    this.jet.group.visible = s.status !== 'lost';
    const glow = p.boost ? 1.8 : 0.6 + p.throttle * 0.25;
    this.jet.glow.scale.set(1, glow, 1);

    // Comfort chase camera.
    const back = forward(heading, pitch * 0.6);
    const want = this.tmpV.set(px - back[0] * 42, py - back[1] * 42 + 9, pz - back[2] * 42);
    if (this.camPos.lengthSq() === 0 || this.camPos.distanceTo(want) > 400) this.camPos.copy(want);
    else this.camPos.lerp(want, 0.35);
    const fwd = forward(heading, pitch);
    this.camLook.set(px + fwd[0] * 80, py + fwd[1] * 80 + 4, pz + fwd[2] * 80);
    this.camera.position.copy(this.camPos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.camLook);
    this.camera.rotateZ(-cameraRoll(bank, { fullRollCamera: this.fullRoll }));

    // Enemies.
    const alive = new Set<string>();
    for (const e of s.enemies) {
      const o = this.enemyMesh(e);
      alive.add(e.id);
      o.position.set(lerp(e.prevPos[0], e.pos[0], alpha), lerp(e.prevPos[1], e.pos[1], alpha), lerp(e.prevPos[2], e.pos[2], alpha));
      if (e.kind === 'fighter' || e.kind === 'drone') {
        this.orient(o, e.heading, e.pitch, e.bank);
        o.visible = e.alive;
      } else if (!e.alive && o.userData.dead !== true) {
        o.userData.dead = true;
        o.traverse(c => {
          const mesh = c as THREE.Mesh;
          if (mesh.material && 'color' in mesh.material) (mesh.material as THREE.MeshLambertMaterial).color = new THREE.Color(0x222222);
        });
        o.rotation.z = 0.25;
      }
    }
    for (const [id, o] of this.enemyMeshes) if (!alive.has(id)) {
      this.entities.remove(o);
      this.enemyMeshes.delete(id);
    }

    // Missiles and trails.
    const live = new Set<string>();
    for (const m of s.missiles) {
      live.add(m.id);
      const o = this.missileMesh(m);
      const mx = lerp(m.prevPos[0], m.pos[0], alpha);
      const my = lerp(m.prevPos[1], m.pos[1], alpha);
      const mz = lerp(m.prevPos[2], m.pos[2], alpha);
      o.position.set(mx, my, mz);
      this.orient(o, m.heading, m.pitch, 0);
      const tr = this.trails.get(m.id);
      if (tr) {
        tr.pts.copyWithin(3, 0, tr.pts.length - 3);
        tr.pts[0] = mx;
        tr.pts[1] = my;
        tr.pts[2] = mz;
        tr.count = Math.min(48, tr.count + 1);
        if (tr.count === 1) for (let i = 1; i < 48; i++) tr.pts.set([mx, my, mz], i * 3);
        (tr.line.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        tr.line.geometry.setDrawRange(0, tr.count);
      }
    }
    for (const [id, o] of this.missileMeshes) if (!live.has(id)) {
      this.entities.remove(o);
      this.missileMeshes.delete(id);
      const tr = this.trails.get(id);
      if (tr) {
        this.entities.remove(tr.line);
        tr.line.geometry.dispose();
        this.trails.delete(id);
      }
    }

    // Bullets as one instanced mesh.
    const n = Math.min(256, s.bullets.length);
    for (let i = 0; i < n; i++) {
      const b = s.bullets[i]!;
      this.dummy.position.set(lerp(b.prevPos[0], b.pos[0], alpha), lerp(b.prevPos[1], b.pos[1], alpha), lerp(b.prevPos[2], b.pos[2], alpha));
      this.dummy.lookAt(this.dummy.position.x + b.vel[0], this.dummy.position.y + b.vel[1], this.dummy.position.z + b.vel[2]);
      this.dummy.updateMatrix();
      this.bullets.setMatrixAt(i, this.dummy.matrix);
    }
    this.bullets.count = n;
    this.bullets.instanceMatrix.needsUpdate = true;

    this.flareSprites.forEach((sp, i) => {
      const f = s.flares[i];
      sp.visible = !!f;
      if (f) {
        sp.position.set(lerp(f.prevPos[0], f.pos[0], alpha), lerp(f.prevPos[1], f.pos[1], alpha), lerp(f.prevPos[2], f.pos[2], alpha));
        sp.scale.setScalar(14 + Math.sin(nowMs * 0.05 + i) * 4);
      }
    });

    this.updateFx(s, nowMs);

    // Target, zones, rings, storms.
    if (this.dish) this.dish.rotation.y = s.t * 1.2;
    if (this.target && !s.target.alive && !this.target.userData.dead) {
      this.target.userData.dead = true;
      this.target.traverse(c => {
        const mesh = c as THREE.Mesh;
        if (mesh.material && 'color' in mesh.material) (mesh.material as THREE.MeshLambertMaterial).color = new THREE.Color(0x2a2522);
      });
      this.target.rotation.z = 0.12;
      this.smoke = this.smokeColumn(s.target.pos);
      this.world.add(this.smoke);
    }
    if (this.smoke) this.smoke.children.forEach((c, i) => {
      c.position.y = ((s.t * 40 + i * 90) % 900);
      (c as THREE.Sprite).material.opacity = 0.6 * (1 - c.position.y / 900);
    });
    if (this.strikeZone) this.strikeZone.visible = s.target.alive && !s.training;
    if (this.exitZone) {
      this.exitZone.visible = !s.training;
      (this.exitZone.material as THREE.MeshBasicMaterial).opacity = s.target.alive ? 0.07 : 0.16;
    }
    this.rings.forEach((r, i) => {
      const idx = s.training?.ringIndex ?? 99;
      r.visible = i >= idx && (s.training?.step ?? 99) === 0;
      (r.material as THREE.MeshBasicMaterial).opacity = i === idx ? 0.95 : 0.35;
    });
    s.storms.forEach((st, i) => {
      const g = this.storms[i];
      if (!g) return;
      g.visible = st.active;
      g.position.set(st.pos[0], 0, st.pos[2]);
    });

    const flash = nowMs < this.flashUntil;
    this.hemi.intensity = flash ? 4 : 1.4;
    this.renderer.render(this.scene, this.camera);
  }

  private smokeColumn(pos: V3): THREE.Group {
    const g = new THREE.Group();
    const m = new THREE.SpriteMaterial({ map: this.texSmoke, transparent: true, depthWrite: false });
    for (let i = 0; i < 10; i++) {
      const sp = new THREE.Sprite(m.clone());
      sp.scale.setScalar(120 + i * 25);
      g.add(sp);
    }
    g.position.set(pos[0], pos[1] + 20, pos[2]);
    return g;
  }

  private updateFx(s: GameState, nowMs: number): void {
    for (const f of s.fx) {
      if (this.seenFx.has(f.id)) continue;
      this.seenFx.add(f.id);
      if (f.kind === 'lightning') {
        this.flashUntil = nowMs + 120;
        continue;
      }
      const slot = this.fxPool.find(x => !x.sprite.visible) ?? this.fxPool[0]!;
      slot.id = f.id;
      slot.kind = f.kind;
      slot.at = s.t;
      slot.pos = [...f.pos];
      slot.sprite.visible = true;
      slot.sprite.position.set(f.pos[0], f.pos[1], f.pos[2]);
      const m = slot.sprite.material;
      m.map = f.kind === 'flak' ? this.texSmoke : this.texFire;
      m.blending = f.kind === 'flak' ? THREE.NormalBlending : THREE.AdditiveBlending;
      m.needsUpdate = true;
    }
    if (this.seenFx.size > 500) this.seenFx = new Set([...this.seenFx].slice(-200));
    for (const slot of this.fxPool) {
      if (!slot.sprite.visible) continue;
      const age = s.t - slot.at;
      const life = slot.kind === 'big_explosion' ? 2.4 : slot.kind === 'explosion' ? 1.4 : slot.kind === 'flak' ? 1.6 : 0.5;
      if (age > life || age < 0) {
        slot.sprite.visible = false;
        continue;
      }
      const u = age / life;
      const size = slot.kind === 'big_explosion' ? 260 : slot.kind === 'explosion' ? 90 : slot.kind === 'flak' ? 60 : slot.kind === 'splash' ? 40 : 18;
      slot.sprite.scale.setScalar(size * (0.4 + u * 1.2));
      slot.sprite.material.opacity = 1 - u;
    }
  }

  /** Screen position of a world point, in CSS pixels. */
  project(p: V3 | THREE.Vector3): Projected {
    const v = p instanceof THREE.Vector3 ? p.clone() : new THREE.Vector3(p[0], p[1], p[2]);
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    const rel = v.clone().sub(this.camera.position);
    const behind = rel.dot(camDir) < 0;
    v.project(this.camera);
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    const x = (v.x * 0.5 + 0.5) * w;
    const y = (-v.y * 0.5 + 0.5) * h;
    return { x, y, behind, onScreen: !behind && x >= 0 && x <= w && y >= 0 && y <= h };
  }

  /** Screen point where the jet's nose points (the crosshair), a long way out. */
  boresight(s: GameState): Projected {
    const p = s.player;
    const f = forward(p.heading, p.pitch);
    return this.project([p.pos[0] + f[0] * 2000, p.pos[1] + f[1] * 2000, p.pos[2] + f[2] * 2000]);
  }
}
