import "../styles/tailwind.css";
import { createQueryClient } from "./queryClient";
import { mountApp } from "./router";

// One root and one query client for the whole document: the frame (top bar,
// rail, notices) and the page share the router and the cache.
mountApp(createQueryClient());
