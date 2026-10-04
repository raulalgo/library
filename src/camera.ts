import * as THREE from 'three';
import gsap from 'gsap';
import { config } from './config';
import { ISLAND_BOX, SHELF_BOX } from './scene/island';

/**
 * Perspective camera with lens shift: the frustum is moved instead of the camera
 * turning, so the tilt stays fixed and vertical lines keep their angle.
 * shiftX / shiftY are fractions of the view width / height.
 */
export class ShiftCamera extends THREE.PerspectiveCamera {
  shiftX = 0;
  shiftY = 0;

  updateProjectionMatrix() {
    const near = this.near;
    const top0 = (near * Math.tan(THREE.MathUtils.DEG2RAD * 0.5 * this.fov)) / this.zoom;
    const height = 2 * top0;
    const width = this.aspect * height;
    const left = -0.5 * width + (this.shiftX ?? 0) * width;
    const top = top0 + (this.shiftY ?? 0) * height;
    this.projectionMatrix.makePerspective(left, left + width, top, top - height, near, this.far);
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }
}

type Frame = { target: THREE.Vector3; d: number; elevDeg: number; screenY: number };

/** Place a camera at a fixed tilt, d metres from the target, raised by an elevation angle. */
function pose(cam: ShiftCamera, target: THREE.Vector3, d: number, elevDeg: number) {
  const tilt = THREE.MathUtils.degToRad(config.tiltDeg);
  const forward = new THREE.Vector3(0, -Math.sin(tilt), -Math.cos(tilt));
  cam.position.copy(target).addScaledVector(forward, -d);
  cam.position.y += d * Math.tan(THREE.MathUtils.degToRad(elevDeg));
  cam.quaternion.setFromEuler(new THREE.Euler(-tilt, 0, 0));
  cam.shiftX = 0;
  cam.shiftY = 0;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

export class Rig {
  camera = new ShiftCamera(config.fov, 1, 0.05, 60);
  progress = 0;

  pan = 0;
  panVelocity = 0;
  panLimit = 0;
  panHeld = false;
  panTarget: number | null = null; // eased to after an arrow step; any hand on the shelf cancels it

  yaw = 0;
  pitch = 0;
  zoom = 1;
  orbiting = false;
  private returning: gsap.core.Tween | null = null;

  private k0!: Frame;
  private k1!: Frame;
  private k2!: Frame;
  private target = new THREE.Vector3();

  resize(width: number, height: number) {
    this.camera.aspect = width / height;
    this.computeFrames();
  }

  /**
   * Find the distance at which a box fills the given share of the screen when
   * seen from this camera pose, and where its target must sit on screen.
   * fillW / fillH are shares of the full width / height.
   */
  private fit(box: THREE.Box3, elevDeg: number, fillW: number, fillH: number, place: 'bottom' | 'center', margin = 0) {
    const target = box.getCenter(new THREE.Vector3());
    const cam = new ShiftCamera(config.fov, this.camera.aspect, 0.05, 60);
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(
      (i) => new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z),
    );
    let d = 4;
    let b = { minX: 0, maxX: 0, minY: 0, maxY: 0, ty: 0 };
    for (let i = 0; i < 6; i++) {
      pose(cam, target, d, elevDeg);
      const ps = corners.map((c) => c.clone().project(cam));
      b = {
        minX: Math.min(...ps.map((p) => p.x)),
        maxX: Math.max(...ps.map((p) => p.x)),
        minY: Math.min(...ps.map((p) => p.y)),
        maxY: Math.max(...ps.map((p) => p.y)),
        ty: target.clone().project(cam).y,
      };
      d *= Math.max((b.maxX - b.minX) / (2 * fillW), (b.maxY - b.minY) / (2 * fillH));
    }
    const screenY = place === 'bottom' ? -1 + 2 * margin + (b.ty - b.minY) : b.ty - (b.minY + b.maxY) / 2;
    return { frame: { target, d, elevDeg, screenY } as Frame, ndcWidth: b.maxX - b.minX };
  }

  computeFrames() {
    this.camera.fov = config.fov;
    const portrait = this.camera.aspect < 0.8;
    this.k0 = this.fit(ISLAND_BOX, config.startElevationDeg, config.startFill, config.startFillHeight, 'bottom', config.startBottom).frame;
    this.k1 = this.fit(ISLAND_BOX, 0, 0.88, 0.7, 'center').frame;
    // On a phone the shelf fits by height and the rest is reached by panning.
    const k2 = portrait
      ? this.fit(SHELF_BOX, 0, 100, config.shelfFill * 0.8, 'center')
      : this.fit(SHELF_BOX, 0, config.shelfFill, config.shelfFill, 'center');
    this.k2 = k2.frame;
    const shelfWidth = SHELF_BOX.max.x - SHELF_BOX.min.x;
    const visibleHalf = shelfWidth / k2.ndcWidth;
    this.panLimit = Math.max(0, shelfWidth / 2 + 0.06 - visibleHalf);
    this.shelfNdcPerMetre = k2.ndcWidth / shelfWidth;
  }

  private shelfNdcPerMetre = 1;

  inShelf() {
    return this.progress >= config.zoomEnd - 0.01;
  }

  /** Pixels per metre on the shelf front plane at the final framing. */
  pxPerMetre(viewWidth: number) {
    return (viewWidth / 2) * this.shelfNdcPerMetre;
  }

  returnHome() {
    if (!this.orbiting || this.returning) return;
    this.returning = gsap.to(this, {
      yaw: 0,
      pitch: 0,
      zoom: 1,
      duration: 0.9,
      ease: 'power3.inOut',
      onComplete: () => {
        this.orbiting = false;
        this.returning = null;
      },
    });
  }

  startOrbit() {
    this.returning?.kill();
    this.returning = null;
    this.orbiting = true;
  }

  /** Pan so a point on the shelf comes to the middle of the screen (as far as the pan allows). */
  panTo(x: number) {
    const centre = (SHELF_BOX.min.x + SHELF_BOX.max.x) / 2;
    this.panTarget = THREE.MathUtils.clamp(x - centre, -this.panLimit, this.panLimit);
    this.panVelocity = 0;
  }

  update(dt: number) {
    if (this.panHeld) this.panTarget = null;
    if (this.panTarget !== null) {
      this.pan += (this.panTarget - this.pan) * (1 - Math.exp(-dt * 8));
      if (Math.abs(this.panTarget - this.pan) < 1e-4) this.panTarget = null;
    }
    if (!this.panHeld) {
      this.pan += this.panVelocity * dt;
      this.panVelocity *= Math.exp(-dt * 5);
      if (Math.abs(this.panVelocity) < 0.001) this.panVelocity = 0;
    }
    const over = Math.abs(this.pan) - this.panLimit;
    if (over > 0 && !this.panHeld) {
      this.pan -= Math.sign(this.pan) * over * (1 - Math.exp(-dt * 12));
      this.panVelocity = 0;
    }

    const p = this.progress;
    const e1 = ease(clamp01(p / config.descendEnd));
    const e2 = ease(clamp01((p - config.descendEnd) / (config.zoomEnd - config.descendEnd)));
    const lerp = THREE.MathUtils.lerp;
    const a = this.k0, b = this.k1, c = this.k2;
    this.target.lerpVectors(a.target, b.target, e1).lerp(c.target, e2);
    const d = lerp(lerp(a.d, b.d, e1), c.d, e2);
    const elev = lerp(lerp(a.elevDeg, b.elevDeg, e1), c.elevDeg, e2);
    const screenY = lerp(lerp(a.screenY, b.screenY, e1), c.screenY, e2);
    this.target.x += this.pan * e2;

    const cam = this.camera;
    pose(cam, this.target, d, elev);
    // Lens shift: put the target where we want it on screen without turning the camera.
    const ndc = this.target.clone().project(cam);
    cam.shiftX = ndc.x / 2;
    cam.shiftY = -(screenY - ndc.y) / 2;
    cam.updateProjectionMatrix();

    if (this.orbiting) {
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      const q = new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw)
        .multiply(new THREE.Quaternion().setFromAxisAngle(right, this.pitch));
      const offset = cam.position.clone().sub(this.target).applyQuaternion(q).multiplyScalar(this.zoom);
      cam.position.copy(this.target).add(offset);
      cam.quaternion.premultiply(q);
    }
    cam.updateMatrixWorld();
  }
}
