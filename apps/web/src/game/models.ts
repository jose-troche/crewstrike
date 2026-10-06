import * as THREE from 'three';

// Procedural low-poly models: no model files to download, so the cockpit appears fast.

const mat = (color: number, opts: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial =>
  new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });

function tri(points: number[][], m: THREE.Material): THREE.Mesh {
  // A thin double-sided slab from a flat polygon in the x-z plane.
  const shape = new THREE.Shape();
  points.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x!, z!) : shape.lineTo(x!, z!)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false });
  g.rotateX(Math.PI / 2);
  return new THREE.Mesh(g, m);
}

/**
 * Jet facing -z (nose forward), y up. About 15 m long.
 * Returns the group and the engine glow mesh (scaled with throttle and boost).
 */
export function makeJet(body: number, accent: number): { group: THREE.Group; glow: THREE.Mesh } {
  const g = new THREE.Group();
  const bodyM = mat(body);
  const accentM = mat(accent);
  const dark = mat(0x1b2530);

  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 10, 8), bodyM);
  fuselage.rotation.x = Math.PI / 2;
  g.add(fuselage);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.9, 4.5, 8), bodyM);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -7.2;
  g.add(nose);
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(0.75, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshPhongMaterial({ color: 0x66e6ff, emissive: 0x0a3a48, shininess: 90, flatShading: true }),
  );
  canopy.scale.set(0.9, 0.8, 2.4);
  canopy.position.set(0, 0.65, -3.4);
  g.add(canopy);

  const wingL = tri([[0, -1.5], [-7.5, 3.2], [-7.5, 4.3], [0, 3.6]], bodyM);
  const wingR = tri([[0, -1.5], [7.5, 3.2], [7.5, 4.3], [0, 3.6]], bodyM);
  wingL.position.y = -0.1;
  wingR.position.y = -0.1;
  g.add(wingL, wingR);
  const stripeL = tri([[-5.6, 2.3], [-7.5, 3.2], [-7.5, 4.3], [-5.6, 4.0]], accentM);
  const stripeR = tri([[5.6, 2.3], [7.5, 3.2], [7.5, 4.3], [5.6, 4.0]], accentM);
  stripeL.position.y = 0.02;
  stripeR.position.y = 0.02;
  g.add(stripeL, stripeR);

  const stabL = tri([[0, 3.8], [-3, 5.8], [-3, 6.4], [0, 5.6]], bodyM);
  const stabR = tri([[0, 3.8], [3, 5.8], [3, 6.4], [0, 5.6]], bodyM);
  g.add(stabL, stabR);
  for (const side of [-1, 1]) {
    const fin = tri([[0, 2.6], [0, 5.6], [-2.8, 5.8], [-2.8, 4.6]], accentM);
    fin.rotation.z = Math.PI / 2 + side * 0.25;
    fin.position.set(side * 0.7, 0.3, 0);
    g.add(fin);
  }
  const intake = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 3), dark);
  intake.position.set(0, -0.5, 0.2);
  g.add(intake);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.6, 1.2, 8, 1, true), dark);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.z = 5.4;
  g.add(nozzle);
  const glow = new THREE.Mesh(
    new THREE.ConeGeometry(0.6, 3.2, 8),
    new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  glow.rotation.x = Math.PI / 2;
  glow.position.z = 7.4;
  g.add(glow);
  return { group: g, glow };
}

export function makeDrone(): THREE.Group {
  const g = new THREE.Group();
  const m = mat(0x2a2f36);
  const red = new THREE.MeshBasicMaterial({ color: 0xff4040 });
  const wing = tri([[0, -2.2], [-3.2, 1.4], [0, 0.6], [3.2, 1.4]], m);
  g.add(wing);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 4), red);
  eye.position.set(0, 0.1, -1.6);
  g.add(eye);
  g.scale.setScalar(1.6);
  return g;
}

export function makeSam(): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(14, 16, 4, 8), mat(0x5b5b48));
  base.position.y = 2;
  g.add(base);
  const launcher = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 18), mat(0x6b6d55));
  launcher.position.set(0, 8, 0);
  launcher.rotation.x = -0.6;
  g.add(launcher);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(6, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xc9c9b8));
  dome.position.set(16, 0, 10);
  g.add(dome);
  return g;
}

