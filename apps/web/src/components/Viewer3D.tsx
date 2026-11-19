/**
 * In-browser 3D part viewer. Reads STEP/IGES/BREP (via the OpenCascade WASM build in
 * occt-import-js, loaded unmodified as a separate file — LGPL), and STL, OBJ, GLB/GLTF,
 * 3MF and PLY via three.js loaders.
 *
 * Tools, in three groups on one toolbar:
 *  - Navigate: orbit, pan, zoom, fit, standard views, perspective or orthographic.
 *  - Inspect: measure distance or angle (snaps to corners), section along X/Y/Z, explode an
 *    assembly, display style (shaded, edges, wireframe, X-ray) and design colours.
 *  - Panels: model tree (show, hide, isolate parts), properties (size, area, volume, weight),
 *    screenshot, settings (units, shadows, background) and full screen.
 * Click a part to select it; double-click to zoom to it. Keys: F fit, H home, Esc clear.
 */
import {
  Boxes,
  Camera,
  Check,
  Cuboid,
  DraftingCompass,
  Expand,
  Eye,
  EyeOff,
  Focus,
  Hand,
  House,
  Info,
  ListTree,
  Maximize,
  Maximize2,
  Minimize2,
  Paintbrush,
  Rotate3d,
  Ruler,
  Scissors,
  Settings2,
  X,
  ZoomIn,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import occtWasmUrl from "occt-import-js/dist/occt-import-js.wasm?url";
import { cx } from "./ui.tsx";
import { getThumb, saveThumb } from "../thumbs.ts";

type OcctMesh = { name?: string; attributes: { position: { array: number[] }; normal?: { array: number[] } }; index?: { array: number[] }; color?: [number, number, number] };
type Occt = {
  ReadStepFile: (b: Uint8Array, p: null) => { success: boolean; meshes: OcctMesh[] };
  ReadIgesFile: (b: Uint8Array, p: null) => { success: boolean; meshes: OcctMesh[] };
  ReadBrepFile: (b: Uint8Array, p: null) => { success: boolean; meshes: OcctMesh[] };
};
let occtPromise: Promise<Occt> | null = null;
const loadOcct = () => {
  occtPromise ??= import("occt-import-js").then((m) => {
    const factory = (m.default ?? m) as (o: { locateFile: () => string }) => Promise<Occt>;
    return factory({ locateFile: () => occtWasmUrl });
  });
  return occtPromise;
};

const STEEL = new THREE.MeshStandardMaterial({ color: 0x9aa4ae, metalness: 0.55, roughness: 0.42, side: THREE.DoubleSide });
const HILITE = new THREE.Color(0x3b5bdb);

/** Opens the light GLB the server prepared from a CAD upload: steel finish, design colours kept. */
async function buildPrepared(buf: ArrayBuffer): Promise<THREE.Object3D> {
  const gltf = await new GLTFLoader().parseAsync(buf, "");
  gltf.scene.traverse((c) => {
    if (!(c instanceof THREE.Mesh)) return;
    // Mesh "extras" arrive as userData; the colour is stored there as [r, g, b].
    const rgb = (c.userData.cadColor ?? c.parent?.userData.cadColor) as [number, number, number] | undefined;
    c.userData.cadColor = rgb ? new THREE.Color(rgb[0], rgb[1], rgb[2]) : undefined;
    if (!c.geometry.getAttribute("normal")) c.geometry.computeVertexNormals();
    c.material = STEEL.clone();
  });
  return gltf.scene;
}

async function buildObject(name: string, buf: ArrayBuffer): Promise<THREE.Object3D> {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (["step", "stp", "iges", "igs", "brep"].includes(ext)) {
    const occt = await loadOcct();
    const bytes = new Uint8Array(buf);
    const res = ext === "iges" || ext === "igs" ? occt.ReadIgesFile(bytes, null) : ext === "brep" ? occt.ReadBrepFile(bytes, null) : occt.ReadStepFile(bytes, null);
    if (!res.success || !res.meshes.length) throw new Error("This CAD file could not be read. Try exporting it again as STEP AP214 or AP242.");
    const group = new THREE.Group();
    for (const m of res.meshes) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(m.attributes.position.array, 3));
      if (m.attributes.normal) g.setAttribute("normal", new THREE.Float32BufferAttribute(m.attributes.normal.array, 3));
      if (m.index) g.setIndex(m.index.array);
      if (!m.attributes.normal) g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, STEEL.clone());
      if (m.name) mesh.name = m.name;
      // Keep the CAD colour so the viewer can switch between steel and design colours.
      if (m.color) mesh.userData.cadColor = new THREE.Color(m.color[0], m.color[1], m.color[2]);
      group.add(mesh);
    }
    return group;
  }
  if (ext === "stl" || ext === "ply") {
    const g = ext === "stl" ? new STLLoader().parse(buf) : new PLYLoader().parse(buf);
    g.computeVertexNormals();
    return new THREE.Mesh(g, STEEL.clone());
  }
  if (ext === "obj") {
    const o = new OBJLoader().parse(new TextDecoder().decode(buf));
    o.traverse((c) => c instanceof THREE.Mesh && (c.material = STEEL.clone()));
    return o;
  }
  if (ext === "3mf") return new ThreeMFLoader().parse(buf);
  if (ext === "glb" || ext === "gltf") {
    const gltf = await new GLTFLoader().parseAsync(buf, "");
    return gltf.scene;
  }
  throw new Error(`.${ext} files cannot be shown in 3D`);
}

// ── Geometry maths ──────────────────────────────────────────────────────────

/** Surface area, enclosed volume (signed tetrahedra; meaningful for closed solids) and triangles, in world units. */
function meshStats(mesh: THREE.Mesh) {
  const pos = mesh.geometry.getAttribute("position");
  if (!pos) return { area: 0, volume: 0, triangles: 0 };
  const idx = mesh.geometry.getIndex();
  const m = mesh.matrixWorld;
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3(),
    ab = new THREE.Vector3(),
    ac = new THREE.Vector3();
  let area = 0;
  let volume = 0;
  const n = idx ? idx.count : pos.count;
  for (let i = 0; i + 2 < n; i += 3) {
    const ia = idx ? idx.getX(i) : i,
      ib = idx ? idx.getX(i + 1) : i + 1,
      ic = idx ? idx.getX(i + 2) : i + 2;
    a.fromBufferAttribute(pos, ia).applyMatrix4(m);
    b.fromBufferAttribute(pos, ib).applyMatrix4(m);
    c.fromBufferAttribute(pos, ic).applyMatrix4(m);
    area += ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() / 2;
    volume += a.dot(b.clone().cross(c)) / 6;
  }
  return { area, volume: Math.abs(volume), triangles: Math.floor(n / 3) };
}

