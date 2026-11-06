import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * The hero's 3D scene: a dotted globe, an atmosphere glow, the SampAudience orbit ring,
 * and arcs that fly out (questions, coral) and come back (answers, teal).
 * Plain three.js, no extra libraries. Pauses when off-screen; static with reduced motion.
 */
export default function GlobeScene({ className }) {
  const mount = useRef(null);

  useEffect(() => {
    const el = mount.current;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let W = el.clientWidth, H = el.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 100);
    camera.position.set(0, 0.25, 9.4);

    const world = new THREE.Group();
    world.rotation.z = -0.18;
    scene.add(world);
    const globe = new THREE.Group();
    world.add(globe);
    const R = 1.75;

    // ── Dotted sphere (Fibonacci lattice) with a "land-ish" density pattern
    const N = 5200;
    const pos = [], col = [];
    const cA = new THREE.Color('#5EEAD4'), cB = new THREE.Color('#14B8A6'), cC = new THREE.Color('#A78BFA');
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = Math.PI * (3 - Math.sqrt(5)) * i;
      const x = Math.cos(th) * r, z = Math.sin(th) * r;
      // pseudo-continents from layered sines: keeps the globe readable without map data
      const n = Math.sin(x * 3.1 + 1.3) * Math.cos(z * 2.7) + Math.sin(y * 4.2 + x * 1.7) * 0.6;
      if (n < 0.05 && Math.random() > 0.18) continue;
      pos.push(x * R, y * R, z * R);
      const c = cA.clone().lerp(cB, Math.random()).lerp(cC, Math.random() < 0.08 ? 0.7 : 0);
      col.push(c.r, c.g, c.b);
    }
    const dotsGeo = new THREE.BufferGeometry();
    dotsGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    dotsGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const dots = new THREE.Points(dotsGeo, new THREE.PointsMaterial({
      size: 0.034, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
    }));
    globe.add(dots);

    // Dark core so back-facing dots are dimmed
    globe.add(new THREE.Mesh(
      new THREE.SphereGeometry(R * 0.985, 64, 64),
      new THREE.MeshBasicMaterial({ color: '#031018' })
    ));
    globe.children[globe.children.length - 1].renderOrder = -1;

    // ── Atmosphere: fresnel rim glow
    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.1, 64, 64),
      new THREE.ShaderMaterial({
        transparent: true, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
        vertexShader: `varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `varying vec3 vN; void main(){ float i = pow(max(0.62 - dot(vN, vec3(0.,0.,1.)), 0.0), 2.4); gl_FragColor = vec4(0.25,0.92,0.82,1.0) * i * 0.9; }`,
      })
    );
    world.add(atmo);

    // ── Orbit ring + satellite (echoes the logo)
    const ringGroup = new THREE.Group();
    ringGroup.rotation.set(1.22, 0.32, -0.42);
    world.add(ringGroup);
    const ringMat = new THREE.MeshBasicMaterial({ color: '#2DD4BF', transparent: true, opacity: 0.75 });
    ringGroup.add(new THREE.Mesh(new THREE.TorusGeometry(R * 1.42, 0.018, 16, 220), ringMat));
    ringGroup.add(new THREE.Mesh(new THREE.TorusGeometry(R * 1.62, 0.006, 8, 220),
      new THREE.MeshBasicMaterial({ color: '#A78BFA', transparent: true, opacity: 0.35 })));
    const sat = new THREE.Mesh(new THREE.SphereGeometry(0.075, 24, 24), new THREE.MeshBasicMaterial({ color: '#ECFEFF' }));
    ringGroup.add(sat);
    const satGlow = makeGlowSprite('#5EEAD4', 0.6);
    sat.add(satGlow);

    // ── Stars
    const starGeo = new THREE.BufferGeometry();
    const sp = [];
    for (let i = 0; i < 900; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(14 + Math.random() * 20);
      sp.push(v.x, v.y, v.z);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 0.05, color: '#9FB4D0', transparent: true, opacity: 0.6 }));
    scene.add(stars);

    // ── Arcs: question goes out (coral), answer comes back (teal)
    const SEG = 80;
    const arcs = [];
    const randOnSphere = () => new THREE.Vector3().randomDirection().multiplyScalar(R);
    function spawnArc(a) {
      const from = randOnSphere();
      const to = randOnSphere();
      if (from.distanceTo(to) < R * 0.6) to.negate().lerp(from, 0.3).setLength(R);
      const mid = from.clone().add(to).multiplyScalar(0.5);
      mid.setLength(R + from.distanceTo(to) * 0.55);
      a.curve = new THREE.QuadraticBezierCurve3(from, mid, to);
      a.geo.setFromPoints(a.curve.getPoints(SEG));
      a.t = -Math.random() * 1.5;
      a.speed = 0.35 + Math.random() * 0.3;
      a.back = Math.random() < 0.5;
      a.mat.color.set(a.back ? '#5EEAD4' : '#FF8A65');
      a.head.material.color.set(a.back ? '#CCFBF1' : '#FFD7C9');
    }
    for (let i = 0; i < 14; i++) {
      const geo = new THREE.BufferGeometry();
      const mat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending });
      const line = new THREE.Line(geo, mat);
      const head = makeGlowSprite('#ffffff', 0.22);
      globe.add(line); globe.add(head);
      const a = { geo, mat, line, head };
      spawnArc(a);
      a.t = Math.random() * 2;
      arcs.push(a);
    }

    // ── Pointer parallax
    let mx = 0, my = 0;
    const onPointer = (e) => { mx = (e.clientX / innerWidth - 0.5); my = (e.clientY / innerHeight - 0.5); };
    addEventListener('pointermove', onPointer);

    const onResize = () => {
      W = el.clientWidth; H = el.clientHeight;
      renderer.setSize(W, H); camera.aspect = W / H; camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(onResize); ro.observe(el);

    let visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0 });
    io.observe(el);

    const clock = new THREE.Clock();
    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!visible) return;
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;
      globe.rotation.y += dt * 0.12;
      world.rotation.x += ((my * 0.35) - world.rotation.x) * 0.04;
      world.rotation.y += ((mx * 0.5) - world.rotation.y) * 0.04;
      stars.rotation.y = t * 0.01;
      const s = t * 0.5;
      sat.position.set(Math.cos(s) * R * 1.42, Math.sin(s) * R * 1.42, 0);

      for (const a of arcs) {
        a.t += dt * a.speed;
        const p = THREE.MathUtils.clamp(a.t, 0, 1);
        const tail = THREE.MathUtils.clamp(a.t - 0.45, 0, 1);
        const start = Math.floor(tail * SEG), end = Math.floor(p * SEG);
        const fromStart = a.back ? SEG - end : start;
        a.geo.setDrawRange(fromStart, Math.max(end - start, 0) + 1);
        const hp = a.back ? 1 - p : p;
        a.head.position.copy(a.curve.getPoint(hp));
        a.head.visible = a.t > 0 && a.t < 1;
        a.mat.opacity = a.t > 1 ? Math.max(0, 0.85 - (a.t - 1) * 2) : 0.85;
        if (a.t > 1.5) spawnArc(a);
      }
      renderer.render(scene, camera);
    };
    if (reduced) {
      arcs.forEach((a) => { a.t = 0.7; a.geo.setDrawRange(0, SEG); a.head.visible = false; });
      renderer.render(scene, camera);
    } else tick();

    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('pointermove', onPointer);
      ro.disconnect(); io.disconnect();
      renderer.dispose();
      scene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
      el.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={mount} className={className} aria-hidden="true" />;
}

function makeGlowSprite(color, scale) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(c), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  s.scale.setScalar(scale);
  return s;
}
