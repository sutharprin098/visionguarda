import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
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
    console.error("[ErrorBoundary caught error]:", error, errorInfo);
  }

  public handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[420px] h-full w-full bg-zinc-950 text-zinc-300 p-6 rounded-xl border border-rose-500/30">
          <div className="flex items-center gap-3 text-rose-400 mb-3">
            <AlertTriangle size={28} />
            <h3 className="text-lg font-bold">
              {this.props.fallbackTitle || "Something went wrong in this view"}
            </h3>
          </div>
          <p className="text-xs text-zinc-400 font-mono bg-zinc-900 border border-zinc-800 p-3 rounded-lg max-w-lg mb-4 break-words">
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <button
            onClick={this.handleReset}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-lg text-xs font-semibold hover:from-cyan-500 hover:to-blue-500 transition shadow-lg"
          >
            <RefreshCw size={14} />
            <span>Reload View</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
