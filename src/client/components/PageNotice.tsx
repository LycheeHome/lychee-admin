import type { MouseEvent } from "react";
import { DISMISS_BUTTON, PAGE_NOTICE } from "../../views/shared";

/**
 * The notice a document load arrives carrying (`?removed=` on the list,
 * `?created=1` on a site's page), as layout()'s renderPageNotice drew it: in
 * flow at the top of <main>, above the page, with its own dismiss.
 *
 * The close is React's, not sharedBindings' document-level one, which would
 * remove a node React owns. stopPropagation keeps that one from also firing
 * while the server's notice still needs it.
 */
export function PageNotice({ message, onClose }: { message: string; onClose: () => void }) {
  const close = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onClose();
  };
  return (
    <div id="page-notice" className={PAGE_NOTICE} role="status">
      <span id="page-notice-message">{message}</span>
      <button type="button" id="page-notice-close" className={DISMISS_BUTTON} aria-label="Dismiss" onClick={close}>
        &times;
      </button>
    </div>
  );
}
