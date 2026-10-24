/** Registers the same-origin offline shell in production builds only. */
export function registerOfflineSupport(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const register = (): void => {
    void navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch((error: unknown) => {
      console.warn("Offline support could not be registered.", error);
    });
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
