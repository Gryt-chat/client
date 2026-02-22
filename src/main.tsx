import "@radix-ui/themes/styles.css";
import "./style.css";

import { Theme } from "@radix-ui/themes";
import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "react-hot-toast";

import { useTheme } from "@/common";

import { App } from "./App.tsx";
import { Titlebar } from "./components/titlebar";

// eslint-disable-next-line react-refresh/only-export-components
function ThemedApp() {
  const {
    resolvedAppearance,
    accentColor,
    grayColor,
    hasBackground,
    panelBackground,
    radius,
  } = useTheme();
  return (
    <Theme
      appearance={resolvedAppearance}
      accentColor={accentColor}
      grayColor={grayColor}
      radius={radius}
      hasBackground={hasBackground}
      panelBackground={panelBackground}
      style={{
        minHeight: 0,
        flex: 1,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Titlebar />
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <App />
      </div>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "var(--color-panel-solid)",
            color: "var(--gray-12)",
            border: "1px solid var(--gray-6)",
          },
        }}
      />
    </Theme>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemedApp />
  </React.StrictMode>
);