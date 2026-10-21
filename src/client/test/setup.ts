import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Import this first in any client test: it installs window, document and the
// rest of the DOM globals that @testing-library/react expects.
if (typeof globalThis.document === "undefined") {
  GlobalRegistrator.register();
}
