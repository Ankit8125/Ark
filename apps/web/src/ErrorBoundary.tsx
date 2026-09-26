import { Component, type ReactNode } from "react";
import styles from "./App.module.css";

type Props = {
  children: ReactNode;
  onReload?: () => void;
};
type State = { failed: boolean };

function reloadApplication() {
  window.location.reload();
}

// The root error callbacks report failures once. This boundary owns recovery
// presentation and deliberately does not retain the thrown error or its data.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className={styles.connectionPage}>
        <div className={styles.brand}>ark</div>
        <div className={styles.connectionStatus} role="alert">
          <h1>Ark couldn’t display this page</h1>
          <p>Reload the page to try again. Unsaved form entries may be lost.</p>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={this.props.onReload ?? reloadApplication}
          >
            Reload Ark
          </button>
        </div>
      </main>
    );
  }
}
