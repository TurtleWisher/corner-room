// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { useAsync } from "./use-async";

afterEach(cleanup);

function Probe({ auth }: { auth: string }) {
  const data = useAsync(async () => {
    if (auth === "loading") return null;
    await Promise.resolve();
    return `loaded for ${auth}`;
  }, [auth]);
  return <p>{data.status === "ok" ? (data.data ?? "waiting") : data.status}</p>;
}

function Harness() {
  const [auth, setAuth] = useState("loading");
  return (
    <>
      <button onClick={() => setAuth("anonymous")}>resolve</button>
      <Probe auth={auth} />
    </>
  );
}

describe("useAsync", () => {
  it("reloads when its deps change and shows the latest result (StrictMode)", async () => {
    render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    await act(async () => {});
    await act(async () => {
      screen.getByText("resolve").click();
    });
    await act(async () => {});
    expect(screen.getByText("loaded for anonymous")).toBeTruthy();
  });
});
