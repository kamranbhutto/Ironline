/**
 * 3D picture of a packing option: the parts inside one container, the containers on a pallet, or
 * the pallets in the truck. Everything is drawn as blocks (bounding boxes), the same way the
 * packing maths counts them. Millimetres throughout; y is up.
 */
import type { PackOption } from "@ironline/shared";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type PackViewMode = "box" | "pallet" | "truck";

const MAX_BLOCKS = 30000;
const COLORS = {
  part: 0x5b8def,
  partAlt: 0x7aa5f5,
  carton: 0xc9a36b,
  tote: 0x3f7fbf,
  crate: 0xb08550,
  deck: 0x9b7447,
  wrap: 0xd9dde3,
};

type Block = { x: number; y: number; z: number; l: number; h: number; w: number; tone?: number };

/** Blocks for the chosen view, centred on the floor at the origin. */
function blocks(o: PackOption, mode: PackViewMode, explode: number): { items: Block[]; frame: Block | null; deck: Block[] } {
  const items: Block[] = [];
  const deck: Block[] = [];
  const box = o.box;
  if (mode === "box") {
    const gap = explode * box.cell.h * 0.8;
    const ch = box.cell.h;
    let left = box.count;
    for (let k = 0; k < Math.max(1, box.layers) && left > 0; k++) {
      for (const r of box.rects) {
        if (left <= 0 || items.length >= MAX_BLOCKS) break;
        const shrink = 0.94;
        const height = box.perStack > 1 ? ch + (box.perStack - 1) * box.layerStep : ch;
        items.push({
          x: r.x + r.l / 2,
          y: k * (box.layerStep + gap) + height / 2,
          z: r.y + r.w / 2,
          l: r.l * shrink,
          h: height * (box.perStack > 1 ? 0.99 : shrink),
          w: r.w * shrink,
          tone: k % 2,
        });
        left -= box.perStack;
      }
    }
    const c = o.container;
    return { items, frame: { x: c.l / 2, y: c.h / 2, z: c.w / 2, l: c.l, h: c.h, w: c.w }, deck };
  }
  if (mode === "pallet") {
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
    return { items, frame: null, deck };
  }
  // Truck: each pallet as its deck plus one block for the load.
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
  return { items, frame: { x: v.l / 2, y: v.h / 2, z: v.w / 2, l: v.l, h: v.h, w: v.w }, deck };
}

function instanced(list: Block[], color: number, alt?: number) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05 });
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

/** Thin edges for a few hundred blocks; beyond that they only add noise. */
function edges(list: Block[], color: number) {
  const pts: number[] = [];
  const base = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  const arr = base.getAttribute("position").array as Float32Array;
  for (const b of list.slice(0, 1500)) {
    for (let i = 0; i < arr.length; i += 3) pts.push(b.x + arr[i]! * b.l, b.y + arr[i + 1]! * b.h, b.z + arr[i + 2]! * b.w);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45 }));
}

export function PackView3D({ option, mode, explode = 0, className }: { option: PackOption; mode: PackViewMode; explode?: number; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const camState = useRef<{ mode: PackViewMode; pos: THREE.Vector3; target: THREE.Vector3; moved: boolean } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.shadowMap.enabled = true;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f98, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    scene.add(sun);

    const { items, frame, deck } = blocks(option, mode, explode);
    const group = new THREE.Group();
    const itemColor = mode === "box" ? COLORS.part : mode === "pallet" ? COLORS[option.container.kind] : COLORS.wrap;
    group.add(instanced(items, itemColor, mode === "box" ? COLORS.partAlt : undefined));
    if (items.length <= 1500) group.add(edges(items, 0x1b2430));
    if (deck.length) group.add(instanced(deck, COLORS.deck));
    if (frame) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(frame.l, frame.h, frame.w), new THREE.MeshStandardMaterial({ color: mode === "box" ? COLORS[option.container.kind] : 0x9aa4ae, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.BackSide }));
      wall.position.set(frame.x, frame.y, frame.z);
      group.add(wall);
      group.add(edges([frame], mode === "box" ? 0x8a6a3c : 0x5b6673));
    }
    // Centre the footprint on the origin.
    const bounds = new THREE.Box3().setFromObject(group);
    const centre = bounds.getCenter(new THREE.Vector3());
    group.position.set(-centre.x, 0, -centre.z);
    scene.add(group);
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 1);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(radius * 8, radius * 8), new THREE.ShadowMaterial({ opacity: 0.12 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    sun.position.set(radius * 1.2, radius * 2.2, radius * 0.8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = sc.bottom = -radius * 1.5;
    sc.right = sc.top = radius * 1.5;
    sc.far = radius * 6;

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

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
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
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      camState.current = { mode, pos: camera.position.clone(), target: controls.target.clone(), moved };
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [option, mode, explode]);

  return <div ref={host} className={className} role="img" aria-label={mode === "box" ? "Parts inside the container" : mode === "pallet" ? "Containers on the pallet" : "Pallets in the truck"} />;
}
