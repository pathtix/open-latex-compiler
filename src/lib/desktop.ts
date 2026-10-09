/** Bridge exposed by the Electron preload script; undefined in a regular browser. */
interface DesktopBridge {
  setTheme(theme: "dark" | "light"): void;
  pickFolder(): Promise<string | null>;
}

export const desktop = (window as { desktop?: DesktopBridge }).desktop;
