import { DISMISS_BUTTON, PAGE_NOTICE } from "../../views/shared";

/**
 * The notice a document load arrives carrying (`?removed=` on the list,
 * `?created=1` on a site's page), as the retired server shell drew it: in
 * flow at the top of <main>, above the page, with its own dismiss. The close
 * is React's; sharedBindings' document-level handler leaves it alone.
 */
export function PageNotice({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div id="page-notice" className={PAGE_NOTICE} role="status">
      <span id="page-notice-message">{message}</span>
      <button type="button" id="page-notice-close" className={DISMISS_BUTTON} aria-label="Dismiss" onClick={onClose}>
        &times;
      </button>
    </div>
  );
}
