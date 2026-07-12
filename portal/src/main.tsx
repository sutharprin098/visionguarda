import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { AuthProvider } from "./contexts/AuthContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import "./index.css";

// Prevent Backspace key from navigating back in history when not focused on an editable element
window.addEventListener("keydown", (e) => {
  if (e.key === "Backspace") {
    const target = e.target as HTMLElement;
    if (target) {
      const tag = target.tagName.toLowerCase();
      const isInput = tag === "input" || tag === "textarea" || target.isContentEditable;
      if (!isInput) {
        e.preventDefault();
      }
    }
  }
});

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15_000 } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ThemeProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
