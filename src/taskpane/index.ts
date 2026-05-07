import "core-js/stable";
import "regenerator-runtime/runtime";
import "./styles.css";
import { createTaskpaneApp } from "./app";

Office.onReady(() => {
  const app = createTaskpaneApp();
  void app.init();
});
