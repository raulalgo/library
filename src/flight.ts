import * as THREE from 'three';

// The open views lift something out of the scene: a print off the worktop, a book's cover off the shelf. It
// flies up to its place on the page as a DOM element, and back down on close.
//
// The element is drawn with a CSS 3D transform in the scene camera's perspective, so where the flight starts it
// covers its object exactly, and the object in the scene is hidden while the element is up. The browser then
// interpolates rotation, scale and position between where the object lies and the element's place on the page.

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;

// three.js has y up, CSS has y down.
const flipY = new THREE.Matrix4().makeScale(1, -1, 1);

/**
 * An element's transform, given its pose in "screen space": x / y in px from where the camera's axis meets the
 * screen (it is off-centre: the camera uses lens shift), z in px toward the viewer, who sits at z = f.
 * The pose is relative to the element's centre in the layout, which is where CSS puts its transform origin.
 */
function transform(
  el: HTMLElement,
  camera: THREE.PerspectiveCamera,
  pose: (f: number, fromAxis: THREE.Vector2) => THREE.Matrix4,
) {
  const P = camera.projectionMatrix.elements;
  const box = canvas.getBoundingClientRect();
  const f = (P[5] * box.height) / 2; // focal length in px
  const axis = new THREE.Vector2(box.left + (box.width / 2) * (1 - P[8]), box.top + (box.height / 2) * (1 + P[9]));
  // The element's offset ignores its own transform; its offset parent has none.
  const parent = el.offsetParent as HTMLElement;
  const at = parent.getBoundingClientRect();
  const centre = new THREE.Vector2(
    at.left + el.offsetLeft - parent.scrollLeft + el.offsetWidth / 2,
    at.top + el.offsetTop - parent.scrollTop + el.offsetHeight / 2,
  );
  const fromAxis = centre.clone().sub(axis);
  // Both ends of a flight use this same list of functions, so the browser interpolates them one by one:
  // the translate and perspective stay put and only the matrix (rotation, scale, position) moves.
  return `translate(${-fromAxis.x}px, ${-fromAxis.y}px) perspective(${f}px) matrix3d(${pose(f, fromAxis).elements.join(',')})`;
}

/**
 * Where a face of `object` lies in the scene, as the camera sees it. `face` takes the element (px from its
 * centre: x right, y down, z out of its face) to the object's own coordinates.
 */
export function inScene(el: HTMLElement, object: THREE.Object3D, face: THREE.Matrix4, camera: THREE.PerspectiveCamera) {
  return transform(el, camera, (f) => {
    camera.updateMatrixWorld();
    object.updateWorldMatrix(true, false);
    const inCamera = new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse, object.matrixWorld).multiply(face);
    // Scale the scene so the face's centre sits in the screen plane; the element then travels across the screen.
    const s = f / -inCamera.elements[14];
    return new THREE.Matrix4()
      .makeTranslation(0, 0, f)
      .multiply(new THREE.Matrix4().makeScale(s, s, s))
      .multiply(flipY)
      .multiply(inCamera);
  });
}

/** The element's own place on the page, turned `tilt` degrees. */
export function onPage(el: HTMLElement, camera: THREE.PerspectiveCamera, tilt = 0) {
  return transform(el, camera, (_, fromAxis) =>
    new THREE.Matrix4()
      .makeTranslation(fromAxis.x, fromAxis.y, 0)
      .multiply(new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(tilt))),
  );
}