// ── Types ───────────────────────────────────────────────────────────────────

type Nav = "orbit" | "pan" | "zoom";
type MeasureMode = "off" | "distance" | "angle";
type Style = "shaded" | "edges" | "wire" | "xray";
type Axis = "x" | "y" | "z";
type ViewName = "home" | "front" | "back" | "left" | "right" | "top" | "bottom";
type Units = "mm" | "in";
type Background = "studio" | "light" | "dark";
type Menu = null | "views" | "measure" | "section" | "explode" | "style";
type Panel = null | "tree" | "props" | "settings";
type PartRow = { id: string; name: string; visible: boolean; triangles: number };
type Stats = { name: string; size: [number, number, number]; area: number; volume: number; triangles: number; parts: number };
type Measured = { kind: "distance"; d: number; dx: number; dy: number; dz: number } | { kind: "angle"; deg: number };

const DENSITY: { key: string; label: string; gcc: number }[] = [
  { key: "steel", label: "Steel", gcc: 7.85 },
  { key: "stainless", label: "Stainless steel", gcc: 8.0 },
  { key: "aluminium", label: "Aluminium", gcc: 2.7 },
  { key: "brass", label: "Brass", gcc: 8.5 },
  { key: "copper", label: "Copper", gcc: 8.96 },
  { key: "titanium", label: "Titanium", gcc: 4.43 },
  { key: "plastic", label: "Plastic (ABS/nylon)", gcc: 1.1 },
];

/** How close (in screen pixels) a click must be to a corner to snap to it. */
const SNAP_PX = 14;

interface Engine {
  fit: () => void;
  view: (v: ViewName) => void;
  ortho: (on: boolean) => void;
  nav: (n: Nav) => void;
  measure: (m: MeasureMode) => void;
  clearMeasure: () => void;
  section: (s: { on: boolean; axis: Axis; at: number; flip: boolean }) => void;
  explode: (k: number) => void;
  style: (s: Style) => void;
  colors: (on: boolean) => void;
  visible: (id: string, on: boolean) => void;
  isolate: (id: string | null) => void;
  select: (id: string | null) => void;
  focus: (id: string | null) => void;
  shadows: (on: boolean) => void;
  stats: (id: string | null) => Stats | null;
  screenshot: () => string;
}

