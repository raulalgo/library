import * as THREE from 'three';

// Everything the scene needs before it is first drawn: files loaded, images decoded, shaders compiled and
// textures on the GPU. When the first frame did all of that at once, the page stopped for ~0.7 s. Here it
// happens in short steps, with the page free in between, while the poster (see index.html) stands in for the scene.

// The GLTF, HDR and texture loaders all report to the default manager. This module is imported before
// anything starts loading, so it sees every file.
let busy = false;
const waiting: (() => void)[] = [];
THREE.DefaultLoadingManager.onStart = () => (busy = true);
THREE.DefaultLoadingManager.onLoad = () => {
  busy = false;
  waiting.splice(0).forEach((resolve) => resolve());
};
const settled = () => new Promise<void>((resolve) => (busy ? waiting.push(resolve) : resolve()));
const pause = () => new Promise((resolve) => setTimeout(resolve));

/** `started` resolves once every file the scene loads has been asked for (the island's textures start late). */
export async function warmUp(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, started: Promise<unknown>) {
  await started;
  await settled();
  const textures = new Set<THREE.Texture>();
  scene.traverse((o) => {
    for (const m of [(o as THREE.Mesh).material ?? []].flat())
      for (const v of Object.values(m)) if (v instanceof THREE.Texture && !v.isRenderTargetTexture) textures.add(v);
  });
  // Decoded off the main thread now, instead of on it during each upload.
  await Promise.all([...textures].map((t) => (t.image instanceof HTMLImageElement ? t.image.decode().catch(() => {}) : null)));
  await renderer.compileAsync(scene, camera);
  let t = performance.now();
  for (const texture of textures) {
    renderer.initTexture(texture);
    if (performance.now() - t > 12) {
      await pause();
      t = performance.now();
    }
  }
}
