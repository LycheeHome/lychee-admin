import "../styles/tailwind.css";
import { createQueryClient } from "./queryClient";
import { mountApp } from "./router";

// One root and one query client for the whole page: the rail (a portal into
// the server's aside) and the page share the router and the cache. Every page
// gets the root; only the sites list and the board pages give it a page to
// render.
mountApp(createQueryClient());
