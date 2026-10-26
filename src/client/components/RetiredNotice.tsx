import { BODY, CARD, MONO_FACT } from "../../views/shared";
import { PruneLine, type DeployLineControls } from "./DeployLines";

/**
 * A retired declaration's notice: under the site page's header, above the
 * request path, shown only while the declaration is `state: absent` and not
 * yet pruned. It holds the page's one Prune, as the compact primary, because
 * pruning is the page's next step and nothing else on it works until then.
 * The caption under Prune is PruneLine's own, shared with the services board:
 * it says what the route checks ("once its container is confirmed down")
 * without claiming the page knows the container is down.
 */
export function RetiredNotice({ name, controls }: { name: string; controls?: DeployLineControls }) {
  return (
    <section aria-labelledby="retired-notice-heading" className={`${CARD} flex flex-col gap-3`}>
      {/* Hidden: the sentence names the state; the heading puts Prune in the page's outline. */}
      <h3 id="retired-notice-heading" className="sr-only">
        Retired declaration
      </h3>
      <p className={`${BODY} text-stone-300`}>
        <span className={MONO_FACT}>{`${name}.yml`}</span>
        {" is retired ("}
        {/* A short fact keeps together: MONO_FACT's break-all split it mid-word at 390px. */}
        <span className={MONO_FACT.replace("break-all", "whitespace-nowrap")}>state: absent</span>
        {"). Attaching a repository is refused until it is pruned."}
      </p>
      <PruneLine name={name} emphasis="primary" controls={controls} />
    </section>
  );
}
