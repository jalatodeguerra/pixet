import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installGlobalErrorHandlers } from "./engine/io/crashReporting";
import "./styles/theme.css";
import "./styles/layout.css";
import "./styles/tiles.css";
import "./styles/panels.css";
import "./styles/model3d.css";
import "./styles/nodes.css";

installGlobalErrorHandlers();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary name="Pixet" fallback="app">
      <App />
    </ErrorBoundary>
  </StrictMode>
);
