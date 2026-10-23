/**
 * A canonical form of an HTML fragment, for the parity tests that compare a
 * server renderer with its React twin. Parsed by happy-dom so entities are
 * decoded identically on both sides (`&#9679;` and `●`, `'` and `&#x27;`).
 * Attributes are sorted by name; text collapses runs of whitespace to one
 * space, drops whitespace-only nodes, and trims at a parent's start and end,
 * which is the whitespace HTML renders the same either way. A space between
 * two inline siblings inside a text node is kept.
 *
 * Dropping whitespace-only nodes is right for most of the server's markup,
 * which is indentation between block or flex children, and wrong for the
 * rest: a whitespace-only node between two inline siblings in an inline
 * formatting context renders as a word space. The server's breadcrumb wrote
 * `<a>sites</a>\n  <span>/</span>\n  <span>host</span>` in a block <nav>, and
 * React's version with no spaces passed parity while rendering tighter. Pass
 * `{ inlineWhitespace: true }` to keep those nodes as one space (see
 * `rendersAsSpace`), so that difference fails; every parity test runs both.
 *
 * Import "./setup" before this in a test file: it needs `document`.
 */
export function canonical(html: string, options: { inlineWhitespace?: boolean } = {}): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  const walk = (node: Node): string => {
    if (node.nodeType === 3) {
      let text = (node.textContent ?? "").replace(/\s+/g, " ");
      if (text === " ") return options.inlineWhitespace && rendersAsSpace(node) ? " " : "";
      if (!node.previousSibling) text = text.trimStart();
      if (!node.nextSibling) text = text.trimEnd();
      return text;
    }
    if (node.nodeType !== 1) return "";
    const el = node as Element;
    const attrs = Array.from(el.attributes)
      .map((a) => `${a.name}="${a.value}"`)
      .sort()
      .join(" ");
    const tag = el.tagName.toLowerCase();
    const inner = Array.from(el.nodeName === "TEMPLATE" ? (el as HTMLTemplateElement).content.childNodes : el.childNodes)
      .map(walk)
      .join("");
    return `<${tag}${attrs ? ` ${attrs}` : ""}>${inner}</${tag}>`;
  };
  return Array.from(template.content.childNodes).map(walk).join("");
}

const INLINE_TAGS = new Set([
  "a", "abbr", "b", "button", "code", "em", "i", "img", "input", "kbd", "label",
  "mark", "s", "select", "small", "span", "strong", "sub", "sup", "svg", "textarea", "time",
]);

/** Unprefixed Tailwind display utilities: the display at every width. */
const DISPLAY = /^(block|inline|inline-block|flex|inline-flex|grid|inline-grid|hidden|table|contents|flow-root)$/;

/** Tags whose default display is inline-block: an inline box that holds its own lines. */
const INLINE_BLOCK_TAGS = new Set(["button", "img", "input", "select", "textarea"]);

function display(el: Element): string {
  const token = Array.from(el.classList).filter((c) => DISPLAY.test(c)).pop();
  if (token) return token === "hidden" ? "none" : token;
  const tag = el.tagName.toLowerCase();
  if (INLINE_BLOCK_TAGS.has(tag)) return "inline-block";
  return INLINE_TAGS.has(tag) ? "inline" : "block";
}

const isInlineLevel = (el: Element) => display(el).startsWith("inline");
const isBlank = (n: Node) => n.nodeType === 3 && !/\S/.test(n.textContent ?? "");
const isNone = (n: Node) => n.nodeType === 1 && display(n as Element) === "none";

/**
 * The nearest sibling in a direction that renders anything: display:none
 * elements make no box, and further whitespace collapses into this run.
 */
function rendered(node: Node, step: "previousSibling" | "nextSibling"): Node | null {
  let s = node[step];
  while (s && (isBlank(s) || isNone(s) || (s.nodeType !== 1 && s.nodeType !== 3))) s = s[step];
  return s;
}

/**
 * Whether a whitespace-only text node can render as a word space, read from
 * the server's own markup with Tailwind's display classes standing in for
 * computed style. It cannot inside a flex or grid container, which drops
 * whitespace-only runs, nor beside a block-level sibling, nor at the start or
 * end of a block container (inline-block included), where a line's leading
 * and trailing whitespace collapse away. It can between two inline-level
 * siblings, or text, in a block or inline container, and at the edge of a
 * plain inline element, which may sit mid-line.
 */
function rendersAsSpace(node: Node): boolean {
  const parent = node.parentNode;
  if (!parent || parent.nodeType !== 1) return false;
  const parentDisplay = display(parent as Element);
  if (/flex|grid/.test(parentDisplay)) return false;
  const siblings = [rendered(node, "previousSibling"), rendered(node, "nextSibling")];
  for (const s of siblings) {
    if (s && s.nodeType === 1 && !isInlineLevel(s as Element)) return false;
  }
  if (siblings.some((s) => !s)) return parentDisplay === "inline";
  return true;
}
