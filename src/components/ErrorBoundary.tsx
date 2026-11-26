import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportCrash, errorMessageOf } from "../engine/io/crashReporting";
import { saveProjectAction } from "../engine/io/projectBridge";
import { useEditorStore } from "../store/editorStore";

interface Props {
  /** Region label shown in the fallback, e.g. "Timeline". */
  name: string;
  fallback: "app" | "region";
  children: ReactNode;
}

interface State {
  error: Error | null;
}

async function saveCopy(): Promise<void> {
  try {
    await saveProjectAction(true);
  } catch (err) {
    useEditorStore
      .getState()
      .setStatusMessage(`Could not save a copy: ${errorMessageOf(err)}`);
  }
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.name}] render error`, error, info.componentStack);
    reportCrash(`${this.props.name} crashed`, error);
  }

  private retry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { name, fallback } = this.props;
    const card = (
      <div className="safe-card" role="alert">
        <div className="safe-title">{name} hit an error</div>
        <div className="safe-msg" title={error.message}>
          {error.message || error.name}
        </div>
        <div className="safe-actions">
          <button type="button" className="mini-btn" onClick={this.retry}>
            Retry
          </button>
          <button type="button" className="mini-btn" onClick={() => void saveCopy()}>
            Save a copy
          </button>
          {fallback === "app" && (
            <button
              type="button"
              className="mini-btn"
              onClick={() => window.location.reload()}
            >
              Reload app
            </button>
          )}
        </div>
      </div>
    );
    return fallback === "app" ? (
      <div className="safe-app">{card}</div>
    ) : (
      <div className="safe-region" data-safe-region={name}>
        {card}
      </div>
    );
  }
}
