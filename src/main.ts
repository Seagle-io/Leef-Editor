import "./styles/tokens.css";
import "./styles/content.css";
import App from "./App.svelte";

const target = document.getElementById("app");
if (!target) {
  throw new Error("Root element #app not found");
}

const app = new App({ target });

requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    performance.mark("leef:ready");
    const boot = performance.measure("leef:boot-to-ready", "leef:boot", "leef:ready");
    if (import.meta.env.DEV) {
      console.info(`leef: démarrage ${boot.duration.toFixed(1)} ms`);
    }
  });
});

export default app;
