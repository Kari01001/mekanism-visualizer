export type AssetsCommand = "new-custom-object" | "import-types" | "export-types";

export interface AssetsCommandEventDetail {
  command: AssetsCommand;
}

export const ASSETS_COMMAND_EVENT = "mekanism-visualizer.assets-command";

export const dispatchAssetsCommand = (command: AssetsCommand) => {
  // Menu actions talk to the assets view through a single window event.
  window.dispatchEvent(
    new CustomEvent<AssetsCommandEventDetail>(ASSETS_COMMAND_EVENT, {
      detail: { command },
    })
  );
};
