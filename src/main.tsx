import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@xyflow/react/dist/style.css";
import "./styles/theme.css";
import "./styles/layout.css";
import "./styles/tiles.css";
import "./styles/panels.css";
import "./styles/model3d.css";
import "./styles/nodes.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
