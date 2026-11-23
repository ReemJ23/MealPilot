import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InventoryManager from "../InventoryManager";

const rice = { id: 7, name: "Rice", quantity: 1.5, unit: "kg" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function fetchResponses(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function openNewIngredient(): Promise<void> {
  await screen.findByText("No ingredients yet");
  fireEvent.click(screen.getByRole("button", { name: "Add ingredient" }));
  fireEvent.change(screen.getByLabelText("Ingredient name"), { target: { value: "Rice" } });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Kitchen inventory", () => {
  it("displays unknown quantities separately from zero and measured amounts", async () => {
    fetchResponses(jsonResponse({ items: [
      rice, { id: 8, name: "Salt", quantity: null, unit: "" }, { id: 9, name: "Milk", quantity: 0, unit: "litres" },
    ] }));
    render(<InventoryManager onSessionExpired={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "Rice" })).toBeInTheDocument();
    expect(screen.getByText("1.5 kg")).toBeInTheDocument();
    expect(screen.getByText("Quantity not recorded")).toBeInTheDocument();
    expect(screen.getByText("0 litres")).toBeInTheDocument();
  });

  it("loads the inventory after a failed request is retried", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValueOnce(jsonResponse({ items: [rice] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<InventoryManager onSessionExpired={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Rice" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("adds an ingredient with trimmed text and a numeric quantity", async () => {
    const fetchMock = fetchResponses(jsonResponse({ items: [] }), jsonResponse({ item: rice }, 201));
    render(<InventoryManager onSessionExpired={vi.fn()} />);
    await openNewIngredient();
    fireEvent.change(screen.getByLabelText("Ingredient name"), { target: { value: " Rice " } });
    fireEvent.change(screen.getByLabelText("Quantity (optional)"), { target: { value: "1.5" } });
    fireEvent.change(screen.getByLabelText("Unit (optional)"), { target: { value: " kg " } });
    fireEvent.click(screen.getByRole("button", { name: "Save ingredient" }));

    expect(await screen.findByText("1.5 kg")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/inventory", expect.objectContaining({
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Rice", quantity: 1.5, unit: "kg" }),
    }));
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("allows an ingredient to be saved without a quantity or unit", async () => {
    const fetchMock = fetchResponses(jsonResponse({ items: [] }), jsonResponse({ item: { ...rice, quantity: null, unit: "" } }, 201));
    render(<InventoryManager onSessionExpired={vi.fn()} />);
    await openNewIngredient();
    fireEvent.click(screen.getByRole("button", { name: "Save ingredient" }));

    expect(await screen.findByText("Quantity not recorded")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/inventory", expect.objectContaining({
      body: JSON.stringify({ name: "Rice", quantity: null, unit: "" }),
    }));
  });

  it.each([
    { original: 0, entered: "", saved: null },
    { original: null, entered: "0", saved: 0 },
  ])("edits quantity from $original to $saved without confusing blank and zero", async ({ original, entered, saved }) => {
    const fetchMock = fetchResponses(
      jsonResponse({ items: [{ ...rice, quantity: original }] }), jsonResponse({ item: { ...rice, quantity: saved } }),
    );
    render(<InventoryManager onSessionExpired={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Rice" }));

    expect(screen.getByLabelText("Quantity (optional)")).toHaveValue(original);
    expect(screen.getByLabelText("Unit (optional)")).toHaveValue("kg");
    fireEvent.change(screen.getByLabelText("Quantity (optional)"), { target: { value: entered } });
    fireEvent.click(screen.getByRole("button", { name: "Save ingredient" }));

    await screen.findByRole("button", { name: "Edit Rice" });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/inventory/7", expect.objectContaining({
      method: "PUT", body: JSON.stringify({ name: "Rice", quantity: saved, unit: "kg" }),
    }));
    expect(screen.getAllByRole("heading", { name: "Rice" })).toHaveLength(1);
  });

  it("keeps a failed save in the form and allows the same draft to be retried", async () => {
    fetchResponses(
      jsonResponse({ items: [] }), jsonResponse({ message: "Unable to save this ingredient." }, 500),
      jsonResponse({ item: rice }, 201),
    );
    render(<InventoryManager onSessionExpired={vi.fn()} />);
    await openNewIngredient();
    fireEvent.change(screen.getByLabelText("Quantity (optional)"), { target: { value: "1.5" } });
    fireEvent.change(screen.getByLabelText("Unit (optional)"), { target: { value: "kg" } });
    fireEvent.click(screen.getByRole("button", { name: "Save ingredient" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to save this ingredient.");
    expect(screen.getByLabelText("Ingredient name")).toHaveValue("Rice");
    expect(screen.getByLabelText("Quantity (optional)")).toHaveValue(1.5);
    fireEvent.click(screen.getByRole("button", { name: "Save ingredient" }));
    expect(await screen.findByText("1.5 kg")).toBeInTheDocument();
  });

  it("removes an ingredient only after confirmation and accepts an empty response", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const fetchMock = fetchResponses(jsonResponse({ items: [rice] }), new Response(null, { status: 204 }));
    render(<InventoryManager onSessionExpired={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Rice" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Rice" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Rice" }));

    expect(await screen.findByText("No ingredients yet")).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/inventory/7", expect.objectContaining({
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: "{}",
    }));
  });

  it("keeps the ingredient visible after a failed removal", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fetchResponses(
      jsonResponse({ items: [rice] }), jsonResponse({ message: "Please try removing the ingredient again." }, 500),
      new Response(null, { status: 204 }),
    );
    render(<InventoryManager onSessionExpired={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Rice" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Please try removing the ingredient again.");
    expect(screen.getByRole("heading", { name: "Rice" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Rice" }));
    expect(await screen.findByText("No ingredients yet")).toBeInTheDocument();
  });

  it("notifies the account screen when a session expires during a save", async () => {
    const onSessionExpired = vi.fn();
    fetchResponses(jsonResponse({ items: [] }), jsonResponse({ message: "Please sign in to continue." }, 401));
    render(<InventoryManager onSessionExpired={onSessionExpired} />);
    await openNewIngredient();
    fireEvent.click(screen.getByRole("button", { name: "Save ingredient" }));

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
  });

  it("disables the form controls while an ingredient is being saved", async () => {
    let finishSave!: (response: Response) => void;
    const pendingSave = new Promise<Response>((resolve) => { finishSave = resolve; });
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ items: [] })).mockReturnValueOnce(pendingSave);
    vi.stubGlobal("fetch", fetchMock);
    render(<InventoryManager onSessionExpired={vi.fn()} />);
    await openNewIngredient();
    fireEvent.click(screen.getByRole("button", { name: "Save ingredient" }));

    expect(screen.getByLabelText("Ingredient name")).toBeDisabled();
    expect(screen.getByLabelText("Quantity (optional)")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    finishSave(jsonResponse({ item: { ...rice, quantity: null, unit: "" } }, 201));
    expect(await screen.findByText("Quantity not recorded")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
