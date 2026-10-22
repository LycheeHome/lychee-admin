/**
 * Whether an element is displayed at a viewport width, read from the Tailwind
 * display classes on it and its ancestors. happy-dom loads no stylesheet, so
 * this is how a test observes the shell's responsive split. It knows exactly
 * the vocabulary the shell uses: `hidden`, and `min-[900px]:` with `hidden`
 * or a display value. A breakpoint the shell does not use is not modelled.
 */
const WIDE_SHOW = /^min-\[900px\]:(flex|block|grid|inline-flex|inline-block)$/;

export function displayedAt(el: Element, width: number): boolean {
  const wide = width >= 900;
  for (let node: Element | null = el; node; node = node.parentElement) {
    const cls = Array.from(node.classList);
    let shown = !cls.includes("hidden");
    if (wide && cls.includes("min-[900px]:hidden")) shown = false;
    else if (wide && cls.some((c) => WIDE_SHOW.test(c))) shown = true;
    if (!shown) return false;
  }
  return true;
}
