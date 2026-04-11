import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/index.css";
import { AppProviders } from "@/app/providers";
import { useAuthStore } from "@/stores/auth-store";

// Initialize auth listener once at startup (Zustand stores work outside React)
useAuthStore.getState().initialize();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProviders />
  </StrictMode>,
);
