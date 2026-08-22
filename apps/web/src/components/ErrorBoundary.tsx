import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { ArrowClockwise, WarningCircle } from "@phosphor-icons/react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <section className="shutdown-screen" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px" }}>
          <div className="shutdown-card" style={{ maxWidth: "560px", width: "100%" }}>
            <WarningCircle size={42} weight="duotone" style={{ color: "var(--notice-error, #e53e3e)" }} />
            <h1 style={{ fontSize: "22px", margin: "14px 0 8px" }}>Render Error</h1>
            <p style={{ color: "var(--muted)", fontSize: "13px", lineHeight: "1.6", margin: "0 0 16px" }}>
              An unexpected interface rendering error occurred while displaying this page.
            </p>
            {this.state.error?.message ? (
              <pre
                style={{
                  background: "var(--paper, rgba(0,0,0,0.05))",
                  padding: "12px 14px",
                  borderRadius: "8px",
                  fontSize: "11px",
                  overflowX: "auto",
                  color: "var(--ink)",
                  border: "1px solid var(--line, rgba(0,0,0,0.1))",
                  marginBottom: "20px",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {this.state.error.message}
              </pre>
            ) : null}
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                type="button"
                className="primary-button"
                onClick={this.handleReset}
                style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}
              >
                <ArrowClockwise size={16} /> Reload page
              </button>
              <button
                type="button"
                className="quiet-button"
                onClick={() => {
                  window.location.href = window.location.pathname;
                }}
              >
                Back to Channels
              </button>
            </div>
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}
