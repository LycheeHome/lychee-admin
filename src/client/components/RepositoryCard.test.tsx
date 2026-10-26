import "../test/setup";
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { seedSiteDetailPayload } from "../../dev/testHelpers";
import { RepositoryCard, type SiteWrites } from "./RepositoryCard";
import { RetiredNotice } from "./RetiredNotice";

/*
 * The repository card's controls: with `writes` absent they are the server's
 * inert markup (the parity tests compare that); with it, each control calls
 * its write and reflects the write's pending and refused states.
 */

afterEach(cleanup);

type Call = [string, ...unknown[]];

function fakeWrites(over: Partial<SiteWrites> = {}): { writes: SiteWrites; calls: Call[] } {
  const calls: Call[] = [];
  const writes: SiteWrites = {
    deploy: (name, tag) => void calls.push(["deploy", name, tag]),
    prune: (name) => void calls.push(["prune", name]),
    attach: (repo) => void calls.push(["attach", repo]),
    changeRepository: (repo) => void calls.push(["changeRepository", repo]),
    busy: new Set(),
    attaching: false,
    changingRepository: false,
    attachError: null,
    changeRepositoryError: null,
    focusRequested: null,
    focused: () => void calls.push(["focused"]),
    ...over,
  };
  return { writes, calls };
}

const changeable = { resource: { name: "preview-lychee-land", repo: "preview-site", result: "awaiting-image" } };

describe("RepositoryCard without writes", () => {
  test("its buttons do nothing and nothing is disabled", async () => {
    const { payload } = await seedSiteDetailPayload("app.lychee.land");
    const { container } = render(<RepositoryCard payload={payload} />);
    const deploy = container.querySelector<HTMLButtonElement>("[data-deploy]");
    assert.ok(deploy);
    assert.equal(deploy.disabled, false);
    fireEvent.click(deploy);
  });

  test("renders nothing for a site with no scaffold", async () => {
    const { payload } = await seedSiteDetailPayload("blog.lychee.land");
    const { container } = render(<RepositoryCard payload={payload} />);
    assert.equal(container.innerHTML, "");
  });
});

