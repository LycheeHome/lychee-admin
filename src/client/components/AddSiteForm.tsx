import type { ChangeEvent, FormEvent, Ref } from "react";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FOCUS_RING, FORM_LABEL, INPUT } from "../../views/shared";
import { RailLink } from "../clientNav";

/**
 * The add page's form, as `renderAddSite` wrote it and `public/app.js` then
 * changed it. Presentational: AddSiteBody (src/client/pages/AddSitePage.tsx)
 * owns every decision and passes each changing class string, text and
 * attribute in. The inputs are uncontrolled, as the server's were, so no
 * `value` attribute appears that app.js's property writes never made; the
 * body reads them through the form, as app.js read FormData.
 *
 * Text nodes are written as single strings where the server's indentation
 * left a word space beside an element ("Hostname ", " Static site"), so each
 * phrase is one text node, as it is on the server.
 */

export type AddSiteFormProps = {
  domain: string;
  formRef: Ref<HTMLFormElement>;
  portFieldRef: Ref<HTMLInputElement>;
  /** The port block and its fields: open for a reverse proxy. */
  isProxy: boolean;
  /** The healthcheck field: open for Next.js. */
  isNextjs: boolean;
  /** `#type-proxy-description`'s class, in app.js's token order. */
  proxyDescriptionClass: string;
  /** `#type-proxy-description-nextjs`'s class, in app.js's token order. */
  nextjsDescriptionClass: string;
  portErrorClass: string;
  portErrorText: string;
  addErrorClass: string;
  addErrorText: string;
  /** A preview rejected the input: `aria-disabled` and the reason in `aria-describedby`. */
  blocked: boolean;
  /** An add is in flight. */
  submitting: boolean;
  onHostnameChange: () => void;
  onTypeChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onPortChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onFrameworkChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  onHealthcheckChange: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function AddSiteForm(props: AddSiteFormProps) {
  const { domain, isProxy, isNextjs } = props;
  return (
    <form ref={props.formRef} id="add-site-form" method="post" action="/sites" className="flex flex-col gap-6" onSubmit={props.onSubmit}>
      <label className={FORM_LABEL}>
        {"Hostname "}
        <span
          id="hostname-row"
          className="flex items-stretch rounded-md focus-within:outline focus-within:outline-2 focus-within:outline-rose-400 focus-within:outline-offset-2"
        >
          <input
            type="text"
            id="hostname-field"
            name="hostname"
            required
            autoComplete="off"
            aria-describedby="hostname-suffix"
            className={`${INPUT} rounded-r-none flex-1 min-w-0 focus:outline-none!`}
            placeholder="blog"
            onChange={props.onHostnameChange}
          />
          <span
            id="hostname-suffix"
            className="font-mono text-[0.72rem] text-stone-300 bg-stone-700 border border-l-0 border-stone-700 rounded-r-md px-2.5 flex items-center shrink-0"
          >
            {`.${domain}`}
          </span>
        </span>
      </label>

      <fieldset className="border-0 p-0 m-0 flex flex-col gap-3">
        <legend className="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-stone-400 px-0 mb-2">Type</legend>

        <label className="flex flex-col gap-1 rounded-md border border-stone-600 bg-stone-700/50 px-3 py-2.5 cursor-pointer motion-safe:transition-colors hover:bg-stone-700/80 has-[:checked]:bg-stone-700 has-[:checked]:border-stone-500">
          <span className="flex items-center gap-2 text-stone-50 text-[0.9rem] font-semibold">
            <input
              type="radio"
              name="type"
              value="static"
              defaultChecked
              aria-label="Static site"
              aria-describedby="type-static-description"
              className={`accent-stone-300 ${FOCUS_RING}`}
              onChange={props.onTypeChange}
            />
            {" Static site"}
          </span>
          <span id="type-static-description" className="text-stone-300 text-[0.75rem] leading-snug pl-[1.55rem]">
            {"Serves plain files from "}
            <code className="font-mono">{"/var/www/<hostname>"}</code>
            {", which lychee-admin creates for you with a placeholder page — no process to run yourself."}
          </span>
        </label>

        <label className="flex flex-col gap-1 rounded-md border border-stone-700 bg-transparent px-3 py-2.5 cursor-pointer motion-safe:transition-colors hover:bg-stone-800/40 has-[:checked]:bg-rose-950/50 has-[:checked]:border-rose-800/70">
          <span className="flex items-center gap-2 text-stone-50 text-[0.9rem] font-semibold">
            <input
              type="radio"
              name="type"
              value="reverse-proxy"
              aria-label="Reverse proxy"
              aria-describedby={isNextjs ? "type-proxy-description-nextjs" : "type-proxy-description"}
              className={`accent-rose-400 ${FOCUS_RING}`}
              onChange={props.onTypeChange}
            />
            {" Reverse proxy"}
          </span>
          <span id="type-proxy-description" className={props.proxyDescriptionClass}>
            {"Routes to a process you already run and manage yourself on a local port (e.g. "}
            <code className="font-mono">next start</code>
            {"). lychee-admin only wires up the routing — it won't start, stop, or restart that process for you."}
          </span>
          <span id="type-proxy-description-nextjs" className={props.nextjsDescriptionClass}>
            {
              "Routes to a container the reconciler runs on this port, built from the site's own repository. After you add it, the site's page has the steps to attach and deploy."
            }
          </span>
        </label>
      </fieldset>

      {/* Inline display, as app.js set it: the `hidden` class stays, and the
          style decides. */}
      <div
        className="port-input hidden flex-col gap-3 border-l-2 border-l-rose-800/70 pl-3 ml-1"
        style={{ display: isProxy ? "flex" : "none" }}
      >
        <label className="flex flex-col gap-1.5 text-[0.85rem] text-stone-400">
          {"Local port (reverse proxy only) "}
          <input
            ref={props.portFieldRef}
            type="number"
            name="port"
            min="1"
            max="65535"
            className={INPUT}
            id="port-field"
            aria-describedby="port-error"
            required={isProxy}
            disabled={!isProxy}
            onChange={props.onPortChange}
          />
          <span id="port-error" className={props.portErrorClass} role="status" aria-live="polite">
            {props.portErrorText}
          </span>
        </label>
        <label className="flex flex-col gap-1.5 text-[0.85rem] text-stone-400">
          {"Framework (optional) "}
          <select name="framework" className={INPUT} id="framework-field" onChange={props.onFrameworkChange}>
            <option value="none">None</option>
            <option value="nextjs">{"Next.js — built from its own repository; the reconciler runs it"}</option>
          </select>
        </label>
        <label
          className="hidden flex-col gap-1.5 text-[0.85rem] text-stone-400"
          id="healthcheck-field-wrapper"
          style={{ display: isNextjs ? "flex" : "none" }}
        >
          {"Healthcheck path (optional) "}
          <input
            type="text"
            name="healthcheckPath"
            placeholder="/"
            className={INPUT}
            id="healthcheck-field"
            onChange={props.onHealthcheckChange}
          />
          {/* The server's indentation. The label's classes read as hidden to
              the parity check's whitespace model (it does not see the inline
              display), which keeps this node as a word space; under display:
              flex a browser drops it, so it renders nothing either way. */}{" "}
          <span className="text-[0.75rem] text-stone-400 leading-snug">
            {"Path Docker will poll inside the container to decide if it's healthy. Defaults to "}
            <code className="font-mono">/</code>
            {"."}
          </span>
        </label>
      </div>

      <p id="add-site-error" role="alert" className={props.addErrorClass}>
        {props.addErrorText}
      </p>

      <div className="flex items-center justify-end gap-2.5">
        <RailLink href="/" className={`${BUTTON_SECONDARY} no-underline`}>
          Cancel
        </RailLink>
        <button
          type="submit"
          id="add-site-submit"
          className={BUTTON_PRIMARY}
          aria-disabled={props.blocked ? "true" : undefined}
          aria-describedby={props.blocked ? "preview-error" : undefined}
          disabled={props.submitting}
        >
          Add site
        </button>
      </div>
    </form>
  );
}
