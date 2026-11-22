/**
 * 3D picture of a packing option: the parts inside one container (with dividers and layer pads),
 * the containers on a pallet, or the pallets in the truck. Everything is drawn as blocks (bounding
 * boxes), the same way the packing maths counts them. Millimetres throughout; three.js y is up and
 * is labelled Z, as in CAD. Also renders still pictures (front, side, top) for the packing report.
 */
import type { PackOption } from "@ironline/shared";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type PackViewMode = "box" | "pallet" | "truck";
export type StillView = "iso" | "front" | "side" | "top";

const MAX_BLOCKS = 30000;
const COLORS = {
  part: 0x3f7fe0,
  partAlt: 0x5b93ea,
  carton: 0xc9a36b,
  tote: 0x3a6f9f,
  crate: 0xb08550,
  board: 0xc7a06a,
  deck: 0x8f6a40,
  wrap: 0xcdbb98,
};

type Block = { x: number; y: number; z: number; l: number; h: number; w: number; tone?: number };

/** Blocks for the chosen view. */
function blocks(o: PackOption, mode: PackViewMode, explode: number) {
  const items: Block[] = [];
  const deck: Block[] = [];
  const board: Block[] = [];
  let frame: Block | null = null;
  const box = o.box;
  if (mode === "box") {
    const ch = box.cell.h;
    const pad = Math.max(0, box.layerStep - ch);
    const gap = explode * Math.max(ch, 40) * 0.9;
    const cells = box.dividerM2 > 0;
    const div = cells ? 3 : 0;
    let left = box.count;
    const height = box.perStack > 1 ? ch + (box.perStack - 1) * box.layerStep : ch;
    for (let k = 0; k < Math.max(1, box.layers) && left > 0; k++) {
      const y0 = k * (box.layerStep + gap);
      for (const r of box.rects) {
        if (left <= 0 || items.length >= MAX_BLOCKS) break;
        const shrink = cells ? 0.88 : 0.94;
        items.push({ x: r.x + r.l / 2, y: y0 + height / 2, z: r.y + r.w / 2, l: (r.l - div * 2) * shrink, h: height * (box.perStack > 1 ? 0.99 : shrink), w: (r.w - div * 2) * shrink, tone: k % 2 });
        left -= box.perStack;
      }
      // A pad on top of every layer but the last.
      if (pad > 0 && k < box.layers - 1) board.push({ x: o.container.l / 2, y: y0 + ch + pad / 2 + gap / 2, z: o.container.w / 2, l: o.container.l, h: pad, w: o.container.w });
    }
    if (cells && box.rects.length) {
      // Divider walls between the cells, full height.
      const xs = [...new Set(box.rects.map((r) => r.x))].sort((a, b) => a - b).slice(1);
      const ys = [...new Set(box.rects.map((r) => r.y))].sort((a, b) => a - b).slice(1);
      const H = Math.max(1, box.layers) * (box.layerStep + gap) - gap;
      for (const x of xs) board.push({ x, y: H / 2, z: o.container.w / 2, l: div, h: H, w: o.container.w });
      for (const y of ys) board.push({ x: o.container.l / 2, y: H / 2, z: y, l: o.container.l, h: H, w: div });
    }
    const c = o.container;
    frame = { x: c.l / 2, y: c.h / 2, z: c.w / 2, l: c.l, h: c.h, w: c.w };
  } else if (mode === "pallet") {
    const p = o.pallet;
    deck.push({ x: p.l / 2, y: p.h / 2, z: p.w / 2, l: p.l, h: p.h, w: p.w });
    const gap = explode * o.outer.h * 0.5;
    let left = o.palletLoad.boxes;
    for (let k = 0; k < o.palletLoad.layers && left > 0; k++) {
      for (const r of o.palletLoad.rects) {
        if (left-- <= 0) break;
        items.push({ x: r.x + r.l / 2, y: p.h + k * (o.outer.h + gap) + o.outer.h / 2, z: r.y + r.w / 2, l: r.l * 0.985, h: o.outer.h * 0.985, w: r.w * 0.985 });
      }
    }
  } else {
    const v = o.vehicle;
    const loadH = o.palletLoad.height - o.pallet.h;
    let left = o.load.pallets;
    for (let t = 0; t < o.load.tiers && left > 0; t++) {
      for (const r of o.load.rects) {
        if (left-- <= 0) break;
        const y0 = t * o.palletLoad.height;
        deck.push({ x: r.x + r.l / 2, y: y0 + o.pallet.h / 2, z: r.y + r.w / 2, l: r.l * 0.98, h: o.pallet.h, w: r.w * 0.98 });
        items.push({ x: r.x + r.l / 2, y: y0 + o.pallet.h + loadH / 2, z: r.y + r.w / 2, l: r.l * 0.96, h: loadH * 0.99, w: r.w * 0.96 });
      }
    }
    frame = { x: v.l / 2, y: v.h / 2, z: v.w / 2, l: v.l, h: v.h, w: v.w };
  }
  return { items, deck, board, frame };
}

