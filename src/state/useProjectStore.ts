import { create } from "zustand";
import type { ProjectMeta } from "../models/project";
import {
  DEFAULT_PROJECT_NAME,
  createProjectMeta,
} from "../project/projectUtils";

interface ProjectState {
  meta: ProjectMeta;
  fileName: string | null;
  dirty: boolean;
  lastSavedSnapshot: string;
  setLoadedProject: (meta: ProjectMeta, fileName: string | null, snapshot: string) => void;
  markSaved: (meta: ProjectMeta, fileName: string | null, snapshot: string) => void;
  markDirtyFromSnapshot: (snapshot: string) => void;
  setProjectName: (name: string) => void;
}

const initialMeta = createProjectMeta(DEFAULT_PROJECT_NAME);

export const useProjectStore = create<ProjectState>((set) => ({
  meta: initialMeta,
  fileName: null,
  dirty: false,
  lastSavedSnapshot: "",

  setLoadedProject: (meta, fileName, snapshot) =>
    set({
      meta,
      fileName,
      dirty: false,
      lastSavedSnapshot: snapshot,
    }),

  markSaved: (meta, fileName, snapshot) =>
    set({
      meta,
      fileName,
      dirty: false,
      lastSavedSnapshot: snapshot,
    }),

  markDirtyFromSnapshot: (snapshot) =>
    set((state) => ({
      dirty: snapshot !== state.lastSavedSnapshot,
    })),

  setProjectName: (name) =>
    set((state) => ({
      meta: {
        ...state.meta,
        name,
      },
    })),
}));
