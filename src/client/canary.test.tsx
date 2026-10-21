import "./test/setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { render, screen } from "@testing-library/react";

test("the client test harness renders React into happy-dom", () => {
  render(<p>canary</p>);
  assert.ok(screen.getByText("canary"));
});
