import * as THREE from "three";
import type { Camera } from "three";
import { useBlocksStore } from "../../state/useBlocksStore";
import type { BlockInstance } from "../../models/blocks";

type Axis = "x" | "y" | "z";

export class MoveGizmo {
  public group: THREE.Group;

  private camera: Camera;
  private dom: HTMLElement;
  private setCameraLocked: (locked: boolean) => void;

  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;

  private activeAxis: Axis | null;
  private dragging: boolean;

  private readonly SNAP: number;

  constructor(
    camera: Camera,
    domElement: HTMLElement,
    setCameraLocked: (locked: boolean) => void
  ) {
    this.camera = camera;
    this.dom = domElement;
    this.setCameraLocked = setCameraLocked;

    this.group = new THREE.Group();
    this.group.visible = false;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.activeAxis = null;
    this.dragging = false;

    this.SNAP = 1;

    this.createAxes();
    this.bindEvents();
  }

  update(block: BlockInstance | null, enabled: boolean) {
    this.group.visible = !!block && enabled;
    if (!block) return;

    this.group.position.set(
      block.position.x,
      block.position.y + 0.5,
      block.position.z
    );
  }

  dispose() {
    this.dom.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
  }

  private createAxes() {
    var data: [Axis, number, THREE.Vector3][] = [
      ["x", 0xff0000, new THREE.Vector3(1, 0, 0)],
      ["y", 0x00ff00, new THREE.Vector3(0, 1, 0)],
      ["z", 0x0000ff, new THREE.Vector3(0, 0, 1)],
    ];

    data.forEach((item) => {
      var axis = item[0];
      var color = item[1];
      var dir = item[2];

      var geo = new THREE.CylinderGeometry(0.04, 0.04, 1, 8);
      var mat = new THREE.MeshBasicMaterial({ color });
      var mesh = new THREE.Mesh(geo, mat);

      mesh.position.copy(dir.clone().multiplyScalar(0.5));
      if (axis === "x") mesh.rotation.z = Math.PI / 2;
      if (axis === "z") mesh.rotation.x = Math.PI / 2;

      mesh.userData.axis = axis;
      this.group.add(mesh);
    });
  }

  private bindEvents() {
    this.dom.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
  }

  private onPointerDown = (e: PointerEvent) => {
    var store = useBlocksStore.getState();
    if (store.mode !== "edit" || store.transformMode !== "move") return;

    this.setMouse(e);
    this.raycaster.setFromCamera(this.mouse, this.camera);

    var hits = this.raycaster.intersectObjects(this.group.children);
    if (hits.length === 0) return;

    this.activeAxis = hits[0].object.userData.axis as Axis;
    this.dragging = true;

    this.setCameraLocked(true);
    e.stopPropagation();
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.dragging || this.activeAxis === null) return;

    var store = useBlocksStore.getState();
    var id = store.selectedBlockId;
    if (!id) return;

    this.setMouse(e);
    this.raycaster.setFromCamera(this.mouse, this.camera);

    var normal =
      this.activeAxis === "y"
        ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3(0, 1, 0);

    var plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      normal,
      this.group.position
    );

    var hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, hit)) return;

    var rawDelta =
      hit[this.activeAxis] - this.group.position[this.activeAxis];

    var snapped =
      Math.round(rawDelta / this.SNAP) * this.SNAP;

    if (snapped !== 0) {
      store.moveBlock(id, { [this.activeAxis]: snapped });
    }
  };

  private onPointerUp = () => {
    if (this.dragging) {
      this.dragging = false;
      this.activeAxis = null;
      this.setCameraLocked(false);
    }
  };

  private setMouse(e: PointerEvent) {
    var r = this.dom.getBoundingClientRect();
    this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }
}