function instanced(list: Block[], color: number, alt?: number, opacity = 1) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05, transparent: opacity < 1, opacity });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  const m = new THREE.Matrix4();
  const c1 = new THREE.Color(color);
  const c2 = new THREE.Color(alt ?? color);
  list.forEach((b, i) => {
    m.compose(new THREE.Vector3(b.x, b.y, b.z), new THREE.Quaternion(), new THREE.Vector3(b.l, b.h, b.w));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, b.tone ? c2 : c1);
  });
  mesh.count = list.length;
  mesh.castShadow = true;
  return mesh;
}

/** Thin edges for up to 1500 blocks; beyond that they only add noise. */
function edges(list: Block[], color: number, opacity = 0.45) {
  const pts: number[] = [];
  const base = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  const arr = base.getAttribute("position").array as Float32Array;
  for (const b of list.slice(0, 1500)) {
    for (let i = 0; i < arr.length; i += 3) pts.push(b.x + arr[i]! * b.l, b.y + arr[i + 1]! * b.h, b.z + arr[i + 2]! * b.w);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
}

/** The load as one group, centred on the floor at the origin, and its size. */
export function buildPackGroup(option: PackOption, mode: PackViewMode, explode = 0, dunnage = true) {
  const { items, frame, deck, board } = blocks(option, mode, explode);
  const group = new THREE.Group();
  const itemColor = mode === "box" ? COLORS.part : mode === "pallet" ? COLORS[option.container.kind] : COLORS.wrap;
  group.add(instanced(items, itemColor, mode === "box" ? COLORS.partAlt : undefined));
  if (items.length <= 1500) group.add(edges(items, 0x1b2430, mode === "box" ? 0.35 : 0.5));
  if (deck.length) group.add(instanced(deck, COLORS.deck));
  if (dunnage && board.length) {
    group.add(instanced(board, COLORS.board, undefined, 0.92));
    group.add(edges(board, 0x6b4d26, 0.5));
  }
  if (frame) {
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(frame.l, frame.h, frame.w),
      new THREE.MeshStandardMaterial({ color: mode === "box" ? COLORS[option.container.kind] : 0x9aa4ae, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.BackSide }),
    );
    wall.position.set(frame.x, frame.y, frame.z);
    group.add(wall);
    group.add(edges([frame], mode === "box" ? 0x8a6a3c : 0x5b6673, 0.8));
  }
  const bounds = new THREE.Box3().setFromObject(group);
  const centre = bounds.getCenter(new THREE.Vector3());
  group.position.set(-centre.x, 0, -centre.z);
  return { group, size: bounds.getSize(new THREE.Vector3()) };
}

function lights(scene: THREE.Scene, radius: number, floorShadow = true) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f98, 1.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(radius * 1.2, radius * 2.2, radius * 0.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = sc.bottom = -radius * 1.5;
  sc.right = sc.top = radius * 1.5;
  sc.far = radius * 6;
  scene.add(sun);
  if (!floorShadow) return;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(radius * 8, radius * 8), new THREE.ShadowMaterial({ opacity: 0.12 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
}

function dispose(scene: THREE.Scene) {
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.geometry && !(o instanceof THREE.Sprite)) return;
    m.geometry?.dispose();
    const mats = (Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) as THREE.Material[];
    mats.forEach((mat) => {
      (mat as THREE.SpriteMaterial).map?.dispose();
      mat.dispose();
    });
  });
}

/** Small X / Y / Z direction marker drawn in a corner of the view. */
function makeGizmo() {
  const scene = new THREE.Scene();
  const axis = (dir: THREE.Vector3, color: number, label: string) => {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 12), new THREE.MeshBasicMaterial({ color }));
    shaft.position.copy(dir.clone().multiplyScalar(0.5));
    shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    scene.add(shaft);
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    g.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
    g.beginPath();
    g.arc(32, 32, 28, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#fff";
    g.font = "bold 34px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(label, 32, 34);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
    s.position.copy(dir.clone().multiplyScalar(1.3));
    s.scale.setScalar(0.62);
    scene.add(s);
  };
  // three.js x = length (X), z = width (Y), y = up (Z).
  axis(new THREE.Vector3(1, 0, 0), 0xe5484d, "X");
  axis(new THREE.Vector3(0, 0, 1), 0x30a46c, "Y");
  axis(new THREE.Vector3(0, 1, 0), 0x3e63dd, "Z");
  const camera = new THREE.OrthographicCamera(-1.75, 1.75, 1.75, -1.75, 0.1, 10);
  return { scene, camera };
}

