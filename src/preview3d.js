import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export function createPreview(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a88a0, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-1, -1.5, 2); scene.add(sun);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  const group = new THREE.Group(); scene.add(group);

  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(container);
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

  let framed = false;
  return {
    set(meshes, colors, size, refit) {
      group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
      group.clear();
      meshes.forEach((m, i) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(m.vertices, 3));
        g.setIndex(new THREE.BufferAttribute(m.indices, 1));
        g.computeVertexNormals();
        group.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: colors[i], roughness: 0.55, metalness: 0 })));
      });
      group.position.set(-size[0] / 2, -size[1] / 2, 0);
      if (!framed || refit) {
        const r = Math.max(size[0], size[1]);
        camera.up.set(0, 0, 1);
        camera.position.set(0, -r * 1.25, r * 1.1);
        controls.target.set(0, 0, 0); controls.update();
        framed = true;
      }
      resize();
    },
    resetFrame() { framed = false; },
  };
}
