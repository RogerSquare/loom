import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  name: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[loom] ErrorBoundary(${this.props.name}):`, error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-inner">
            <h3>something went wrong</h3>
            <p className="error-boundary-name">{this.props.name}</p>
            <pre className="error-boundary-msg">
              {this.state.error.message}
            </pre>
            <button
              onClick={() => this.setState({ error: null })}
              className="primary"
            >
              retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
