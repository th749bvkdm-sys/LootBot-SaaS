import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export type Vessel = 'beaker' | 'flask' | 'tube';
type Props = { amount: number; solid: boolean; reacted: boolean; gas: boolean; stir: boolean; night: boolean; angle: number; zoom: number; vessel: Vessel; paused: boolean; speed: number; replay: number; hazardReplay: number; onUnavailable: () => void };

/** All geometry is local. The server decides the reaction; time here is illustrative. */
export default function ChemistryScene3D(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const [lost, setLost] = useState(false);
  useEffect(() => {
    const element = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); }
    catch { props.onUnavailable(); return; }
    const compact = window.matchMedia('(max-width: 650px)').matches;
    renderer.setPixelRatio(Math.min(Math.max(window.devicePixelRatio, 1.5), compact ? 1.5 : 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = .85;
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#415867');
    const camera = new THREE.PerspectiveCamera(36, 1, .1, 50);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.1, 0);
    function positionCamera(angle: number, zoom: number) {
      const a = angle * Math.PI / 180 + .55;
      camera.position.set(Math.sin(a) * 6.15 / zoom, 2.85 / zoom, Math.cos(a) * 6.15 / zoom);
      camera.lookAt(controls.target);
    }
    positionCamera(props.angle, props.zoom);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 3.4;
    controls.maxDistance = 11;
    controls.minPolarAngle = Math.PI * .2;
    controls.maxPolarAngle = Math.PI * .48;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const environment = pmrem.fromScene(room, .015);
    scene.environment = environment.texture;
    room.dispose();
    pmrem.dispose();
    const ambient = new THREE.HemisphereLight('#effbff', '#465868', 2);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight('#fff4df', 4);
    sun.position.set(-4, 7, 4); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -4; sun.shadow.camera.right = 4;
    sun.shadow.camera.top = 4; sun.shadow.camera.bottom = -4;
    sun.shadow.bias = -.0005;
    sun.shadow.normalBias = .02;
    scene.add(sun);
    const rim = new THREE.PointLight('#aee8ff', 18, 15);
    rim.position.set(3, 4, -3); scene.add(rim);
    const mat = (color: string, roughness = .5, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
    function box(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh); return mesh;
    }
    // A matte epoxy bench avoids the broad reflections that washed out the old view.
    const grainCanvas = document.createElement('canvas');
    grainCanvas.width = grainCanvas.height = 256;
    const grainContext = grainCanvas.getContext('2d')!;
    const grainPixels = grainContext.createImageData(256, 256);
    let grainSeed = 0x5eed;
    for (let i = 0; i < 256 * 256; i++) {
      grainSeed ^= grainSeed << 13; grainSeed ^= grainSeed >>> 17; grainSeed ^= grainSeed << 5;
      const grain = (grainSeed >>> 0) % 13 - 6;
      grainPixels.data.set([36 + grain, 46 + grain, 55 + grain, 255], i * 4);
    }
    grainContext.putImageData(grainPixels, 0, 0);
    const benchTexture = new THREE.CanvasTexture(grainCanvas);
    benchTexture.colorSpace = THREE.SRGBColorSpace;
    benchTexture.wrapS = benchTexture.wrapT = THREE.RepeatWrapping;
    benchTexture.repeat.set(5, 4);
    benchTexture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    const benchMaterial = new THREE.MeshStandardMaterial({ map: benchTexture, roughness: .78, metalness: .04, envMapIntensity: .3 });
    box(7.8, .22, 5.8, benchMaterial, 0, -.12, 0);
    box(7.8, .12, .055, mat('#738d9a', .32, .55), 0, -.16, 2.9);
    box(7.5, .36, 5.55, mat('#172532', .8), 0, -.4, 0);
    box(12, 5, .15, mat('#435c6b', .85), 0, 2.3, -4);
    box(4.3, 2.5, .08, mat('#95b9c6', .65), -2.7, 2.7, -3.88);
    box(.05, 2.5, .1, mat('#5a7784'), -2.7, 2.7, -3.8);
    box(4.3, .05, .1, mat('#5a7784'), -2.7, 2.7, -3.8);
    box(3.4, .1, .7, mat('#506774', .35), 3.1, 2.4, -3.4);
    const glass = new THREE.MeshPhysicalMaterial({ color: '#f5ffff', transmission: .98, opacity: 1, roughness: .008, metalness: 0, ior: 1.47, thickness: .035, side: THREE.DoubleSide, envMapIntensity: .8 });
    const glassEdge = mat('#a9d5e1', .14, .35);
    const workPad = box(2.65, .035, 2.4, mat('#101d27', .95), 0, .009, 0);
    workPad.castShadow = false;
    // Fine ruled lines make the work surface legible without implying measured volume.
    const guideMaterial = mat('#29404e', .9);
    for (let i = -4; i <= 4; i++) {
      box(2.4, .001, .007, guideMaterial, 0, .028, i * .25);
      box(.007, .001, 2.15, guideMaterial, i * .28, .028, 0);
    }
    for (let i = 0; i < 4; i++) {
      const bottle = new THREE.Mesh(new THREE.CylinderGeometry(.18, .22, .6, 24), mat(i % 2 ? '#a09373' : '#718f93', .2));
      bottle.position.set(1.9 + i * .7, 2.75, -3.4); scene.add(bottle);
      box(.3, .09, .3, mat('#313d48'), bottle.position.x, 3.09, -3.4);
      box(.23, .22, .015, mat('#ecece3'), bottle.position.x, 2.76, -3.16);
    }
    // Instrument stand and a small secondary vessel establish scale and depth.
    box(.6, .09, .8, mat('#647783', .25, .7), -2.1, .04, -.8);
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, 2.9, 12), mat('#b2bcc5', .2, .85));
    stand.position.set(-2.1, 1.5, -.8); scene.add(stand);
    box(.7, .04, .04, mat('#b2bcc5', .2, .85), -1.8, 2.1, -.8);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(.32, .3, .7, 32, 1, true), glass);
    cup.position.set(2.2, .36, .4); scene.add(cup);
    const vesselGroup = new THREE.Group(); scene.add(vesselGroup);
    const waterGroup = new THREE.Group(); scene.add(waterGroup);
    const effects = new THREE.Group(); scene.add(effects);
    // Generic, non-chemical safety vignette. It is user-triggered and never
    // inferred from reactants or presented as a real reaction.
    const hazardEffects = new THREE.Group(); scene.add(hazardEffects);
    const hazardFlashMaterial = new THREE.MeshBasicMaterial({ color: '#fff0c4', transparent: true, opacity: 0, depthWrite: false });
    const hazardFlash = new THREE.Mesh(new THREE.SphereGeometry(.72, 24, 16), hazardFlashMaterial);
    hazardFlash.position.set(0, 1.45, 0); hazardFlash.renderOrder = 20; hazardEffects.add(hazardFlash);
    const pressureMaterial = new THREE.MeshBasicMaterial({ color: '#ffd99a', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    const pressureWave = new THREE.Mesh(new THREE.TorusGeometry(.42, .025, 8, 80), pressureMaterial);
    pressureWave.rotation.x = Math.PI / 2; pressureWave.position.y = .12; pressureWave.renderOrder = 19; hazardEffects.add(pressureWave);
    const smokeMaterial = new THREE.MeshStandardMaterial({ color: '#87919a', transparent: true, opacity: 0, roughness: 1, depthWrite: false });
    const smokeGeometry = new THREE.SphereGeometry(1, 12, 10);
    const smoke = Array.from({ length: 14 }, (_, i) => {
      const puff = new THREE.Mesh(smokeGeometry, smokeMaterial);
      puff.userData.phase = i / 14;
      puff.userData.offset = new THREE.Vector3(Math.sin(i * 17.3) * .52, (i % 5) * .12, Math.cos(i * 11.7) * .52);
      puff.renderOrder = 18; hazardEffects.add(puff); return puff;
    });
    const waterMaterial = new THREE.MeshPhysicalMaterial({ color: '#b6ced6', roughness: .12, metalness: .06, transparent: true, opacity: .38, side: THREE.DoubleSide, depthWrite: false });
    const surfaceMaterial = new THREE.MeshPhysicalMaterial({ color: '#c4e1e7', transparent: true, opacity: .42, roughness: .12, side: THREE.DoubleSide, depthWrite: false });
    const meniscusMaterial = new THREE.MeshStandardMaterial({ color: '#a5c6cd', roughness: .12, metalness: .3 });
    const powderMaterial = mat('#ede8d6', .85);
    const markMaterial = mat('#deedf0', .45);
    // Opaque reflective highlights are included in the glass transmission pass.
    // Transparent particles would be hidden behind the transmissive vessel wall.
    const bubbleMaterial = new THREE.MeshPhysicalMaterial({ color: '#d0e6ed', metalness: .65, roughness: .08, envMapIntensity: 1.5 });
    const bubbleGeometry = new THREE.SphereGeometry(1, 12, 8);
    const bubbles = Array.from({ length: 40 }, (_, i) => {
      const mesh = new THREE.Mesh(bubbleGeometry, bubbleMaterial);
      mesh.scale.setScalar(.015 + (i % 6) * .006); effects.add(mesh); return mesh;
    });
    const powder = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.023, 0), powderMaterial, 90);
    effects.add(powder);
    const dummy = new THREE.Object3D();
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, 3, 12), glass);
    scene.add(rod);
    const rings = Array.from({ length: 4 }, () => {
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(.3, .004, 5, 48), surfaceMaterial);
      mesh.rotation.x = -Math.PI / 2; effects.add(mesh); return mesh;
    });
    let surface: THREE.Mesh | undefined;
    let currentVessel = '';
    let currentAmount = -1;
    let radius = .78, waterHeight = 0;
    function clear(group: THREE.Group) {
      for (const child of [...group.children]) {
        group.remove(child);
        if (child instanceof THREE.Mesh) child.geometry.dispose();
      }
    }
    const profiles: Record<Vessel, number[][]> = {
      beaker: [[.78,.05],[.81,.12],[.82,2.15],[.85,2.17],[.85,2.23],[.79,2.23],[.78,.12],[.72,.08]],
      flask: [[.76,.05],[.84,.13],[.84,.28],[.7,.8],[.4,1.55],[.25,1.9],[.25,2.35],[.29,2.35],[.29,2.42],[.21,2.42],[.21,1.9],[.36,1.53],[.66,.8],[.78,.26],[.7,.08]],
      tube: [[.02,.05],[.26,.12],[.34,.32],[.34,2.45],[.38,2.45],[.38,2.5],[.3,2.5],[.3,.34],[.22,.17],[.02,.1]],
    };
    function updateVessel(p: Props) {
      clear(vesselGroup); clear(waterGroup);
      const vessel = new THREE.Mesh(new THREE.LatheGeometry(profiles[p.vessel].map(([r,y]) => new THREE.Vector2(r,y)), 72), glass);
      vesselGroup.add(vessel);
      const lipRadius = p.vessel === 'tube' ? .34 : p.vessel === 'flask' ? .25 : .82;
      const lipHeight = p.vessel === 'tube' ? 2.48 : p.vessel === 'flask' ? 2.385 : 2.2;
      const lip = new THREE.Mesh(new THREE.TorusGeometry(lipRadius, .012, 8, 72), glassEdge);
      lip.rotation.x = Math.PI / 2; lip.position.y = lipHeight; vesselGroup.add(lip);
      // Opaque calibration marks sit just outside the glass wall.
      if (p.vessel === 'beaker') for (let i = 0; i < 6; i++) {
        const mark = new THREE.Mesh(new THREE.BoxGeometry(.2, .019, .008), markMaterial);
        mark.position.set(.22, .4 + i * .26, .791); vesselGroup.add(mark);
      }
      waterHeight = p.amount ? Math.min(1.6, .38 + p.amount * .5) : .08;
      radius = p.vessel === 'tube' ? .285 : p.vessel === 'flask' ? Math.max(.26, .79 - Math.max(0, waterHeight - .3) * .43) : .765;
      const bottomRadius = p.vessel === 'tube' ? .26 : .74;
      if (p.amount) {
        const liquid = new THREE.Mesh(new THREE.CylinderGeometry(radius, bottomRadius, waterHeight - .1, 64, 1, true), waterMaterial);
        liquid.position.y = (waterHeight + .1) / 2; liquid.renderOrder = 5; waterGroup.add(liquid);
        surface = new THREE.Mesh(new THREE.CircleGeometry(radius, 64), surfaceMaterial);
        surface.rotation.x = -Math.PI / 2; surface.position.y = waterHeight; surface.renderOrder = 6; waterGroup.add(surface);
        const meniscus = new THREE.Mesh(new THREE.TorusGeometry(radius, .008, 8, 64), meniscusMaterial);
        meniscus.rotation.x = -Math.PI / 2; meniscus.position.y = waterHeight; waterGroup.add(meniscus);
      } else surface = undefined;
      currentVessel = p.vessel; currentAmount = p.amount;
    }
    const observer = new ResizeObserver(() => {
      const width = element.clientWidth, height = element.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
    }); observer.observe(element);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let time = 0, reactionTime = 0, wasReacted = false, replay = props.replay, previous = performance.now();
    let hazardReplay = props.hazardReplay, hazardStarted = -Infinity;
    let angle = props.angle, zoom = props.zoom;
    let frame = 0, lastRender = 0;
    function animate(now: number) {
      frame = requestAnimationFrame(animate);
      if (now - lastRender < 32) return;
      lastRender = now;
      const p = latest.current;
      const dt = Math.min((now - previous) / 1000, .05); previous = now;
      if (p.hazardReplay !== hazardReplay) { hazardReplay = p.hazardReplay; hazardStarted = now; }
      if (p.vessel !== currentVessel || p.amount !== currentAmount) updateVessel(p);
      if (p.reacted !== wasReacted || p.replay !== replay) { reactionTime = 0; wasReacted = p.reacted; replay = p.replay; }
      if (!p.paused && !motion.matches) { time += dt * p.speed; if (p.reacted) reactionTime += dt * p.speed; }
      if (angle !== p.angle || zoom !== p.zoom) {
        positionCamera(p.angle, p.zoom);
        angle = p.angle; zoom = p.zoom;
      }
      scene.background = new THREE.Color(p.night ? '#101c30' : '#415867');
      scene.environmentIntensity = p.night ? .25 : .55;
      ambient.intensity = p.night ? .4 : .8; sun.intensity = p.night ? .65 : 2.2;
      const clearing = p.reacted ? Math.max(0, 1 - reactionTime / 7) : 1;
      waterMaterial.color.set(p.solid ? '#e4e1d2' : '#cadfe4');
      waterMaterial.opacity = p.solid ? .38 + clearing * .3 : .38;
      powder.visible = p.solid && !!p.amount && clearing > .01;
      for (let i = 0; i < 90; i++) {
        const a = i * 2.399 + (p.stir ? time * .8 : 0);
        const r = Math.sqrt((i + .5) / 90) * Math.min(radius, .7) * .85;
        dummy.position.set(Math.cos(a) * r, .15 + (p.stir ? (Math.sin(time + i) + 1) * Math.min(waterHeight * .35, .4) : (i % 3) * .025), Math.sin(a) * r);
        dummy.rotation.set(i, time * .1 + i, i * .5); dummy.scale.setScalar(clearing);
        dummy.updateMatrix(); powder.setMatrixAt(i, dummy.matrix);
      } powder.instanceMatrix.needsUpdate = true;
      bubbles.forEach((bubble, i) => {
        bubble.visible = !!p.gas && p.amount > 0 && (motion.matches || reactionTime < 14);
        const phase = motion.matches ? (i % 10) / 10 : (reactionTime * (.32 + (i % 7) * .04) + i * .139) % 1;
        const a = i * 2.399;
        bubble.position.set(Math.cos(a) * radius * .62 + Math.sin(time * 2 + i) * .025, .17 + phase * Math.max(.1, waterHeight - .19), Math.sin(a) * radius * .62);
      });
      if (surface) { surface.rotation.x = -Math.PI / 2 + (p.stir && !motion.matches ? Math.sin(time * 3) * .018 : 0); }
      rod.visible = p.stir && p.amount > 0;
      rod.position.set(Math.sin(time * 2) * radius * .45, 1.7, Math.cos(time * 2) * radius * .45); rod.rotation.z = .12;
      rings.forEach((ring, i) => {
        const phase = (time * .7 + i * .25) % 1;
        ring.visible = p.amount > 0 && !motion.matches && (p.stir || (!!p.gas && reactionTime < 14));
        ring.position.set(0, waterHeight + .005, 0); ring.scale.setScalar(.1 + phase * radius * 2.8);
      });
      const hazardAge = (now - hazardStarted) / 1000;
      const hazardActive = hazardAge >= 0 && hazardAge < 2.7;
      hazardEffects.visible = hazardActive;
      if (hazardActive) {
        const age = motion.matches ? 1.2 : hazardAge;
        hazardFlash.scale.setScalar(.55 + Math.min(age, .55) * 1.3);
        hazardFlashMaterial.opacity = motion.matches ? .12 : .52 * Math.max(0, 1 - age / .22);
        pressureWave.scale.set(.4 + age * 2.7, .4 + age * 2.7, 1);
        pressureMaterial.opacity = motion.matches ? .18 : .42 * Math.max(0, 1 - age / 2.7);
        smoke.forEach((puff, i) => {
          const phase = (age / 2.7 + puff.userData.phase) % 1;
          const offset = puff.userData.offset as THREE.Vector3;
          puff.position.set(offset.x * (1 + phase), 1.05 + phase * 1.7, offset.z * (1 + phase));
          puff.scale.setScalar(.12 + phase * .32 + (i % 3) * .04);
        });
        smokeMaterial.opacity = motion.matches ? .12 : .2 * Math.max(0, 1 - age / 3.4);
      } else {
        hazardFlashMaterial.opacity = 0; pressureMaterial.opacity = 0; smokeMaterial.opacity = 0;
      }
      controls.update(); renderer.render(scene, camera);
    }
    const contextLost = (event: Event) => { event.preventDefault(); setLost(true); latest.current.onUnavailable(); };
    renderer.domElement.addEventListener('webglcontextlost', contextLost);
    frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); controls.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      const materials = new Set<THREE.Material>(); const geometries = new Set<THREE.BufferGeometry>();
      scene.traverse(object => { if (object instanceof THREE.Mesh) { geometries.add(object.geometry); (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => materials.add(m)); } });
      [glass, glassEdge, waterMaterial, surfaceMaterial, powderMaterial, bubbleMaterial, markMaterial, meniscusMaterial, hazardFlashMaterial, pressureMaterial, smokeMaterial].forEach(m => materials.add(m));
      geometries.add(smokeGeometry);
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); benchTexture.dispose(); environment.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
    // Scene is persistent; latest props are consumed by the animation loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div className="chem-webgl" ref={host} role="img" aria-label="مختبر ثلاثي الأبعاد: وعاء زجاجي وسائل ومواد على طاولة. مشهد موجة الضغط تمثيل توعوي عام وليس ناتجًا كيميائيًا. اسحب لتدوير الكاميرا واستخدم العجلة أو إصبعين للتكبير.">{lost && <p>تعذر استمرار العرض ثلاثي الأبعاد.</p>}</div>;
}
