import type { Ref } from "react";
import type { SitePreview } from "../../lib/sitePreview";
import { previewSections, type StepMark } from "../addSiteModel";
import { BODY, CARD, CARD_LABEL_BASE, PATH_LABEL } from "../../views/shared";

/**
 * The add page's "Will be written" panel, as `renderAddSite` wrote it at rest
 * and `public/app.js` rewrote it per answer. Presentational: AddSiteBody
 * decides which state the panel is in, the error line's class and text, and
 * the step marks.
 *
 * Deliberately not aria-live: this panel rewrites on every debounced
 * keystroke, and announcing a Caddyfile block that often would bury the field
 * the user is typing into. The one actionable thing in here, a rejection the
 * submit would also make, is announced by #preview-error instead.
 */

/** The panel's body: the server's at-rest content, a one-line message, or a ready preview. */
export type PreviewPanel = { kind: "rest" } | { kind: "message"; text: string } | { kind: "preview"; preview: SitePreview };

const MARK_BASE = "step-mark ml-auto shrink-0";

export type AddSitePreviewProps = {
  paths: { caddyfilePath: string; tunnelConfigPath: string };
  steps: { id: string; label: string }[];
  panel: PreviewPanel;
  /** Per step id; an absent entry is a reset mark. */
  marks: Record<string, StepMark>;
  previewErrorRef: Ref<HTMLParagraphElement>;
  previewErrorClass: string;
  previewErrorText: string;
};

function Section({ path, lines, contextAfter }: { path: string; lines: string[]; contextAfter: string | null }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className={PATH_LABEL}>{path}</p>
      {/* No text colour on the <pre>: every child span sets its own. Everything
          but the trailing context line is an addition. */}
      <pre className="font-mono text-[0.72rem] leading-[1.55] bg-stone-900 border border-stone-700 rounded-md p-2.5 m-0 overflow-x-auto whitespace-pre [tab-size:4]">
        <span className="text-green-300">{contextAfter ? `${lines.join("\n")}\n` : lines.join("\n")}</span>
        {contextAfter ? <span className="text-stone-400">{contextAfter}</span> : null}
      </pre>
    </div>
  );
}

function PanelBody({ panel, paths }: { panel: PreviewPanel; paths: AddSitePreviewProps["paths"] }) {
  if (panel.kind === "message") return <p className="text-stone-400 text-[0.8rem] leading-snug m-0">{panel.text}</p>;
  if (panel.kind === "preview") {
    return (
      <>
        {previewSections(panel.preview).map((section) => (
          <Section key={section.path} {...section} />
        ))}
      </>
    );
  }
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <p className={PATH_LABEL}>{paths.caddyfilePath}</p>
        <p className="font-mono text-[0.72rem] text-stone-400 m-0">—</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className={PATH_LABEL}>{paths.tunnelConfigPath}</p>
        <p className="font-mono text-[0.72rem] text-stone-400 m-0">—</p>
      </div>
      <p className={BODY}>Name the site and the exact block and route appear here, before anything is written.</p>
    </>
  );
}

export function AddSitePreview(props: AddSitePreviewProps) {
  return (
    <aside id="write-preview" className={`${CARD} flex flex-col gap-3.5`}>
      <p className={`${CARD_LABEL_BASE} text-stone-300 m-0`}>Will be written</p>

      <p id="preview-error" ref={props.previewErrorRef} role="status" tabIndex={-1} className={props.previewErrorClass}>
        {props.previewErrorText}
      </p>

      <div id="preview-body" className="flex flex-col gap-3.5">
        <PanelBody panel={props.panel} paths={props.paths} />
      </div>

      <hr className="border-0 border-t border-stone-700 m-0" />

      <div>
        <p className={`${CARD_LABEL_BASE} text-stone-300 m-0 mb-3`}>In this order</p>
        <ol id="add-site-steps" className="font-mono text-[0.75rem] text-stone-400 m-0 mb-3 p-0 list-none grid gap-y-1.5">
          {props.steps.map((step, index) => {
            const mark = props.marks[step.id];
            return (
              <li key={step.id} className="flex gap-2" data-step-id={step.id}>
                <span className="text-stone-400 shrink-0">{`${index + 1}.`}</span>
                <span>{step.label}</span>
                {/* app.js wrote `step-mark ml-auto shrink-0 ${colour}`, a
                    trailing space included when the colour is empty. */}
                <span className={mark ? `${MARK_BASE} ${mark.className}` : MARK_BASE}>{mark?.text}</span>
              </li>
            );
          })}
        </ol>
        <p className="text-stone-400 text-[0.75rem] leading-snug m-0">{"If a step fails, the ones after it don't run."}</p>
      </div>
    </aside>
  );
}
