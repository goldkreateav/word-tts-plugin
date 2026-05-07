import "core-js/stable";
import "regenerator-runtime/runtime";
import "./styles.css";
import { createTaskpaneApp } from "./app";

Office.onReady(() => {
  // Prevent Office taskpane "red screen" in production by swallowing unhandled errors.
  // In debug mode, we keep default behavior to make failures visible.
  window.addEventListener("error", (event) => {
    if (__DEBUG__) return;
    // eslint-disable-next-line no-console
    console.error("Unhandled error:", event.error || event.message);
    event.preventDefault?.();
  });

  window.addEventListener("unhandledrejection", (event) => {
    if (__DEBUG__) return;
    // eslint-disable-next-line no-console
    console.error("Unhandled rejection:", event.reason);
    event.preventDefault?.();
  });

  const app = createTaskpaneApp();
  void app.init();
});
