/**
 * A canonical form of an HTML fragment, for the parity tests that compare a
 * server renderer with its React twin. Parsed by happy-dom so entities are
 * decoded identically on both sides (`&#9679;` and `●`, `'` and `&#x27;`).
 * Attributes are sorted by name; text collapses runs of whitespace to one
 * space, drops whitespace-only nodes, and trims at a parent's start and end,
 * which is the whitespace HTML renders the same either way. A space between
 * two inline siblings is kept.
 *
 * Import "./setup" before this in a test file: it needs `document`.
 */
export function canonical(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  const walk = (node: Node): string => {
    if (node.nodeType === 3) {
      let text = (node.textContent ?? "").replace(/\s+/g, " ");
      if (text === " ") return "";
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
