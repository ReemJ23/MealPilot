import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ShoppingListManager from "../ShoppingListManager";

const rice = { id: 7, name: "Rice", quantity: 1.5, unit: "kg", purchased: false };
const period = { startDate: "2026-11-24", endDate: "2026-11-30" };
const preview = { mealCount: 2, suggestions: [
  { key: "rice-kg", name: "Rice", quantity: 1.5, unit: "kg", hasUnknownQuantity: false },
  { key: "salt-g", name: "Salt", quantity: 5, unit: "g", hasUnknownQuantity: true },
] };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function fetchResponses(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function openNewItem(): Promise<void> {
  await screen.findByText("Your shopping list is empty");
  fireEvent.click(screen.getByRole("button", { name: "Add item" }));
  fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "Rice" } });
}

async function openGenerator(): Promise<void> {
  await waitFor(() => expect(screen.getByRole("button", { name: "Generate from meals" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Generate from meals" }));
  fireEvent.change(screen.getByLabelText("Start date"), { target: { value: period.startDate } });
  fireEvent.change(screen.getByLabelText("End date"), { target: { value: period.endDate } });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Shopping list", () => {
  it("shows measured and unknown quantities and saved purchase status", async () => {
    fetchResponses(jsonResponse({ items: [rice, { id: 8, name: "Salt", quantity: null, unit: "", purchased: true }] }));
    render(<ShoppingListManager onSessionExpired={vi.fn()} />);

    expect(await screen.findByText("1.5 kg")).toBeInTheDocument();
    expect(screen.getByText("Quantity not recorded")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Purchased Rice" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Purchased Salt" })).toBeChecked();
    expect(screen.getByText(/Update your kitchen inventory after shopping/)).toBeInTheDocument();
  });

  it("reloads the list after a connection failure", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce(jsonResponse({ items: [rice] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ShoppingListManager onSessionExpired={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Rice" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("adds a manual item with trimmed text and a numeric quantity", async () => {
    const fetchMock = fetchResponses(jsonResponse({ items: [] }), jsonResponse({ item: rice }, 201));
    render(<ShoppingListManager onSessionExpired={vi.fn()} />);
    await openNewItem();
    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: " Rice " } });
    fireEvent.change(screen.getByLabelText("Quantity (optional)"), { target: { value: "1.5" } });
    fireEvent.change(screen.getByLabelText("Unit (optional)"), { target: { value: " kg " } });
    fireEvent.click(screen.getByRole("button", { name: "Save item" }));

    expect(await screen.findByText("1.5 kg")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/shopping-list", expect.objectContaining({
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Rice", quantity: 1.5, unit: "kg" }),
    }));
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("saves an unknown amount as null and prevents a recorded zero amount", async () => {
    const fetchMock = fetchResponses(jsonResponse({ items: [] }), jsonResponse({ item: { ...rice, quantity: null, unit: "" } }, 201));
    render(<ShoppingListManager onSessionExpired={vi.fn()} />);
    await openNewItem();
    fireEvent.change(screen.getByLabelText("Quantity (optional)"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save item" }));
    expect(screen.getByLabelText("Quantity (optional)")).toBeInvalid();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Quantity (optional)"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save item" }));

    expect(await screen.findByText("Quantity not recorded")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/shopping-list", expect.objectContaining({
      body: JSON.stringify({ name: "Rice", quantity: null, unit: "" }),
    }));
  });

  it("edits an item without resetting its purchased state and can clear its quantity", async () => {
    const fetchMock = fetchResponses(jsonResponse({ items: [{ ...rice, purchased: true }] }),
      jsonResponse({ item: { ...rice, name: "Brown rice", quantity: null, purchased: true } }));
    render(<ShoppingListManager onSessionExpired={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Rice" }));
    expect(screen.getByLabelText("Quantity (optional)")).toHaveValue(1.5);
    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "Brown rice" } });
    fireEvent.change(screen.getByLabelText("Quantity (optional)"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save item" }));

    expect(await screen.findByRole("checkbox", { name: "Purchased Brown rice" })).toBeChecked();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/shopping-list/7", expect.objectContaining({
      method: "PUT", body: JSON.stringify({ name: "Brown rice", quantity: null, unit: "kg" }),
    }));
    expect(screen.queryByRole("heading", { name: "Rice" })).not.toBeInTheDocument();
  });

  it("preserves a failed save so the user can retry the same draft", async () => {
    fetchResponses(jsonResponse({ items: [] }), jsonResponse({ message: "Unable to save this item." }, 500),
      jsonResponse({ item: rice }, 201));
    render(<ShoppingListManager onSessionExpired={vi.fn()} />);
    await openNewItem();
    fireEvent.change(screen.getByLabelText("Quantity (optional)"), { target: { value: "1.5" } });
    fireEvent.change(screen.getByLabelText("Unit (optional)"), { target: { value: "kg" } });
    fireEvent.click(screen.getByRole("button", { name: "Save item" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to save this item.");
    expect(screen.getByLabelText("Item name")).toHaveValue("Rice");
    expect(screen.getByLabelText("Quantity (optional)")).toHaveValue(1.5);
    expect(screen.getByLabelText("Unit (optional)")).toHaveValue("kg");
    fireEvent.click(screen.getByRole("button", { name: "Save item" }));
    expect(await screen.findByText("1.5 kg")).toBeInTheDocument();
  });

  it("marks an item purchased and can mark it still to buy again", async () => {
    const fetchMock = fetchResponses(jsonResponse({ items: [rice] }), jsonResponse({ item: { ...rice, purchased: true } }),
      jsonResponse({ item: rice }));
    render(<ShoppingListManager onSessionExpired={vi.fn()} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Purchased Rice" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Purchased Rice" })).toBeChecked());
    expect(fetchMock).toHaveBeenLastCalledWith("/api/shopping-list/7", expect.objectContaining({
      method: "PATCH", body: JSON.stringify({ purchased: true }),
    }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Purchased Rice" }));

    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Purchased Rice" })).not.toBeChecked());
    expect(fetchMock).toHaveBeenLastCalledWith("/api/shopping-list/7", expect.objectContaining({
      method: "PATCH", body: JSON.stringify({ purchased: false }),
    }));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps the saved purchase state after a failed update", async () => {
    fetchResponses(jsonResponse({ items: [rice] }), jsonResponse({ message: "Unable to update this item." }, 500));
    render(<ShoppingListManager onSessionExpired={vi.fn()} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Purchased Rice" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to update this item.");
    expect(screen.getByRole("checkbox", { name: "Purchased Rice" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Purchased Rice" })).toBeEnabled();
  });

  it("removes an item only after confirmation and accepts an empty response", async () => {
    vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const fetchMock = fetchResponses(jsonResponse({ items: [rice] }), new Response(null, { status: 204 }));
    render(<ShoppingListManager onSessionExpired={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Rice" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Rice" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Rice" }));

    expect(await screen.findByText("Your shopping list is empty")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/shopping-list/7", expect.objectContaining({
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: "{}",
    }));
  });

  it("keeps an item visible after a failed removal", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fetchResponses(jsonResponse({ items: [rice] }), jsonResponse({ message: "Please try removing this item again." }, 500));
    render(<ShoppingListManager onSessionExpired={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Rice" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Please try removing this item again.");
    expect(screen.getByRole("heading", { name: "Rice" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Rice" })).toBeEnabled();
  });

  it("disables the manual form while saving", async () => {
    let finishSave!: (response: Response) => void;
    const pendingSave = new Promise<Response>((resolve) => { finishSave = resolve; });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ items: [] })).mockReturnValueOnce(pendingSave));
    render(<ShoppingListManager onSessionExpired={vi.fn()} />);
    await openNewItem();
    fireEvent.click(screen.getByRole("button", { name: "Save item" }));

    expect(screen.getByLabelText("Item name")).toBeDisabled();
    expect(screen.getByLabelText("Quantity (optional)")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    finishSave(jsonResponse({ item: { ...rice, quantity: null, unit: "" } }, 201));
    expect(await screen.findByText("Quantity not recorded")).toBeInTheDocument();
  });

  it("notifies the account screen when a save reports an expired session", async () => {
    const onSessionExpired = vi.fn();
    fetchResponses(jsonResponse({ items: [] }), jsonResponse({ message: "Please log in." }, 401));
    render(<ShoppingListManager onSessionExpired={onSessionExpired} />);
    await openNewItem();
    fireEvent.click(screen.getByRole("button", { name: "Save item" }));

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
  });
});

describe("Shopping list generation", () => {
  it("defaults to local today and the following six days without generating automatically", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 28, 23, 30));
    const fetchMock = fetchResponses(jsonResponse({ items: [] }));
    render(<ShoppingListManager onSessionExpired={vi.fn()} />);
    await screen.findByText("Your shopping list is empty");
    fireEvent.click(screen.getByRole("button", { name: "Generate from meals" }));

    expect(screen.getByLabelText("Start date")).toHaveValue("2026-11-28");
    expect(screen.getByLabelText("End date")).toHaveValue("2026-12-04");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("previews the chosen dates and adds only selected ingredient keys after confirmation", async () => {
    const fetchMock = fetchResponses(jsonResponse({ items: [] }), jsonResponse(preview),
      jsonResponse({ items: [rice], addedCount: 1 }));
    render(<ShoppingListManager onSessionExpired={vi.fn()} />);
    await openGenerator();
    fireEvent.click(screen.getByRole("button", { name: "Find missing ingredients" }));

    expect(await screen.findByRole("checkbox", { name: "Include Rice" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Include Salt" })).toBeChecked();
    expect(screen.getByText(/An amount is unrecorded/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/shopping-list/preview", expect.objectContaining({
      method: "POST", body: JSON.stringify(period),
    }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Salt" }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected ingredients" }));

    expect(await screen.findByText("Shopping list updated.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Rice" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/shopping-list/generate", expect.objectContaining({
      method: "POST", body: JSON.stringify({ ...period, selectedKeys: ["rice-kg"] }),
    }));
  });

  it.each([
    ["Start date", "2026-11-25"], ["End date", "2026-12-01"],
  ])("clears the previous preview when %s changes", async (label, value) => {
    const fetchMock = fetchResponses(jsonResponse({ items: [] }), jsonResponse(preview));
    render(<ShoppingListManager onSessionExpired={vi.fn()} />);
    await openGenerator();
    fireEvent.click(screen.getByRole("button", { name: "Find missing ingredients" }));
    await screen.findByRole("checkbox", { name: "Include Rice" });
    fireEvent.change(screen.getByLabelText(label), { target: { value } });

    expect(screen.queryByRole("checkbox", { name: "Include Rice" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add selected ingredients" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find missing ingredients" })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    [0, "No meals planned for these dates."],
    [2, "Nothing to add."],
  ])("explains an empty preview for %i planned meals", async (mealCount, message) => {
    fetchResponses(jsonResponse({ items: [] }), jsonResponse({ mealCount, suggestions: [] }));
    render(<ShoppingListManager onSessionExpired={vi.fn()} />);
    await openGenerator();
    fireEvent.click(screen.getByRole("button", { name: "Find missing ingredients" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(message));
    expect(screen.queryByRole("button", { name: "Add selected ingredients" })).not.toBeInTheDocument();
  });

  it("prevents confirmation when every suggestion is unchecked", async () => {
    const fetchMock = fetchResponses(jsonResponse({ items: [] }), jsonResponse(preview));
    render(<ShoppingListManager onSessionExpired={vi.fn()} />);
    await openGenerator();
    fireEvent.click(screen.getByRole("button", { name: "Find missing ingredients" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Include Rice" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Salt" }));

    expect(screen.getByRole("button", { name: "Add selected ingredients" })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("allows a failed preview to be retried for the same dates", async () => {
    fetchResponses(jsonResponse({ items: [] }), jsonResponse({ message: "Unable to compare ingredients." }, 500),
      jsonResponse(preview));
    render(<ShoppingListManager onSessionExpired={vi.fn()} />);
    await openGenerator();
    fireEvent.click(screen.getByRole("button", { name: "Find missing ingredients" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to compare ingredients.");
    expect(screen.getByLabelText("Start date")).toHaveValue(period.startDate);
    expect(screen.getByLabelText("End date")).toHaveValue(period.endDate);
    fireEvent.click(screen.getByRole("button", { name: "Find missing ingredients" }));
    expect(await screen.findByRole("checkbox", { name: "Include Rice" })).toBeChecked();
  });

  it("keeps selections after a failed confirmation and handles a refreshed no-op result", async () => {
    fetchResponses(jsonResponse({ items: [] }), jsonResponse(preview),
      jsonResponse({ message: "Unable to update the shopping list." }, 500), jsonResponse({ items: [rice], addedCount: 0 }));
    render(<ShoppingListManager onSessionExpired={vi.fn()} />);
    await openGenerator();
    fireEvent.click(screen.getByRole("button", { name: "Find missing ingredients" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Include Salt" }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected ingredients" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to update the shopping list.");
    expect(screen.getByRole("checkbox", { name: "Include Rice" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Include Salt" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Add selected ingredients" }));
    expect(await screen.findByText("The selected ingredients are already covered. Nothing was added.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Rice" })).toBeInTheDocument();
  });

  it("disables dates and selections while generation is pending", async () => {
    let finishGeneration!: (response: Response) => void;
    const pendingGeneration = new Promise<Response>((resolve) => { finishGeneration = resolve; });
    const fetchMock = fetchResponses(jsonResponse({ items: [] }), jsonResponse(preview));
    fetchMock.mockReturnValueOnce(pendingGeneration);
    render(<ShoppingListManager onSessionExpired={vi.fn()} />);
    await openGenerator();
    fireEvent.click(screen.getByRole("button", { name: "Find missing ingredients" }));
    await screen.findByRole("checkbox", { name: "Include Rice" });
    fireEvent.click(screen.getByRole("button", { name: "Add selected ingredients" }));

    expect(screen.getByLabelText("Start date")).toBeDisabled();
    expect(screen.getByLabelText("End date")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Include Rice" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add selected ingredients" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    finishGeneration(jsonResponse({ items: [rice], addedCount: 1 }));
    expect(await screen.findByText("Shopping list updated.")).toBeInTheDocument();
  });
});