describe("RepositoryCard with writes", () => {
  test("Deploy calls deploy(name, tag), and a busy name disables it", async () => {
    const { payload } = await seedSiteDetailPayload("app.lychee.land");
    const { writes, calls } = fakeWrites();
    const { container, rerender } = render(<RepositoryCard payload={payload} writes={writes} />);
    fireEvent.click(container.querySelector("[data-deploy]")!);
    assert.deepEqual(calls, [["deploy", "app-lychee-land", "0.3.0"]]);
    rerender(<RepositoryCard payload={payload} writes={{ ...writes, busy: new Set(["app-lychee-land"]) }} />);
    assert.equal(container.querySelector<HTMLButtonElement>("[data-deploy]")!.disabled, true);
  });

  test("the first deploy's Primary offer calls deploy too", async () => {
    const { payload } = await seedSiteDetailPayload("broken.lychee.land");
    const { writes, calls } = fakeWrites();
    const { container } = render(<RepositoryCard payload={payload} writes={writes} />);
    fireEvent.click(container.querySelector("[data-deploy]")!);
    assert.deepEqual(calls, [["deploy", "broken-lychee-land", "0.1.1"]]);
  });

  // Prune moved from the card's detached warning to the page's retired notice
  // (the retired-state spec, 2026-10-26); the card itself carries none.
  test("Prune in the retired notice calls prune(name), and the card carries no Prune", async () => {
    const { payload } = await seedSiteDetailPayload("gone.lychee.land");
    const { writes, calls } = fakeWrites();
    const card = render(<RepositoryCard payload={payload} writes={writes} />);
    assert.ok(!card.container.querySelector("[data-prune]"));
    card.unmount();
    const { container, rerender } = render(<RetiredNotice name="gone-lychee-land" controls={writes} />);
    fireEvent.click(container.querySelector('[data-prune="gone-lychee-land"]')!);
    assert.deepEqual(calls, [["prune", "gone-lychee-land"]]);
    rerender(<RetiredNotice name="gone-lychee-land" controls={{ ...writes, busy: new Set(["gone-lychee-land"]) }} />);
    assert.equal(container.querySelector<HTMLButtonElement>("[data-prune]")!.disabled, true);
  });

  test("Attach sends the trimmed repository name", async () => {
    const { payload } = await seedSiteDetailPayload("legacy.lychee.land");
    const { writes, calls } = fakeWrites();
    const { container } = render(<RepositoryCard payload={payload} writes={writes} />);
    const input = container.querySelector<HTMLInputElement>("#attach-repo")!;
    fireEvent.change(input, { target: { value: "  legacy-site " } });
    fireEvent.submit(container.querySelector("form[data-attach]")!);
    assert.deepEqual(calls, [["attach", "legacy-site"]]);
    const error = container.querySelector("#attach-error")!;
    assert.ok(error.classList.contains("hidden"));
  });

  test("an empty Attach is refused in the form, focusing the field, and never sent", async () => {
    const { payload } = await seedSiteDetailPayload("legacy.lychee.land");
    const { writes, calls } = fakeWrites();
    const { container } = render(<RepositoryCard payload={payload} writes={writes} />);
    fireEvent.submit(container.querySelector("form[data-attach]")!);
    assert.deepEqual(calls, []);
    const error = container.querySelector("#attach-error")!;
    assert.ok(!error.classList.contains("hidden"));
    assert.equal(error.textContent, "Enter the repository's name.");
    assert.equal(document.activeElement, container.querySelector("#attach-repo"));
  });

  test("a refused Attach shows its reason, and a pending one disables the submit", async () => {
    const { payload } = await seedSiteDetailPayload("legacy.lychee.land");
    const { writes, calls } = fakeWrites({ attachError: "legacy-lychee-land.yml already exists", attaching: false });
    const { container, rerender } = render(<RepositoryCard payload={payload} writes={writes} />);
    const error = container.querySelector("#attach-error")!;
    assert.ok(!error.classList.contains("hidden"));
    assert.equal(error.textContent, "legacy-lychee-land.yml already exists");
    rerender(<RepositoryCard payload={payload} writes={{ ...writes, attaching: true }} />);
    const submit = container.querySelector<HTMLButtonElement>('form[data-attach] button[type="submit"]')!;
    assert.equal(submit.disabled, true);
    fireEvent.change(container.querySelector("#attach-repo")!, { target: { value: "x" } });
    fireEvent.submit(container.querySelector("form[data-attach]")!);
    assert.deepEqual(calls, []);
  });

  test("Change repository sends the new name, refuses an empty one, and shows a refusal", async () => {
    const { payload } = await seedSiteDetailPayload("preview.lychee.land", changeable);
    const { writes, calls } = fakeWrites();
    const { container, rerender } = render(<RepositoryCard payload={payload} writes={writes} />);
    const input = container.querySelector<HTMLInputElement>("#change-repo-repo")!;
    assert.equal(input.value, "preview-site");
    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.submit(container.querySelector("form[data-change-repository]")!);
    assert.deepEqual(calls, []);
    assert.equal(container.querySelector("#change-repo-error")!.textContent, "Enter the repository's name.");
    assert.equal(document.activeElement, input);

    // A real name clears the form's own refusal and is sent.
    fireEvent.change(input, { target: { value: " preview-app " } });
    fireEvent.submit(container.querySelector("form[data-change-repository]")!);
    assert.deepEqual(calls, [["changeRepository", "preview-app"]]);
    assert.ok(container.querySelector("#change-repo-error")!.classList.contains("hidden"));

    rerender(
      <RepositoryCard
        payload={payload}
        writes={{ ...writes, changingRepository: true, changeRepositoryError: "deployed images can't change repository" }}
      />,
    );
    const submit = container.querySelector<HTMLButtonElement>('form[data-change-repository] button[type="submit"]')!;
    assert.equal(submit.disabled, true);
    assert.equal(container.querySelector("#change-repo-error")!.textContent, "deployed images can't change repository");
  });

  test("the requested line takes focus when asked, then reports it", async () => {
    const { payload } = await seedSiteDetailPayload("app.lychee.land");
    const requested = { ...payload, resource: { ...payload.resource!, requestedTag: "0.3.0" } };
    const { writes, calls } = fakeWrites({ focusRequested: "app-lychee-land" });
    const { container } = render(<RepositoryCard payload={requested} writes={writes} />);
    assert.equal(document.activeElement, container.querySelector("[data-requested]"));
    assert.deepEqual(calls, [["focused"]]);
  });

  test("headingRef lands on the card's heading, which then takes focus", async () => {
    const { payload } = await seedSiteDetailPayload("legacy.lychee.land");
    let heading: HTMLHeadingElement | null = null;
    render(<RepositoryCard payload={payload} headingRef={(el) => void (heading = el)} />);
    const h = heading as HTMLHeadingElement | null;
    assert.equal(h?.textContent, "From a repository");
    assert.equal(h?.tabIndex, -1);
  });
});
