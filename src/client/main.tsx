import "../styles/tailwind.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "./queryClient";
import { mountRailIsland } from "./RailIsland";
import { InfrastructurePage } from "./pages/InfrastructurePage";

// One query client for the whole page: the rail island and the page
// component share its cache.
const client = createQueryClient();

// Every page: the rail island takes over the server's rail.
mountRailIsland(client);

// The server's shell names the page on its mount point; an unknown name, or
// no mount point at all, renders nothing.
const root = document.getElementById("app-root");
if (root && root.dataset.page === "infrastructure") {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <InfrastructurePage />
      </QueryClientProvider>
    </StrictMode>,
  );
}
