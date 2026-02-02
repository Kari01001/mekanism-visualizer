import * as THREE from "three";
import type { Camera } from "three";
import { useBlocksStore } from "../../state/useBlocksStore";
import type { BlockInstance } from "../../models/blocks";

type Axis = "x" | "y" | "z";

export class RotateGizmo {
    public group: THREE.Group;

    private camera: Camera;
    private dom: HTMLElement;
    private setCameraLocked: (locked: boolean) => void;

    private raycaster: THREE.Raycaster;
    private mouse: THREE.Vector2;

    private dragging: boolean;
    private activeAxis: Axis | null;
    private accumulated: number;
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

        this.dragging = false;
        this.activeAxis = null;
        this.accumulated = 0;
        this.createRings();
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

    private createRings() {
        const makeRing = (axis: Axis, color: number) => {
            const geo = new THREE.TorusGeometry(1.2, 0.04, 8, 64);

            const mat = new THREE.MeshBasicMaterial({
                color,
                side: THREE.DoubleSide,
                depthTest: false,
                transparent: true,
                opacity: 0.95,
            });

            mat.depthWrite = false;

            const ring = new THREE.Mesh(geo, mat);
            ring.renderOrder = 1000;

            if (axis === "x") {
            ring.rotation.y = Math.PI / 2;
            }

            if (axis === "y") {
            ring.rotation.x = Math.PI / 2;
            }

            ring.userData.axis = axis;
            this.group.add(ring);
        };

        makeRing("x", 0xff0000);
        makeRing("y", 0x00ff00);
        makeRing("z", 0x0000ff);
    }

    private bindEvents() {
        this.dom.addEventListener("pointerdown", this.onPointerDown);
        window.addEventListener("pointermove", this.onPointerMove);
        window.addEventListener("pointerup", this.onPointerUp);
    }

    private onPointerDown = (e: PointerEvent) => {
        const store = useBlocksStore.getState();
        if (store.mode !== "edit" || store.transformMode !== "rotate") return;

        this.setMouse(e);
        this.raycaster.setFromCamera(this.mouse, this.camera);

        const hits = this.raycaster.intersectObjects(this.group.children, false);
        if (hits.length === 0) return;

        const axis = hits[0].object.userData.axis as Axis;
        if (!axis) return;

        this.dragging = true;
        this.activeAxis = axis;

        store.setGizmoAxis(axis);

        this.accumulated = 0;

        this.dom.requestPointerLock();
        this.setCameraLocked(true);
        e.stopPropagation();
    };
    private onPointerMove = (e: PointerEvent) => {
        if (!this.dragging || !this.activeAxis) return;

        const store = useBlocksStore.getState();
        const id = store.selectedBlockId;
        if (!id) return;

        const sensitivity = 0.01;

        const delta = e.movementX * sensitivity;

        this.accumulated += delta;
        const SNAP = Math.PI / 2
        if (Math.abs(this.accumulated) >= SNAP) {
            const delta = this.accumulated > 0 ? 90 : -90;

            const scene = (this.group.parent as THREE.Scene);
            if (!scene) return;

            const mesh = scene.children.find(
                (o): o is THREE.Mesh =>
                (o as any).userData?.blockId === id
            );

            if (!mesh) return;

            const worldAxis = new THREE.Vector3(
                this.activeAxis === "x" ? 1 : 0,
                this.activeAxis === "y" ? 1 : 0,
                this.activeAxis === "z" ? 1 : 0
            );

            const angleRad = THREE.MathUtils.degToRad(delta);

            const q = new THREE.Quaternion().setFromAxisAngle(worldAxis, angleRad);

            mesh.quaternion.premultiply(q);
            this.accumulated = 0;
        }
    };

    private onPointerUp = () => {
        if (!this.dragging) return;

        const store = useBlocksStore.getState();
        const id = store.selectedBlockId;

        if (id) {
            const scene = this.group.parent as THREE.Scene;
            const mesh = scene.children.find(
            (o): o is THREE.Mesh =>
                (o as any).userData?.blockId === id
            );

            if (mesh) {
            const euler = new THREE.Euler().setFromQuaternion(
                mesh.quaternion,
                "XYZ"
            );

            store.setBlockRotation(id, {
                x: Math.round(THREE.MathUtils.radToDeg(euler.x)),
                y: Math.round(THREE.MathUtils.radToDeg(euler.y)),
                z: Math.round(THREE.MathUtils.radToDeg(euler.z)),
            });
            }
        }

        store.setGizmoAxis(null);

        this.dragging = false;
        this.activeAxis = null;
        this.accumulated = 0;

        document.exitPointerLock();
        this.setCameraLocked(false);
    };

    private setMouse(e: PointerEvent) {
        const r = this.dom.getBoundingClientRect();
        this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
        this.mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    }
}