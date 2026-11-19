/**
 * In-browser 3D part viewer. Reads STEP/IGES/BREP (via the OpenCascade WASM build in
 * occt-import-js, loaded unmodified as a separate file — LGPL), and STL, OBJ, GLB/GLTF,
 * 3MF and PLY via three.js loaders. Tools: fit, standard views, section plane, wireframe,
 * point-to-point measure, and the part's overall size.
 */
import { Box, Crosshair, Eye, Layers, Palette, Ruler, Scissors } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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

type OcctMesh = { attributes: { position: { array: number[] }; normal?: { array: number[] } }; index?: { array: number[] }; color?: [number, number, number] };
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

type Tool = "orbit" | "measure";
/** How close (in screen pixels) a click must be to a corner to snap to it. */
const SNAP_PX = 14;

export default function Viewer3D({ url, name, prepared = false, compact = false, thumbId, immersive = false }: { url: string; name: string; prepared?: boolean; compact?: boolean; thumbId?: string; immersive?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const tag = useRef<HTMLDivElement>(null);
  const api = useRef<{
    fit: () => void;
    view: (v: "iso" | "front" | "top" | "right") => void;
    section: (on: boolean, at: number) => void;
    wire: (on: boolean) => void;
    colors: (on: boolean) => void;
    setTool: (t: Tool) => void;
  } | null>(null);
  const [state, setState] = useState<{ loading: boolean; error: string | null; size: [number, number, number] | null }>({ loading: true, error: null, size: null });
  const [tool, setTool] = useState<Tool>("orbit");
  const [section, setSection] = useState<{ on: boolean; at: number }>({ on: false, at: 50 });
  const [wire, setWire] = useState(false);
  const [cadColors, setCadColors] = useState(false);
  const [hasColors, setHasColors] = useState(false);
  const [measure, setMeasure] = useState<{ d: number; dx: number; dy: number; dz: number } | null>(null);
  const [hint, setHint] = useState<string | null>(null);

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
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1e6);
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
    let bbox = new THREE.Box3();
    let currentTool: Tool = "orbit";
    const picks: THREE.Vector3[] = [];
    const markers = new THREE.Group();
    scene.add(markers);

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const place = (dir: THREE.Vector3) => {
      const size = bbox.getSize(new THREE.Vector3());
      const center = bbox.getCenter(new THREE.Vector3());
      const radius = size.length() / 2 || 1;
      const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.08;
      camera.position.copy(center).add(dir.clone().normalize().multiplyScalar(dist));
      camera.near = dist / 1000;
      camera.far = dist * 100;
      camera.updateProjectionMatrix();
      controls.target.copy(center);
      controls.update();
      key.position.copy(center).add(new THREE.Vector3(1, 2, 1.5).multiplyScalar(radius * 3));
      key.target.position.copy(center);
      fill.position.copy(center).add(new THREE.Vector3(-2, 0.5, -1).multiplyScalar(radius * 3));
    };
    const DIRS = { iso: new THREE.Vector3(1, 0.8, 1.2), front: new THREE.Vector3(0, 0, 1), top: new THREE.Vector3(0, 1, 0.0001), right: new THREE.Vector3(1, 0, 0) };

    const raycaster = new THREE.Raycaster();
    let downAt: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      downAt = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (!downAt) return;
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      downAt = null;
      if (moved < 6) pick(e);
    };
    const pick = (e: PointerEvent) => {
      if (currentTool !== "measure" || !part) return;
      const r = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObject(part, true)[0];
      if (!hit) {
        setHint("Click on the part itself, not the background");
        return;
      }
      if (picks.length === 2) {
        picks.length = 0;
        markers.clear();
      }
      // Snap to the nearest corner of the clicked triangle when the click is close to it,
      // so edge-to-edge and corner-to-corner sizes come out exact.
      let point = hit.point.clone();
      const mesh = hit.object as THREE.Mesh;
      const pos = mesh.geometry?.getAttribute?.("position");
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
      const dot = new THREE.Mesh(new THREE.SphereGeometry(bbox.getSize(new THREE.Vector3()).length() / 140, 16, 16), new THREE.MeshBasicMaterial({ color: 0xf5c518, depthTest: false }));
      dot.position.copy(point);
      dot.renderOrder = 10;
      markers.add(dot);
      if (picks.length === 2) {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(picks), new THREE.LineBasicMaterial({ color: 0xf5c518, depthTest: false }));
        line.renderOrder = 10;
        markers.add(line);
        const [a, b] = picks as [THREE.Vector3, THREE.Vector3];
        // Same axes as "Overall size": CAD X, Y, Z (the scene is Y-up).
        setMeasure({ d: a.distanceTo(b), dx: Math.abs(a.x - b.x), dy: Math.abs(a.z - b.z), dz: Math.abs(a.y - b.y) });
        setHint("Click again to start a new measurement · Esc to clear");
      } else {
        setMeasure(null);
        setHint("Now click the second point");
      }
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || currentTool !== "measure" || !picks.length) return;
      picks.length = 0;
      markers.clear();
      setMeasure(null);
      setHint("Click the first point on the part");
    };
    window.addEventListener("keydown", onKey);

    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      // Keep the distance label pinned to the middle of the measured line.
      const t = tag.current;
      if (t) {
        if (picks.length === 2) {
          const m = picks[0]!.clone().add(picks[1]!).multiplyScalar(0.5).project(camera);
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
        obj.traverse((c) => {
          if (c instanceof THREE.Mesh) {
            c.castShadow = true;
            c.receiveShadow = true;
          }
        });
        scene.add(obj);
        part = obj;
        bbox = new THREE.Box3().setFromObject(obj);
        const size = bbox.getSize(new THREE.Vector3());
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(size.length() * 6, size.length() * 6), new THREE.ShadowMaterial({ opacity: dark ? 0.35 : 0.16 }));
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = bbox.min.y - size.y * 0.002;
        ground.receiveShadow = true;
        scene.add(ground);
        const sc = key.shadow.camera as THREE.OrthographicCamera;
        const half = size.length();
        Object.assign(sc, { left: -half, right: half, top: half, bottom: -half, near: 0.01, far: half * 12 });
        sc.updateProjectionMatrix();
        place(DIRS.iso);
        // Sizes in the model's own units (CAD exports are almost always millimetres).
        const s = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
        let colored = false;
        obj.traverse((c) => {
          if (c instanceof THREE.Mesh && c.userData.cadColor) colored = true;
        });
        setHasColors(colored);
        setState({ loading: false, error: null, size: [s.x, s.z, s.y] });
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

    api.current = {
      fit: () => place(camera.position.clone().sub(controls.target)),
      view: (v) => place(DIRS[v]),
      section: (on, at) => {
        if (!part) return;
        clip.constant = THREE.MathUtils.lerp(bbox.min.x, bbox.max.x, at / 100);
        part.traverse((c) => {
          if (c instanceof THREE.Mesh) (c.material as THREE.Material).clippingPlanes = on ? [clip] : [];
        });
      },
      colors: (on) =>
        part?.traverse((c) => {
          if (c instanceof THREE.Mesh) (c.material as THREE.MeshStandardMaterial).color.copy(on && c.userData.cadColor ? c.userData.cadColor : STEEL.color);
        }),
      wire: (on) =>
        part?.traverse((c) => {
          if (c instanceof THREE.Mesh) (c.material as THREE.MeshStandardMaterial).wireframe = on;
        }),
      setTool: (t) => {
        currentTool = t;
        // While measuring, the mouse picks points instead of turning the part.
        controls.enabled = t !== "measure";
        renderer.domElement.style.cursor = t === "measure" ? "crosshair" : "grab";
        if (t !== "measure") {
          picks.length = 0;
          markers.clear();
        }
      },
    };

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
      controls.dispose();
      scene.traverse((c) => {
        if (c instanceof THREE.Mesh) {
          c.geometry.dispose();
          (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [url, name, prepared]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => api.current?.section(section.on, section.at), [section]);
  useEffect(() => api.current?.wire(wire), [wire]);
  useEffect(() => api.current?.colors(cadColors), [cadColors]);
  useEffect(() => {
    api.current?.setTool(tool);
    setMeasure(null);
    setHint(tool === "measure" ? "Click the first point on the part" : null);
  }, [tool]);

  const btn = (active: boolean) =>
    cx("flex h-9 w-9 items-center justify-center rounded-lg transition-colors", active ? "bg-[#4f6fe0] text-white" : "text-white/85 hover:bg-white/10 hover:text-white");
  const fmt = (n: number) => (n >= 100 ? n.toFixed(1) : n.toFixed(2));

  return (
    <div className="relative h-full min-h-[320px] w-full overflow-hidden rounded-xl bg-[radial-gradient(ellipse_at_center,var(--panel)_0%,var(--panel-2)_75%)]">
      <div ref={host} className="absolute inset-0" />
      {state.loading && <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">Loading model…</div>}
      {state.error && <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-bad">{state.error}</div>}
      {state.size && (
        <div className={cx("num pointer-events-none absolute rounded-lg bg-panel/85 px-2.5 py-1.5 text-xs shadow-panel backdrop-blur", immersive ? "bottom-4 left-4" : "left-3 top-3")}>
          <div className="text-muted">Overall size</div>
          <div className="font-medium">
            {fmt(state.size[0])} × {fmt(state.size[1])} × {fmt(state.size[2])}
          </div>
          {measure && (
            <div className="mt-1.5 border-t border-line pt-1.5">
              <div className="text-sm font-semibold text-ink">Measured {fmt(measure.d)} mm</div>
              <div className="text-muted">
                X {fmt(measure.dx)} · Y {fmt(measure.dy)} · Z {fmt(measure.dz)}
              </div>
            </div>
          )}
        </div>
      )}
      <div ref={tag} className="num pointer-events-none absolute hidden -translate-x-1/2 -translate-y-[130%] rounded-md bg-[#F5C518] px-2 py-0.5 text-sm font-semibold text-[#172230] shadow-lg">
        {measure ? `${fmt(measure.d)} mm` : ""}
      </div>
      {(hint || section.on || wire || cadColors) && !state.loading && !state.error && (
        <div className="pointer-events-none absolute bottom-16 left-1/2 -translate-x-1/2 rounded-lg bg-[#172230]/85 px-3 py-1.5 text-xs text-white">
          {hint ?? [section.on && "Section view: drag the slider at the top right", wire && "Wireframe on", cadColors && "Design colours on"].filter(Boolean).join(" · ")}
        </div>
      )}
      {!state.loading && !state.error && (
        <div className={cx("absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl bg-[#172230]/90 p-1 shadow-xl", compact && "scale-90")}>
          <button type="button" title="Rotate" aria-label="Rotate" className={btn(tool === "orbit")} onClick={() => setTool("orbit")}>
            <Crosshair className="h-4 w-4" />
          </button>
          <button type="button" title="Measure: click two points" aria-label="Measure" className={btn(tool === "measure")} onClick={() => setTool(tool === "measure" ? "orbit" : "measure")}>
            <Ruler className="h-4 w-4" />
          </button>
          <button type="button" title="Section view" aria-label="Section view" className={btn(section.on)} onClick={() => setSection((s) => ({ ...s, on: !s.on }))}>
            <Scissors className="h-4 w-4" />
          </button>
          <button type="button" title="Wireframe" aria-label="Wireframe" className={btn(wire)} onClick={() => setWire((w) => !w)}>
            <Layers className="h-4 w-4" />
          </button>
          {hasColors && (
            <button type="button" title="Show design colours" aria-label="Show design colours" aria-pressed={cadColors} className={btn(cadColors)} onClick={() => setCadColors((v) => !v)}>
              <Palette className="h-4 w-4" />
            </button>
          )}
          <span className="mx-1 h-5 w-px bg-white/20" />
          {(["iso", "front", "top", "right"] as const).map((v) => (
            <button key={v} type="button" title={`${v} view`} className="h-9 rounded-lg px-2 text-xs capitalize text-white/85 hover:bg-white/10 hover:text-white" onClick={() => api.current?.view(v)}>
              {v === "iso" ? <Box className="h-4 w-4" /> : v}
            </button>
          ))}
          <button type="button" title="Fit to view" aria-label="Fit to view" className={btn(false)} onClick={() => api.current?.fit()}>
            <Eye className="h-4 w-4" />
          </button>
        </div>
      )}
      {section.on && (
        <input
          type="range"
          min={0}
          max={100}
          value={section.at}
          aria-label="Section position"
          onChange={(e) => setSection({ on: true, at: Number(e.target.value) })}
          className="absolute right-3 top-3 w-36 accent-[var(--accent)]"
        />
      )}
    </div>
  );
}