export function makeAaa(): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(7, 9, 4, 6), mat(0x5d5446));
  base.position.y = 2;
  g.add(base);
  const turret = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 6), mat(0x6e6252));
  turret.position.y = 6;
  g.add(turret);
  for (const s of [-1.4, 1.4]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 10, 5), mat(0x2a2a2a));
    barrel.rotation.x = -1.0;
    barrel.position.set(s, 9, -3);
    g.add(barrel);
  }
  return g;
}

export function makeShip(length = 140): THREE.Group {
  const g = new THREE.Group();
  const hull = new THREE.Shape();
  const w = length * 0.11;
  hull.moveTo(0, -length / 2);
  hull.lineTo(w, -length * 0.2);
  hull.lineTo(w, length * 0.45);
  hull.lineTo(-w, length * 0.45);
  hull.lineTo(-w, -length * 0.2);
  hull.lineTo(0, -length / 2);
  const hg = new THREE.ExtrudeGeometry(hull, { depth: 9, bevelEnabled: false });
  hg.rotateX(Math.PI / 2);
  hg.translate(0, 9, 0);
  const hullMesh = new THREE.Mesh(hg, mat(0x5a646e));
  hullMesh.position.y = -4;
  g.add(hullMesh);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(w * 1.2, 10, length * 0.25), mat(0x76818c));
  deck.position.set(0, 9, length * 0.1);
  g.add(deck);
  const mast = new THREE.Mesh(new THREE.BoxGeometry(2, 18, 2), mat(0x3e4750));
  mast.position.set(0, 22, length * 0.08);
  g.add(mast);
  for (const z of [-length * 0.28, length * 0.33]) {
    const turret = new THREE.Mesh(new THREE.CylinderGeometry(4, 4.5, 3, 8), mat(0x4b545d));
    turret.position.set(0, 7, z);
    g.add(turret);
  }
  return g;
}

export function makeRadarStation(): { group: THREE.Group; dish: THREE.Object3D } {
  const g = new THREE.Group();
  const building = new THREE.Mesh(new THREE.BoxGeometry(36, 14, 24), mat(0x8a8f80));
  building.position.y = 7;
  g.add(building);
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(3, 5, 40, 6), mat(0x9aa094));
  tower.position.set(0, 34, 0);
  g.add(tower);
  const dish = new THREE.Group();
  const d = new THREE.Mesh(new THREE.BoxGeometry(34, 10, 2), mat(0xe0e2da));
  dish.add(d);
  const marker = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), new THREE.MeshBasicMaterial({ color: 0xff3cf0 }));
  marker.position.y = 7;
  dish.add(marker);
  dish.position.y = 58;
  g.add(dish);
  return { group: g, dish };
}

export function makeBridge(span: number): THREE.Group {
  const g = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(span, 6, 22), mat(0x8b8577));
  g.add(deck);
  const arch = new THREE.Mesh(new THREE.TorusGeometry(span * 0.42, 3, 6, 24, Math.PI), mat(0xb0503c));
  arch.position.y = -2;
  g.add(arch);
  for (const x of [-span * 0.3, 0, span * 0.3]) {
    const pier = new THREE.Mesh(new THREE.BoxGeometry(10, 300, 14), mat(0x6d6a60));
    pier.position.set(x, -153, 0);
    g.add(pier);
  }
  return g;
}

export function makeTrainingTower(): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(7 - i * 0.6, 7.5 - i * 0.6, 12, 8), mat(i % 2 ? 0xffffff : 0xff4fd8));
    seg.position.y = 6 + i * 12;
    g.add(seg);
  }
  return g;
}

export function makeMissile(color: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 4.2, 6), mat(0xdedede));
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1, 6), mat(color));
  tip.rotation.x = -Math.PI / 2;
  tip.position.z = -2.6;
  g.add(tip);
  const flame = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 6, 4),
    new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  flame.position.z = 2.6;
  g.add(flame);
  g.scale.setScalar(2.2);
  return g;
}

/** Soft round sprite texture drawn on a canvas, used for clouds, smoke, flares and explosions. */
export function softTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)'): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
