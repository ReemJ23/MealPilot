import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RecipeManager from "../RecipeManager";

const recipe = {
  id: 7, name: "Tomato rice", category: "Dinner", preparationTime: 25, servings: 2,
  instructions: "Cook the rice, then stir in the tomatoes.",
  ingredients: [{ name: "Rice", quantity: 1.5, unit: "cups" }],
};
const summary = {
  id: recipe.id, name: recipe.name, category: recipe.category,
  preparationTime: recipe.preparationTime, servings: recipe.servings,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function fetchResponses(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function fillRecipe(): void {
  const values = {
    "Recipe name": recipe.name, Category: recipe.category,
    "Preparation time (minutes)": "25", Servings: "2", Instructions: recipe.instructions,
    "Ingredient 1": "Rice", "Quantity 1": "1.5", "Unit 1 (optional)": "cups",
  };
  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
}

async function openNewRecipe(): Promise<void> {
  await screen.findByText("No recipes yet");
  fireEvent.click(screen.getByRole("button", { name: "New recipe" }));
  fillRecipe();
}

async function openExistingRecipe(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: `View ${recipe.name}` }));
  await screen.findByRole("button", { name: "Edit recipe" });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Recipe management", () => {
  it("shows an empty collection with an option to create a recipe", async () => {
    fetchResponses(jsonResponse({ recipes: [] }));
    render(<RecipeManager onSessionExpired={vi.fn()} />);

    expect(await screen.findByText("No recipes yet")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "My recipes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New recipe" })).toBeEnabled();
  });

  it("loads recipes successfully after a failed request is retried", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValueOnce(jsonResponse({ recipes: [summary] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<RecipeManager onSessionExpired={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: recipe.name })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows a useful message if the server returns a non-JSON error", async () => {
    fetchResponses(new Response("Service unavailable", { status: 503 }));
    render(<RecipeManager onSessionExpired={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to complete your request. Please try again.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });

  it("opens recipe details with ingredients and preparation instructions", async () => {
    const fetchMock = fetchResponses(jsonResponse({ recipes: [summary] }), jsonResponse({ recipe }));
    render(<RecipeManager onSessionExpired={vi.fn()} />);
    await openExistingRecipe();

    expect(screen.getByRole("heading", { name: recipe.name })).toBeInTheDocument();
    expect(screen.getByText(recipe.instructions)).toBeInTheDocument();
    expect(screen.getByText(/Rice/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/recipes/7", expect.objectContaining({ credentials: "same-origin" }));
  });

  it("creates a recipe with numeric quantities and updates the collection", async () => {
    const fetchMock = fetchResponses(jsonResponse({ recipes: [] }), jsonResponse({ recipe }, 201));
    render(<RecipeManager onSessionExpired={vi.fn()} />);
    await openNewRecipe();
    fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));

    expect(await screen.findByRole("heading", { name: recipe.name })).toBeInTheDocument();
    const [path, options] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(path).toBe("/api/recipes");
    expect(options).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin" });
    expect(JSON.parse(String(options.body))).toEqual({
      name: recipe.name, category: recipe.category, preparationTime: 25, servings: 2,
      instructions: recipe.instructions, ingredients: recipe.ingredients,
    });
    fireEvent.click(screen.getByRole("button", { name: "Back to recipes" }));
    expect(screen.getByRole("button", { name: `View ${recipe.name}` })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("edits an existing recipe without losing its ingredients", async () => {
    const updated = { ...recipe, name: "Herbed tomato rice", preparationTime: 35 };
    const fetchMock = fetchResponses(
      jsonResponse({ recipes: [summary] }), jsonResponse({ recipe }), jsonResponse({ recipe: updated }),
    );
    render(<RecipeManager onSessionExpired={vi.fn()} />);
    await openExistingRecipe();
    fireEvent.click(screen.getByRole("button", { name: "Edit recipe" }));
    expect(screen.getByLabelText("Ingredient 1")).toHaveValue("Rice");
    fireEvent.change(screen.getByLabelText("Recipe name"), { target: { value: updated.name } });
    fireEvent.change(screen.getByLabelText("Preparation time (minutes)"), { target: { value: "35" } });
    fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));

    expect(await screen.findByRole("heading", { name: updated.name })).toBeInTheDocument();
    const [path, options] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(path).toBe("/api/recipes/7");
    expect(options.method).toBe("PUT");
    expect(JSON.parse(String(options.body))).toMatchObject({ name: updated.name, preparationTime: 35, ingredients: recipe.ingredients });
  });

  it("preserves the form after a failed save and allows a retry", async () => {
    fetchResponses(
      jsonResponse({ recipes: [] }), jsonResponse({ message: "Unable to save the recipe." }, 500),
      jsonResponse({ recipe }, 201),
    );
    render(<RecipeManager onSessionExpired={vi.fn()} />);
    await openNewRecipe();
    fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to save the recipe.");
    expect(screen.getByLabelText("Recipe name")).toHaveValue(recipe.name);
    expect(screen.getByLabelText("Quantity 1")).toHaveValue(1.5);
    fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
    expect(await screen.findByRole("heading", { name: recipe.name })).toBeInTheDocument();
  });

  it("deletes only after confirmation and accepts an empty successful response", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const fetchMock = fetchResponses(
      jsonResponse({ recipes: [summary] }), jsonResponse({ recipe }), new Response(null, { status: 204 }),
    );
    render(<RecipeManager onSessionExpired={vi.fn()} />);
    await openExistingRecipe();
    fireEvent.click(screen.getByRole("button", { name: "Delete recipe" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading", { name: recipe.name })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete recipe" }));

    expect(await screen.findByText("No recipes yet")).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/recipes/7", expect.objectContaining({
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: "{}",
    }));
  });

  it("returns control to the account screen when the session has expired", async () => {
    const onSessionExpired = vi.fn();
    fetchResponses(jsonResponse({ message: "Please sign in to continue." }, 401));
    render(<RecipeManager onSessionExpired={onSessionExpired} />);

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
  });

  it("disables editing controls while a save is pending", async () => {
    let finishSave!: (response: Response) => void;
    const pendingSave = new Promise<Response>((resolve) => { finishSave = resolve; });
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ recipes: [] })).mockReturnValueOnce(pendingSave);
    vi.stubGlobal("fetch", fetchMock);
    render(<RecipeManager onSessionExpired={vi.fn()} />);
    await openNewRecipe();
    fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));

    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByLabelText("Recipe name")).toBeDisabled();
    finishSave(jsonResponse({ recipe }, 201));
    expect(await screen.findByRole("heading", { name: recipe.name })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the remaining ingredient when another row is removed and allows an empty unit", async () => {
    const saved = { ...recipe, ingredients: [{ name: "Tomatoes", quantity: 2, unit: "" }] };
    const fetchMock = fetchResponses(jsonResponse({ recipes: [] }), jsonResponse({ recipe: saved }, 201));
    render(<RecipeManager onSessionExpired={vi.fn()} />);
    await openNewRecipe();
    expect(screen.getByRole("button", { name: "Remove ingredient 1" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Add ingredient" }));
    fireEvent.change(screen.getByLabelText("Ingredient 2"), { target: { value: "Tomatoes" } });
    fireEvent.change(screen.getByLabelText("Quantity 2"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove ingredient 1" }));
    expect(screen.getByLabelText("Ingredient 1")).toHaveValue("Tomatoes");
    expect(screen.getByLabelText("Quantity 1")).toHaveValue(2);
    fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));

    expect(await screen.findByRole("heading", { name: recipe.name })).toBeInTheDocument();
    const options = fetchMock.mock.calls[1][1] as RequestInit;
    expect(JSON.parse(String(options.body)).ingredients).toEqual(saved.ingredients);
  });
});
