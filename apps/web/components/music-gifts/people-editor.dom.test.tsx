// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { PersonInput } from "@/features/music-gifts/api";
import { PeopleEditor } from "./people-editor";

function Harness({ start = [] as PersonInput[] }) {
  const [people, setPeople] = useState<PersonInput[]>(start);
  const [refs, setRefs] = useState<string[]>([]);
  return (
    <>
      <PeopleEditor
        value={people}
        onChange={setPeople}
        suggestions={[
          { ref: "r1", name: "Nadia", label: "Nadia" },
          { ref: "r2", name: null, label: "Friend" },
        ]}
        buyerRefs={refs}
        onBuyerRefs={setRefs}
      />
      <span data-testid="list">{people.map((p) => `${p.email}|${p.name ?? ""}|${p.note ?? ""}`).join(";")}</span>
      <span data-testid="refs">{refs.join(",")}</span>
    </>
  );
}

afterEach(cleanup);

describe("Music gift people (DOM)", () => {
  it("adds one person with a name and a note, and refuses an address twice", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "Rumi@Example.com" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Rumi" } });
    fireEvent.change(screen.getByLabelText("Personal note"), { target: { value: "Thanks for the mix" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    expect(screen.getByTestId("list").textContent).toBe("rumi@example.com|Rumi|Thanks for the mix");
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "rumi@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    expect(screen.getByRole("status").textContent).toMatch(/already on the list/);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    expect(screen.getByRole("status").textContent).toMatch(/full email address/);
  });

  it("pastes a list, keeps the bad lines to fix, and takes people off", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Paste a list/ }));
    fireEvent.change(screen.getByLabelText("Paste email addresses"), { target: { value: "a@example.com\nB Name <b@example.com>\nbroken" } });
    fireEvent.click(screen.getByRole("button", { name: /Add these/ }));
    expect(screen.getByTestId("list").textContent).toBe("a@example.com||;b@example.com|B Name|");
    expect(screen.getByRole("status").textContent).toMatch(/Added 2 people\. Check broken\./);
    expect((screen.getByLabelText("Paste email addresses") as HTMLTextAreaElement).value).toBe("broken");
    fireEvent.click(screen.getByRole("button", { name: "Take a@example.com off" }));
    expect(screen.getByTestId("list").textContent).toBe("b@example.com|B Name|");
  });

  it("adds buyers by name only", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /From your buyers/ }));
    fireEvent.click(screen.getByLabelText("Nadia"));
    expect(screen.getByTestId("refs").textContent).toBe("r1");
    fireEvent.click(screen.getByRole("button", { name: /Add all 2 shown/ }));
    expect(screen.getByTestId("refs").textContent).toBe("r1,r2");
    expect(screen.getByText(/2 people \(2 from your buyers/)).toBeTruthy();
  });
});