export default function Viewer3D({ url, name, prepared = false, compact = false, thumbId, immersive = false }: { url: string; name: string; prepared?: boolean; compact?: boolean; thumbId?: string; immersive?: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const tag = useRef<HTMLDivElement>(null);
  const eng = useRef<Engine | null>(null);
  const [state, setState] = useState<{ loading: boolean; error: string | null; size: [number, number, number] | null }>({ loading: true, error: null, size: null });
  const [nav, setNav] = useState<Nav>("orbit");
  const [measureMode, setMeasureMode] = useState<MeasureMode>("off");
  const [measured, setMeasured] = useState<Measured | null>(null);
  const [section, setSection] = useState<{ on: boolean; axis: Axis; at: number; flip: boolean }>({ on: false, axis: "x", at: 50, flip: false });
  const [explode, setExplode] = useState(0);
  const [style, setStyle] = useState<Style>("shaded");
  const [cadColors, setCadColors] = useState(false);
  const [hasColors, setHasColors] = useState(false);
  const [ortho, setOrtho] = useState(false);
  const [units, setUnits] = useState<Units>("mm");
  const [shadows, setShadows] = useState(true);
  const [bg, setBg] = useState<Background>("studio");
  const [menu, setMenu] = useState<Menu>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [parts, setParts] = useState<PartRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [isolated, setIsolated] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [density, setDensity] = useState("steel");
  const [statsTick, setStatsTick] = useState(0);

  useEffect(() => {
    const el = host.current!;
    let disposed = false;
    const dark = document.documentElement.dataset.theme === "dark";
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.localClippingEnabled = true;
    renderer.shadowMap.enabled = true;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const persp = new THREE.PerspectiveCamera(35, 1, 0.01, 1e6);
    const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1e6);
    let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = persp;
    scene.add(new THREE.HemisphereLight(0xffffff, dark ? 0x202830 : 0xb8c2cc, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xdfe7ff, 0.6);
    scene.add(fill);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const clip = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
    let part: THREE.Object3D | null = null;
    let ground: THREE.Mesh | null = null;
    let bbox = new THREE.Box3();
    let measureMode: MeasureMode = "off";
    let style: Style = "shaded";
    let section = { on: false };
    let selectedId: string | null = null;
    const meshes: THREE.Mesh[] = [];
    const home = new Map<string, THREE.Vector3>();
    const picks: THREE.Vector3[] = [];
    const markers = new THREE.Group();
    scene.add(markers);
    const planeHelper = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x3b5bdb, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false }));
    planeHelper.visible = false;
    scene.add(planeHelper);

    const aspect = () => el.clientWidth / Math.max(el.clientHeight, 1);
    const syncOrtho = () => {
      const dist = camera.position.distanceTo(controls.target);
      const h = dist * Math.tan(THREE.MathUtils.degToRad(persp.fov / 2));
      orthoCam.left = -h * aspect();
      orthoCam.right = h * aspect();
      orthoCam.top = h;
      orthoCam.bottom = -h;
      orthoCam.updateProjectionMatrix();
    };
    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      persp.aspect = w / Math.max(h, 1);
      persp.updateProjectionMatrix();
      if (camera === orthoCam) {
        const hh = (orthoCam.top - orthoCam.bottom) / 2;
        orthoCam.left = -hh * aspect();
        orthoCam.right = hh * aspect();
        orthoCam.updateProjectionMatrix();
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const place = (dir: THREE.Vector3, box = bbox) => {
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const radius = size.length() / 2 || 1;
      const dist = (radius / Math.sin(THREE.MathUtils.degToRad(persp.fov / 2))) * 1.08;
      for (const cam of [persp, orthoCam]) {
        cam.position.copy(center).add(dir.clone().normalize().multiplyScalar(dist));
        cam.near = dist / 1000;
        cam.far = dist * 100;
        cam.zoom = 1;
        cam.updateProjectionMatrix();
      }
      controls.target.copy(center);
      controls.update();
      if (camera === orthoCam) syncOrtho();
      const r = bbox.getSize(new THREE.Vector3()).length() / 2 || 1;
      const c = bbox.getCenter(new THREE.Vector3());
      key.position.copy(c).add(new THREE.Vector3(1, 2, 1.5).multiplyScalar(r * 3));
      key.target.position.copy(c);
      fill.position.copy(c).add(new THREE.Vector3(-2, 0.5, -1).multiplyScalar(r * 3));
    };
    // Scene is Y-up (CAD Z is turned to Y on load).
    const DIRS: Record<ViewName, THREE.Vector3> = {
      home: new THREE.Vector3(1, 0.8, 1.2),
      front: new THREE.Vector3(0, 0, 1),
      back: new THREE.Vector3(0, 0, -1),
      left: new THREE.Vector3(-1, 0, 0),
      right: new THREE.Vector3(1, 0, 0),
      top: new THREE.Vector3(0, 1, 0.0001),
      bottom: new THREE.Vector3(0, -1, 0.0001),
    };

    const tint = () => {
      for (const m of meshes) {
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.emissive.copy(m.uuid === selectedId ? HILITE : new THREE.Color(0));
        mat.emissiveIntensity = m.uuid === selectedId ? 0.45 : 0;
      }
    };
    const edgeOf = (m: THREE.Mesh) => {
      let e = m.userData.edges as THREE.LineSegments | undefined;
      if (!e) {
        e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 28), new THREE.LineBasicMaterial({ color: 0x1b2430, transparent: true, opacity: 0.55, clippingPlanes: section.on ? [clip] : [] }));
        e.raycast = () => {};
        m.add(e);
        m.userData.edges = e;
      }
      return e;
    };
    const applyStyle = () => {
      for (const m of meshes) {
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.wireframe = style === "wire";
        mat.transparent = style === "xray";
        mat.opacity = style === "xray" ? 0.22 : 1;
        mat.depthWrite = style !== "xray";
        mat.needsUpdate = true;
        if (style === "edges") edgeOf(m).visible = true;
        else if (m.userData.edges) (m.userData.edges as THREE.LineSegments).visible = false;
      }
    };

    // ── Picking ──
    const raycaster = new THREE.Raycaster();
    const hitAt = (e: { clientX: number; clientY: number }) => {
      const r = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hits = part ? raycaster.intersectObjects(meshes.filter((m) => m.visible), false) : [];
      // Ignore what the section plane has cut away.
      return hits.find((h) => !section.on || clip.distanceToPoint(h.point) >= 0) ?? null;
    };
    let downAt: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (downAt = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (!downAt) return;
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      downAt = null;
      if (moved >= 6) return;
      if (measureMode !== "off") return pickPoint(e);
      const hit = hitAt(e);
      selectedId = hit ? hit.object.uuid : null;
      tint();
      setSelected(selectedId);
    };
    const onDbl = (e: MouseEvent) => {
      if (measureMode !== "off") return;
      const hit = hitAt(e);
      if (hit) api.focus(hit.object.uuid);
    };
    const dotSize = () => bbox.getSize(new THREE.Vector3()).length() / 150;
    const pickPoint = (e: PointerEvent) => {
      const hit = hitAt(e);
      if (!hit) return setHint("Click on the part itself, not the background");
      const need = measureMode === "angle" ? 3 : 2;
      if (picks.length >= need) {
        picks.length = 0;
        markers.clear();
      }
      // Snap to the nearest corner of the clicked triangle when the click is close to it.
      let point = hit.point.clone();
      const mesh = hit.object as THREE.Mesh;
      const pos = mesh.geometry?.getAttribute?.("position");
      const r = renderer.domElement.getBoundingClientRect();
      if (hit.face && pos) {
        let best = SNAP_PX;
        for (const i of [hit.face.a, hit.face.b, hit.face.c]) {
          const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
          const sp = v.clone().project(camera);
          const px = Math.hypot(((sp.x + 1) / 2) * r.width - (e.clientX - r.left), ((1 - sp.y) / 2) * r.height - (e.clientY - r.top));
          if (px < best) {
            best = px;
            point = v;
          }
        }
      }
      picks.push(point);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(dotSize(), 16, 16), new THREE.MeshBasicMaterial({ color: 0xf5c518, depthTest: false }));
      dot.position.copy(point);
      dot.renderOrder = 10;
      markers.add(dot);
      if (picks.length >= 2) {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(picks.slice(-2)), new THREE.LineBasicMaterial({ color: 0xf5c518, depthTest: false }));
        line.renderOrder = 10;
        markers.add(line);
      }
      if (measureMode === "distance" && picks.length === 2) {
        const [a, b] = picks as [THREE.Vector3, THREE.Vector3];
        // Report in CAD axes X, Y, Z (the scene is Y-up).
        setMeasured({ kind: "distance", d: a.distanceTo(b), dx: Math.abs(a.x - b.x), dy: Math.abs(a.z - b.z), dz: Math.abs(a.y - b.y) });
        setHint("Click again to start a new measurement · Esc to clear");
      } else if (measureMode === "angle" && picks.length === 3) {
        const [a, b, c] = picks as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
        const deg = THREE.MathUtils.radToDeg(a.clone().sub(b).angleTo(c.clone().sub(b)));
        setMeasured({ kind: "angle", deg });
        setHint("Click again to start a new angle · Esc to clear");
      } else {
        setMeasured(null);
        setHint(measureMode === "angle" ? ["Click the first point", "Now click the corner (vertex) of the angle", "Now click the third point"][picks.length]! : "Now click the second point");
      }
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("dblclick", onDbl);

    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      // Keep the measurement label pinned next to the measured line or corner.
      const t = tag.current;
      if (t) {
        const done = (measureMode === "distance" && picks.length === 2) || (measureMode === "angle" && picks.length === 3);
        if (done) {
          const at = measureMode === "angle" ? picks[1]!.clone() : picks[0]!.clone().add(picks[1]!).multiplyScalar(0.5);
          const m = at.project(camera);
          t.style.display = "block";
          t.style.left = `${((m.x + 1) / 2) * el.clientWidth}px`;
          t.style.top = `${((1 - m.y) / 2) * el.clientHeight}px`;
        } else t.style.display = "none";
      }
      raf = requestAnimationFrame(loop);
    };
    loop();

    (async () => {
      try {
        const res = await fetch(url, { credentials: "same-origin" });
        if (!res.ok) throw new Error(`Could not download the file (${res.status})`);
        const buf = await res.arrayBuffer();
        const obj = prepared ? await buildPrepared(buf) : await buildObject(name, buf);
        if (disposed) return;
        // CAD is usually Z-up; turn it so the part stands on the ground like on the bench.
        const ext = name.toLowerCase().split(".").pop() ?? "";
        if (["step", "stp", "iges", "igs", "brep", "stl", "3mf"].includes(ext)) obj.rotation.x = -Math.PI / 2;
        let n = 0;
        obj.traverse((c) => {
          if (c instanceof THREE.Mesh) {
            c.castShadow = true;
            c.receiveShadow = true;
            // Own material per part so selection, X-ray and colours affect one part at a time.
            if (!(c.material instanceof THREE.MeshStandardMaterial) || Array.isArray(c.material)) c.material = STEEL.clone();
            else c.material = (c.material as THREE.Material).clone();
            n += 1;
            c.userData.label = c.name || c.parent?.name || `Body ${n}`;
            meshes.push(c);
          }
        });
        scene.add(obj);
        part = obj;
        obj.updateMatrixWorld(true);
        bbox = new THREE.Box3().setFromObject(obj);
        for (const m of meshes) home.set(m.uuid, m.position.clone());
        const size = bbox.getSize(new THREE.Vector3());
        ground = new THREE.Mesh(new THREE.PlaneGeometry(size.length() * 6, size.length() * 6), new THREE.ShadowMaterial({ opacity: dark ? 0.35 : 0.16 }));
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = bbox.min.y - size.y * 0.002;
        ground.receiveShadow = true;
        scene.add(ground);
        const sc = key.shadow.camera as THREE.OrthographicCamera;
        const half = size.length();
        Object.assign(sc, { left: -half, right: half, top: half, bottom: -half, near: 0.01, far: half * 12 });
        sc.updateProjectionMatrix();
        place(DIRS.home);
        setHasColors(meshes.some((m) => m.userData.cadColor));
        setParts(meshes.map((m) => ({ id: m.uuid, name: m.userData.label as string, visible: true, triangles: Math.floor((m.geometry.getIndex()?.count ?? m.geometry.getAttribute("position")?.count ?? 0) / 3) })));
        setState({ loading: false, error: null, size: [size.x, size.z, size.y] });
        // First time this model is shown here: keep a small snapshot for file strips and part cards.
        if (thumbId && !getThumb(thumbId)) {
          requestAnimationFrame(() => {
            if (disposed) return;
            renderer.render(scene, camera);
            const src = renderer.domElement;
            const side = Math.min(src.width, src.height);
            const out = document.createElement("canvas");
            out.width = out.height = 200;
            const g = out.getContext("2d");
            if (!g || !side) return;
            g.fillStyle = "#eef1f5";
            g.fillRect(0, 0, 200, 200);
            g.drawImage(src, (src.width - side) / 2, (src.height - side) / 2, side, side, 0, 0, 200, 200);
            saveThumb(thumbId, out.toDataURL("image/jpeg", 0.82));
          });
        }
      } catch (err) {
        if (!disposed) setState({ loading: false, error: (err as Error).message, size: null });
      }
    })();

    const byId = (id: string) => meshes.find((m) => m.uuid === id);
    const api: Engine = {
      fit: () => {
        const box = new THREE.Box3();
        for (const m of meshes) if (m.visible) box.expandByObject(m);
        place(camera.position.clone().sub(controls.target), box.isEmpty() ? bbox : box);
      },
      view: (v) => place(DIRS[v]),
      ortho: (on) => {
        const next = on ? orthoCam : persp;
        if (next === camera) return;
        next.position.copy(camera.position);
        next.quaternion.copy(camera.quaternion);
        camera = next;
        // OrbitControls drives either camera; its type only names the perspective one.
        controls.object = camera as THREE.PerspectiveCamera;
        if (on) syncOrtho();
        controls.update();
      },
      nav: (n) => {
        controls.mouseButtons.LEFT = n === "pan" ? THREE.MOUSE.PAN : n === "zoom" ? THREE.MOUSE.DOLLY : THREE.MOUSE.ROTATE;
        renderer.domElement.style.cursor = n === "pan" ? "move" : n === "zoom" ? "zoom-in" : "grab";
      },
      measure: (m) => {
        measureMode = m;
        controls.enabled = m === "off";
        if (m !== "off") renderer.domElement.style.cursor = "crosshair";
        api.clearMeasure();
      },
      clearMeasure: () => {
        picks.length = 0;
        markers.clear();
        setMeasured(null);
        setHint(measureMode === "distance" ? "Click the first point on the part" : measureMode === "angle" ? "Click the first point" : null);
      },
      section: (s) => {
        section = { on: s.on };
        const axisVec = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 0, -1), z: new THREE.Vector3(0, 1, 0) }[s.axis];
        // CAD X/Y/Z: scene X, -Z (CAD Y) and Y (CAD Z).
        const lo = s.axis === "x" ? bbox.min.x : s.axis === "z" ? bbox.min.y : -bbox.max.z;
        const hi = s.axis === "x" ? bbox.max.x : s.axis === "z" ? bbox.max.y : -bbox.min.z;
        const at = THREE.MathUtils.lerp(lo, hi, s.at / 100);
        const n = axisVec.clone().multiplyScalar(s.flip ? 1 : -1);
        clip.set(n, s.flip ? -at : at);
        for (const m of meshes) {
          (m.material as THREE.Material).clippingPlanes = s.on ? [clip] : [];
          // Edge outlines are cut by the same plane, so the removed half leaves no ghost lines.
          const e = m.userData.edges as THREE.LineSegments | undefined;
          if (e) (e.material as THREE.Material).clippingPlanes = s.on ? [clip] : [];
        }
        planeHelper.visible = s.on;
        if (s.on) {
          const size = bbox.getSize(new THREE.Vector3()).length() * 1.1;
          planeHelper.scale.set(size, size, 1);
          const center = bbox.getCenter(new THREE.Vector3());
          planeHelper.position.copy(center).add(axisVec.clone().multiplyScalar(at - center.dot(axisVec)));
          planeHelper.lookAt(planeHelper.position.clone().add(axisVec));
        }
      },
      explode: (k) => {
        if (!part || meshes.length < 2) return;
        const center = bbox.getCenter(new THREE.Vector3());
        const spread = bbox.getSize(new THREE.Vector3()).length() * (k / 100) * 0.8;
        for (const m of meshes) {
          const base = home.get(m.uuid)!;
          m.position.copy(base);
          m.updateMatrixWorld(true);
          const c = new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3());
          const dir = c.sub(center);
          if (dir.lengthSq() < 1e-9) continue;
          const worldTarget = m.getWorldPosition(new THREE.Vector3()).add(dir.normalize().multiplyScalar(spread));
          m.position.copy(m.parent ? m.parent.worldToLocal(worldTarget) : worldTarget);
        }
      },
      style: (s) => {
        style = s;
        applyStyle();
      },
      colors: (on) => {
        for (const m of meshes) (m.material as THREE.MeshStandardMaterial).color.copy(on && m.userData.cadColor ? m.userData.cadColor : STEEL.color);
      },
      visible: (id, on) => {
        const m = byId(id);
        if (m) m.visible = on;
      },
      isolate: (id) => {
        for (const m of meshes) m.visible = !id || m.uuid === id;
        if (id) api.focus(id);
      },
      select: (id) => {
        selectedId = id;
        tint();
      },
      focus: (id) => {
        const m = id ? byId(id) : null;
        const box = m ? new THREE.Box3().setFromObject(m) : bbox;
        place(camera.position.clone().sub(controls.target), box);
        if (m) {
          selectedId = m.uuid;
          tint();
          setSelected(m.uuid);
        }
      },
      shadows: (on) => {
        key.castShadow = on;
        if (ground) ground.visible = on;
      },
      stats: (id) => {
        const list = id ? meshes.filter((m) => m.uuid === id) : meshes.filter((m) => m.visible);
        if (!list.length) return null;
        const box = new THREE.Box3();
        let area = 0,
          volume = 0,
          triangles = 0;
        for (const m of list) {
          m.updateMatrixWorld(true);
          box.expandByObject(m);
          const s = meshStats(m);
          area += s.area;
          volume += s.volume;
          triangles += s.triangles;
        }
        const sz = box.getSize(new THREE.Vector3());
        return { name: id ? (list[0]!.userData.label as string) : "Whole model", size: [sz.x, sz.z, sz.y], area, volume, triangles, parts: list.length };
      },
      screenshot: () => {
        renderer.render(scene, camera);
        return renderer.domElement.toDataURL("image/png");
      },
    };
    eng.current = api;

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("dblclick", onDbl);
      controls.dispose();
      scene.traverse((c) => {
        if (c instanceof THREE.Mesh || c instanceof THREE.LineSegments || c instanceof THREE.Line) {
          c.geometry.dispose();
          (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [url, name, prepared]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => eng.current?.nav(nav), [nav]);
  useEffect(() => eng.current?.measure(measureMode), [measureMode]);
  useEffect(() => eng.current?.section(section), [section]);
  useEffect(() => eng.current?.explode(explode), [explode]);
  useEffect(() => eng.current?.style(style), [style]);
  useEffect(() => eng.current?.colors(cadColors), [cadColors]);
  useEffect(() => eng.current?.ortho(ortho), [ortho]);
  useEffect(() => eng.current?.shadows(shadows), [shadows]);
  useEffect(() => {
    const f = () => setFull(document.fullscreenElement === wrap.current);
    document.addEventListener("fullscreenchange", f);
    return () => document.removeEventListener("fullscreenchange", f);
  }, []);

  const ready = !state.loading && !state.error;
  const k = units === "in" ? 1 / 25.4 : 1;
  const len = (n: number) => {
    const v = n * k;
    return `${v >= 100 ? v.toFixed(1) : v >= 10 ? v.toFixed(2) : v.toFixed(units === "in" ? 4 : 3)} ${units}`;
  };
  const fmt = (n: number) => {
    const v = n * k;
    return v >= 100 ? v.toFixed(1) : v.toFixed(2);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "SELECT") return;
    if (e.key === "Escape") {
      if (menu) setMenu(null);
      else if (measureMode !== "off") eng.current?.clearMeasure();
      else if (selected) (eng.current?.select(null), setSelected(null));
    } else if (e.key === "f" || e.key === "F") eng.current?.fit();
    else if (e.key === "h" || e.key === "H") eng.current?.view("home");
  };
  const toggleFull = () => (document.fullscreenElement ? document.exitFullscreen() : wrap.current?.requestFullscreen());
  const shot = () => {
    const data = eng.current?.screenshot();
    if (!data) return;
    const a = document.createElement("a");
    a.href = data;
    a.download = `${name.replace(/\.[^.]+$/, "")}-view.png`;
    a.click();
  };
  const toggleMenu = (m: Menu) => setMenu(menu === m ? null : m);
  const togglePanel = (p: Panel) => (setPanel(panel === p ? null : p), setMenu(null));
  const multi = parts.length > 1;

  const background = { studio: "bg-[radial-gradient(ellipse_at_center,var(--panel)_0%,var(--panel-2)_75%)]", light: "bg-white", dark: "bg-[#1b222b]" }[bg];

  return (
    <div ref={wrap} tabIndex={0} onKeyDown={onKey} className={cx("relative h-full min-h-[320px] w-full overflow-hidden rounded-xl outline-none", background)}>
      <div ref={host} className="absolute inset-0" />
      {state.loading && <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">Loading model…</div>}
      {state.error && <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-bad">{state.error}</div>}

      {state.size && (
        <div className={cx("num pointer-events-none absolute rounded-lg bg-panel/85 px-2.5 py-1.5 text-xs shadow-panel backdrop-blur", immersive ? "bottom-4 left-4" : "left-3 top-3")}>
          <div className="text-muted">Overall size</div>
          <div className="font-medium">
            {fmt(state.size[0])} × {fmt(state.size[1])} × {fmt(state.size[2])} {units}
          </div>
          {measured && (
            <div className="mt-1.5 border-t border-line pt-1.5">
              {measured.kind === "distance" ? (
                <>
                  <div className="text-sm font-semibold text-ink">Distance {len(measured.d)}</div>
                  <div className="text-muted">
                    X {fmt(measured.dx)} · Y {fmt(measured.dy)} · Z {fmt(measured.dz)}
                  </div>
                </>
              ) : (
                <div className="text-sm font-semibold text-ink">Angle {measured.deg.toFixed(2)}°</div>
              )}
            </div>
          )}
          {selected && !measured && <div className="mt-1.5 max-w-56 truncate border-t border-line pt-1.5 text-ink">Selected: {parts.find((p) => p.id === selected)?.name}</div>}
        </div>
      )}
      <div ref={tag} className="num pointer-events-none absolute hidden -translate-x-1/2 -translate-y-[130%] rounded-md bg-[#F5C518] px-2 py-0.5 text-sm font-semibold text-[#172230] shadow-lg">
        {measured ? (measured.kind === "distance" ? len(measured.d) : `${measured.deg.toFixed(1)}°`) : ""}
      </div>

      {hint && ready && <div className="pointer-events-none absolute bottom-[76px] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#172230]/85 px-3 py-1.5 text-xs text-white">{hint}</div>}

      {/* Side panels */}
      {ready && panel && (
        <div className={cx("absolute bottom-[76px] right-3 top-3 z-20 flex w-72 max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-xl bg-[#172230]/95 text-white shadow-2xl backdrop-blur", immersive && "top-[124px]")}>
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2.5">
            <span className="text-sm font-semibold">{panel === "tree" ? `Model tree · ${parts.length} part${parts.length === 1 ? "" : "s"}` : panel === "props" ? "Properties" : "Viewer settings"}</span>
            <button type="button" onClick={() => setPanel(null)} className="rounded p-1 text-white/70 hover:bg-white/10 hover:text-white" aria-label="Close panel">
              <X className="h-4 w-4" />
            </button>
          </div>
          {panel === "tree" && (
            <TreePanel
              parts={parts}
              selected={selected}
              isolated={isolated}
              onSelect={(id) => (setSelected(id), eng.current?.select(id))}
              onFocus={(id) => eng.current?.focus(id)}
              onToggle={(id) => {
                setParts(parts.map((p) => (p.id === id ? { ...p, visible: !p.visible } : p)));
                eng.current?.visible(id, !parts.find((p) => p.id === id)!.visible);
              }}
              onIsolate={(id) => {
                setIsolated(id);
                eng.current?.isolate(id);
                setParts(parts.map((p) => ({ ...p, visible: !id || p.id === id })));
              }}
            />
          )}
          {panel === "props" && <PropsPanel stats={eng.current?.stats(selected) ?? null} key={`${selected}-${statsTick}-${explode}`} units={units} density={density} onDensity={setDensity} onRefresh={() => setStatsTick(statsTick + 1)} />}
          {panel === "settings" && (
            <div className="space-y-4 p-3 text-sm">
              <Choice label="Units" value={units} onChange={(v) => setUnits(v as Units)} options={[["mm", "Millimetres"], ["in", "Inches"]]} />
              <Choice label="Projection" value={ortho ? "o" : "p"} onChange={(v) => setOrtho(v === "o")} options={[["p", "Perspective"], ["o", "Orthographic"]]} />
              <Choice label="Background" value={bg} onChange={(v) => setBg(v as Background)} options={[["studio", "Studio"], ["light", "White"], ["dark", "Dark"]]} />
              <label className="flex items-center justify-between">
                <span>Shadow on the floor</span>
                <input type="checkbox" checked={shadows} onChange={(e) => setShadows(e.target.checked)} />
              </label>
              <div className="rounded-lg bg-white/5 p-2.5 text-xs leading-relaxed text-white/70">
                Shortcuts: <b>F</b> fit · <b>H</b> home view · <b>Esc</b> clear · double-click a part to zoom to it. CAD files are assumed to be in millimetres.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Section slider */}
      {ready && section.on && (
        <div className={cx("absolute left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-[#172230]/90 px-3 py-1.5 text-xs text-white", immersive ? "top-[110px]" : "top-3")}>
          <span>Section {section.axis.toUpperCase()}</span>
          <input type="range" min={0} max={100} value={section.at} aria-label="Section position" onChange={(e) => setSection({ ...section, at: Number(e.target.value) })} className="w-40 accent-[#7c94ff]" />
          <span className="num w-8 text-right">{section.at}%</span>
        </div>
      )}

      {/* Toolbar */}
      {ready && (
        <div className={cx("absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 items-end gap-2", compact && "origin-bottom scale-90")} onMouseDown={(e) => e.stopPropagation()}>
          <Group>
            <Tool icon={Rotate3d} label="Orbit (drag to turn)" active={nav === "orbit" && measureMode === "off"} onClick={() => (setNav("orbit"), setMeasureMode("off"))} />
            <Tool icon={Hand} label="Pan (drag to move)" active={nav === "pan" && measureMode === "off"} onClick={() => (setNav("pan"), setMeasureMode("off"))} />
            <Tool icon={ZoomIn} label="Zoom (drag up or down)" active={nav === "zoom" && measureMode === "off"} onClick={() => (setNav("zoom"), setMeasureMode("off"))} />
            <Tool icon={Maximize} label="Fit to view (F)" onClick={() => eng.current?.fit()} />
            <Flyout icon={Cuboid} label="Views" open={menu === "views"} onOpen={() => toggleMenu("views")}>
              <div className="grid grid-cols-2 gap-1">
                {(["home", "front", "back", "top", "bottom", "left", "right"] as ViewName[]).map((v) => (
                  <MenuItem key={v} onClick={() => (eng.current?.view(v), setMenu(null))} className={v === "home" ? "col-span-2" : ""}>
                    {v === "home" && <House className="h-4 w-4" />}
                    <span className="capitalize">{v === "home" ? "Home (3D view)" : v}</span>
                  </MenuItem>
                ))}
              </div>
              <div className="mt-1 border-t border-white/10 pt-1">
                <MenuItem onClick={() => setOrtho(!ortho)} checked={ortho}>
                  Orthographic (no perspective)
                </MenuItem>
              </div>
            </Flyout>
          </Group>

          <Group>
            <Flyout icon={Ruler} label="Measure" active={measureMode !== "off"} open={menu === "measure"} onOpen={() => toggleMenu("measure")}>
              <MenuItem onClick={() => (setMeasureMode("distance"), setMenu(null))} checked={measureMode === "distance"}>
                <Ruler className="h-4 w-4" /> Distance between two points
              </MenuItem>
              <MenuItem onClick={() => (setMeasureMode("angle"), setMenu(null))} checked={measureMode === "angle"}>
                <DraftingCompass className="h-4 w-4" /> Angle from three points
              </MenuItem>
              {measureMode !== "off" && (
                <MenuItem onClick={() => (setMeasureMode("off"), setMenu(null))}>
                  <X className="h-4 w-4" /> Stop measuring
                </MenuItem>
              )}
            </Flyout>
            <Flyout icon={Scissors} label="Section" active={section.on} open={menu === "section"} onOpen={() => toggleMenu("section")}>
              <div className="mb-1 text-xs text-white/60">Cut along</div>
              <div className="flex gap-1">
                {(["x", "y", "z"] as Axis[]).map((a) => (
                  <button key={a} type="button" onClick={() => setSection({ ...section, on: true, axis: a })} className={cx("flex-1 rounded-md py-1.5 text-sm font-semibold", section.on && section.axis === a ? "bg-[#4f6fe0]" : "bg-white/10 hover:bg-white/20")}>
                    {a.toUpperCase()}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex gap-1">
                <MenuItem onClick={() => setSection({ ...section, flip: !section.flip })} checked={section.flip} disabled={!section.on}>
                  Flip side
                </MenuItem>
                <MenuItem onClick={() => setSection({ ...section, on: false })} disabled={!section.on}>
                  Off
                </MenuItem>
              </div>
            </Flyout>
            {multi && (
              <Flyout icon={Expand} label="Explode assembly" active={explode > 0} open={menu === "explode"} onOpen={() => toggleMenu("explode")}>
                <div className="mb-1 flex justify-between text-xs text-white/60">
                  <span>Spread the parts apart</span>
                  <span className="num">{explode}%</span>
                </div>
                <input type="range" min={0} max={100} value={explode} aria-label="Explode amount" onChange={(e) => setExplode(Number(e.target.value))} className="w-56 accent-[#7c94ff]" />
                <MenuItem onClick={() => setExplode(0)} disabled={!explode}>
                  Put back together
                </MenuItem>
              </Flyout>
            )}
            <Flyout icon={Paintbrush} label="Display style" active={style !== "shaded" || cadColors} open={menu === "style"} onOpen={() => toggleMenu("style")}>
              {(
                [
                  ["shaded", "Shaded"],
                  ["edges", "Shaded with edges"],
                  ["wire", "Wireframe"],
                  ["xray", "X-ray (see through)"],
                ] as [Style, string][]
              ).map(([k2, l]) => (
                <MenuItem key={k2} onClick={() => setStyle(k2)} checked={style === k2}>
                  {l}
                </MenuItem>
              ))}
              {hasColors && (
                <div className="mt-1 border-t border-white/10 pt-1">
                  <MenuItem onClick={() => setCadColors(!cadColors)} checked={cadColors}>
                    Design colours from the CAD file
                  </MenuItem>
                </div>
              )}
            </Flyout>
          </Group>

          <Group>
            <Tool icon={ListTree} label="Model tree" active={panel === "tree"} onClick={() => togglePanel("tree")} badge={multi ? parts.length : undefined} />
            <Tool icon={Info} label="Properties: size, area, volume, weight" active={panel === "props"} onClick={() => togglePanel("props")} />
            <Tool icon={Focus} label={selected ? "Zoom to the selected part" : "Zoom to a part: select one first"} disabled={!selected} onClick={() => eng.current?.focus(selected)} />
            <Tool icon={Camera} label="Save a picture of this view" onClick={shot} />
            <Tool icon={Settings2} label="Viewer settings" active={panel === "settings"} onClick={() => togglePanel("settings")} />
            <Tool icon={full ? Minimize2 : Maximize2} label={full ? "Leave full screen" : "Full screen"} onClick={toggleFull} />
          </Group>
        </div>
      )}
    </div>
  );
}

// ── Toolbar pieces ──────────────────────────────────────────────────────────

function Group({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-0.5 rounded-xl bg-[#172230]/92 p-1 shadow-[0_8px_24px_rgba(10,16,24,0.35)] ring-1 ring-white/10 backdrop-blur">{children}</div>;
}

function Tool({ icon: Icon, label, active, onClick, badge, disabled }: { icon: LucideIcon; label: string; active?: boolean; onClick: () => void; badge?: number; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cx("relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors", active ? "bg-[#4f6fe0] text-white shadow-inner" : "text-white/80 hover:bg-white/10 hover:text-white", "disabled:pointer-events-none disabled:opacity-35")}
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
      {badge != null && <span className="num absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-[#F5C518] px-1 text-[10px] font-bold leading-4 text-[#172230]">{badge}</span>}
    </button>
  );
}

/** A toolbar button with a small corner mark that opens a menu above it. */
function Flyout({ icon: Icon, label, active, open, onOpen, children }: { icon: LucideIcon; label: string; active?: boolean; open: boolean; onOpen: () => void; children: ReactNode }) {
  return (
    <div className="relative">
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-expanded={open}
        onClick={onOpen}
        className={cx("relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors", active ? "bg-[#4f6fe0] text-white" : open ? "bg-white/15 text-white" : "text-white/80 hover:bg-white/10 hover:text-white")}
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
        <span aria-hidden className="absolute bottom-1 right-1 h-0 w-0 border-b-[5px] border-l-[5px] border-b-current border-l-transparent opacity-70" />
      </button>
      {open && (
        <div className="absolute bottom-12 left-1/2 w-60 -translate-x-1/2 rounded-xl bg-[#172230]/97 p-2 text-sm text-white shadow-2xl ring-1 ring-white/10">
          <div className="mb-1 px-1 text-xs font-semibold text-white/60">{label}</div>
          {children}
        </div>
      )}
    </div>
  );
}

function MenuItem({ children, onClick, checked, disabled, className }: { children: ReactNode; onClick: () => void; checked?: boolean; disabled?: boolean; className?: string }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={cx("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-white/10 disabled:opacity-40", checked && "text-[#9fb2ff]", className)}>
      {children}
      {checked && <Check className="ml-auto h-4 w-4" />}
    </button>
  );
}

function Choice({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div>
      <div className="mb-1 text-xs text-white/60">{label}</div>
      <div className="flex gap-1 rounded-lg bg-white/5 p-1">
        {options.map(([v, l]) => (
          <button key={v} type="button" onClick={() => onChange(v)} className={cx("flex-1 rounded-md px-2 py-1 text-xs", value === v ? "bg-[#4f6fe0] text-white" : "text-white/75 hover:bg-white/10")}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

function TreePanel({ parts, selected, isolated, onSelect, onFocus, onToggle, onIsolate }: { parts: PartRow[]; selected: string | null; isolated: string | null; onSelect: (id: string) => void; onFocus: (id: string) => void; onToggle: (id: string) => void; onIsolate: (id: string | null) => void }) {
  const [q, setQ] = useState("");
  const shown = parts.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 400);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex gap-1.5 p-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a part" className="min-w-0 flex-1 rounded-md bg-white/10 px-2 py-1 text-sm text-white outline-none placeholder:text-white/40 focus:ring-1 focus:ring-[#7c94ff]" />
        <button type="button" onClick={() => onIsolate(isolated ? null : selected)} disabled={!isolated && !selected} className="rounded-md bg-white/10 px-2 text-xs hover:bg-white/20 disabled:opacity-40">
          {isolated ? "Show all" : "Isolate"}
        </button>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-1 pb-2 text-sm">
        {shown.map((p) => (
          <li key={p.id} className={cx("group flex items-center gap-1.5 rounded-md px-1.5 py-1", selected === p.id ? "bg-[#4f6fe0]/40" : "hover:bg-white/10")}>
            <button type="button" onClick={() => onToggle(p.id)} className="shrink-0 text-white/70 hover:text-white" aria-label={p.visible ? `Hide ${p.name}` : `Show ${p.name}`}>
              {p.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4 opacity-50" />}
            </button>
            <button type="button" onClick={() => onSelect(p.id)} onDoubleClick={() => onFocus(p.id)} className={cx("min-w-0 flex-1 truncate text-left", !p.visible && "opacity-50")} title={`${p.name} · ${p.triangles.toLocaleString()} triangles`}>
              <Boxes className="mr-1.5 inline h-3.5 w-3.5 text-white/50" />
              {p.name}
            </button>
            <button type="button" onClick={() => onFocus(p.id)} className="shrink-0 text-white/40 opacity-0 hover:text-white group-hover:opacity-100" aria-label={`Zoom to ${p.name}`}>
              <Focus className="h-4 w-4" />
            </button>
          </li>
        ))}
        {parts.length > shown.length && !q && <li className="px-2 py-1 text-xs text-white/50">Showing the first 400 parts; search to find others.</li>}
      </ul>
      <p className="border-t border-white/10 px-3 py-2 text-xs text-white/50">Click to select · double-click to zoom · eye to show or hide</p>
    </div>
  );
}

function PropsPanel({ stats, units, density, onDensity, onRefresh }: { stats: Stats | null; units: Units; density: string; onDensity: (d: string) => void; onRefresh: () => void }) {
  if (!stats) return <p className="p-3 text-sm text-white/60">Nothing visible to measure.</p>;
  const inch = units === "in";
  const L = (n: number) => (inch ? n / 25.4 : n);
  const vol = inch ? stats.volume / 16387.064 : stats.volume / 1000; // in³ or cm³
  const area = inch ? stats.area / 645.16 : stats.area / 100; // in² or cm²
  const gcc = DENSITY.find((d) => d.key === density)!.gcc;
  const kg = ((stats.volume / 1000) * gcc) / 1000;
  const row = (k: string, v: string) => (
    <div className="flex justify-between gap-3 py-1">
      <span className="text-white/60">{k}</span>
      <span className="num text-right font-medium">{v}</span>
    </div>
  );
  const f = (n: number, d = 2) => n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
  return (
    <div className="space-y-3 overflow-y-auto p-3 text-sm">
      <div>
        <div className="text-xs text-white/60">Showing</div>
        <div className="truncate font-semibold">{stats.name}</div>
        {stats.parts > 1 && <div className="text-xs text-white/50">{stats.parts} visible parts · select one in the model to see just that part</div>}
      </div>
      <div className="divide-y divide-white/10 rounded-lg bg-white/5 px-3">
        {row("Length (X)", `${f(L(stats.size[0]))} ${units}`)}
        {row("Width (Y)", `${f(L(stats.size[1]))} ${units}`)}
        {row("Height (Z)", `${f(L(stats.size[2]))} ${units}`)}
        {row("Surface area", `${f(area)} ${inch ? "in²" : "cm²"}`)}
        {row("Volume", `${f(vol)} ${inch ? "in³" : "cm³"}`)}
        {row("Triangles", stats.triangles.toLocaleString())}
      </div>
      <div>
        <div className="mb-1 text-xs text-white/60">Weight if made of</div>
        <select value={density} onChange={(e) => onDensity(e.target.value)} className="w-full rounded-md bg-white/10 px-2 py-1.5 text-sm text-white outline-none [&>option]:bg-[#172230]">
          {DENSITY.map((d) => (
            <option key={d.key} value={d.key}>
              {d.label} ({d.gcc} g/cm³)
            </option>
          ))}
        </select>
        <div className="num mt-2 text-2xl font-semibold">
          {kg >= 1 ? `${f(kg)} kg` : `${f(kg * 1000, 1)} g`} <span className="text-sm font-normal text-white/60">({f(kg * 2.20462)} lb)</span>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-white/50">Volume and weight are exact for closed solids from STEP files; open surfaces or meshes give an estimate. Sizes assume the file is in millimetres.</p>
      <button type="button" onClick={onRefresh} className="text-xs text-[#9fb2ff] hover:underline">
        Recalculate
      </button>
    </div>
  );
}
