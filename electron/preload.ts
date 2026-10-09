import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktop", {
  setTheme: (theme: "dark" | "light") => ipcRenderer.send("desktop:theme", theme),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("desktop:pick-folder"),
});
