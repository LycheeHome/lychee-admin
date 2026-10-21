import "../styles/tailwind.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "./queryClient";
import { InfrastructurePage } from "./pages/InfrastructurePage";

// The server's shell names the page on its mount point; an unknown name, or
// no mount point at all, renders nothing.
const root = document.getElementById("app-root");
if (root && root.dataset.page === "infrastructure") {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={createQueryClient()}>
        <InfrastructurePage />
      </QueryClientProvider>
    </StrictMode>,
  );
}
