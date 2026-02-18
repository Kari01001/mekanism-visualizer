import { create } from "zustand";

export type ConsoleLogLevel = "info" | "warn" | "error";

export interface ConsoleEntry {
  id: number;
  timestamp: string;
  level: ConsoleLogLevel;
  source: string;
  message: string;
}

interface ConsoleState {
  entries: ConsoleEntry[];
  pushEntry: (entry: Omit<ConsoleEntry, "id" | "timestamp">) => void;
  clearEntries: () => void;
}

const MAX_ENTRIES = 200;

let logCounter = 1;

export const useConsoleStore = create<ConsoleState>((set) => ({
  entries: [],

  pushEntry: (entry) =>
    set((state) => {
      const next: ConsoleEntry = {
        id: logCounter++,
        timestamp: new Date().toISOString(),
        ...entry,
      };

      const merged = [...state.entries, next];
      return {
        entries: merged.slice(-MAX_ENTRIES),
      };
    }),

  clearEntries: () => set({ entries: [] }),
}));

export const logInfo = (source: string, message: string) => {
  useConsoleStore.getState().pushEntry({ level: "info", source, message });
};

export const logWarn = (source: string, message: string) => {
  useConsoleStore.getState().pushEntry({ level: "warn", source, message });
};

export const logError = (source: string, message: string) => {
  useConsoleStore.getState().pushEntry({ level: "error", source, message });
};