export function PackView3D({ option, mode, explode = 0, dunnage = true, className }: { option: PackOption; mode: PackViewMode; explode?: number; dunnage?: boolean; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const camState = useRef<{ mode: PackViewMode; pos: THREE.Vector3; target: THREE.Vector3; moved: boolean } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.shadowMap.enabled = true;
    renderer.autoClear = false;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    const scene = new THREE.Scene();
    const { group, size } = buildPackGroup(option, mode, explode, dunnage);
    scene.add(group);
    const radius = Math.max(size.length() / 2, 1);
    lights(scene, radius);
    const gizmo = makeGizmo();

    const camera = new THREE.PerspectiveCamera(35, 1, radius / 100, radius * 40);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const target = new THREE.Vector3(0, size.y / 2, 0);
    const prev = camState.current;
    // Fit the whole load in view, whichever way the viewport is shaped, until the user moves the camera.
    let moved = !!(prev && prev.mode === mode && prev.moved);
    const dir = new THREE.Vector3(1.6, 1.15, 1.9).normalize();
    const fit = () => {
      const v = THREE.MathUtils.degToRad(camera.fov) / 2;
      const hz = Math.atan(Math.tan(v) * camera.aspect);
      const dist = (radius * 1.08) / Math.sin(Math.min(v, hz));
      camera.position.copy(target).addScaledVector(dir, dist);
      controls.target.copy(target);
      controls.update();
    };
    if (moved) {
      camera.position.copy(prev!.pos);
      controls.target.copy(prev!.target);
    }
    controls.addEventListener("start", () => (moved = true));
    controls.update();

    let w = 1;
    let h = 1;
    const resize = () => {
      w = el.clientWidth || 1;
      h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (!moved) fit();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    let raf = 0;
    const tick = () => {
      controls.update();
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, w, h);
      renderer.clear();
      renderer.render(scene, camera);
      // Direction marker in the top-right corner, turned with the main camera.
      const g = 120;
      renderer.setViewport(w - g - 10, h - g - 10, g, g);
      renderer.setScissor(w - g - 10, h - g - 10, g, g);
      renderer.setScissorTest(true);
      renderer.clearDepth();
      gizmo.camera.position.copy(camera.position).sub(controls.target).normalize().multiplyScalar(4);
      gizmo.camera.up.copy(camera.up);
      gizmo.camera.lookAt(0, 0, 0);
      renderer.render(gizmo.scene, gizmo.camera);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      camState.current = { mode, pos: camera.position.clone(), target: controls.target.clone(), moved };
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      dispose(scene);
      dispose(gizmo.scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [option, mode, explode, dunnage]);

  return <div ref={host} className={className} role="img" aria-label={mode === "box" ? "Parts inside the container" : mode === "pallet" ? "Containers on the pallet" : "Pallets in the truck"} />;
}

/**
 * Still pictures for the packing report: perspective, front, side or top, as PNG data URLs.
 * Front looks along the width (shows length × height), side along the length, top straight down.
 */
export function renderStills(option: PackOption, shots: { mode: PackViewMode; view: StillView }[], width = 640, height = 440): string[] {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setSize(width, height, false);
  renderer.setClearColor(0xffffff, 1);
  renderer.shadowMap.enabled = true;
  const out: string[] = [];
  try {
    for (const shot of shots) {
      const scene = new THREE.Scene();
      const { group, size } = buildPackGroup(option, shot.mode, 0, true);
      scene.add(group);
      const radius = Math.max(size.length() / 2, 1);
      lights(scene, radius, shot.view === "iso");
      const target = new THREE.Vector3(0, size.y / 2, 0);
      let camera: THREE.Camera;
      const aspect = width / height;
      if (shot.view === "iso") {
        const cam = new THREE.PerspectiveCamera(30, aspect, radius / 100, radius * 40);
        const v = THREE.MathUtils.degToRad(cam.fov) / 2;
        const dist = (radius * 1.05) / Math.sin(Math.min(v, Math.atan(Math.tan(v) * aspect)));
        cam.position.copy(target).addScaledVector(new THREE.Vector3(1.6, 1.15, 1.9).normalize(), dist);
        cam.lookAt(target);
        camera = cam;
      } else {
        // Orthographic, fitted to the two sides that face the camera.
        const [a, b] = shot.view === "front" ? [size.x, size.y] : shot.view === "side" ? [size.z, size.y] : [size.x, size.z];
        const half = Math.max(a / 2 / aspect, b / 2) * 1.12;
        const cam = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, 0.1, radius * 20);
        const d = radius * 4;
        if (shot.view === "front") cam.position.set(0, target.y, d);
        else if (shot.view === "side") cam.position.set(d, target.y, 0);
        else {
          cam.position.set(0, d, 0);
          cam.up.set(0, 0, -1);
        }
        cam.lookAt(shot.view === "top" ? new THREE.Vector3(0, 0, 0) : target);
        camera = cam;
      }
      renderer.render(scene, camera);
      out.push(renderer.domElement.toDataURL("image/png"));
      dispose(scene);
    }
  } finally {
    renderer.dispose();
  }
  return out;
}
