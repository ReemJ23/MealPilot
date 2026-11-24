import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RecipeDiscovery from "../RecipeDiscovery";

const summary = { idMeal: "52772", strMeal: "Tomato pasta", strMealThumb: null };
const detail = {
  ...summary, strCategory: "Pasta", strArea: "Italian",
  strInstructions: "Boil the pasta and add tomatoes.",
  strIngredient1: "Pasta", strMeasure1: "200 g",
  strIngredient2: "Tomatoes", strMeasure2: "to taste",
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

async function searchAndOpen() {
  fireEvent.change(screen.getByLabelText("Search by recipe name"), { target: { value: "pasta" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  fireEvent.click(await screen.findByRole("button", { name: "View Tomato pasta" }));
  await screen.findByRole("button", { name: "Review and save recipe" });
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Recipe discovery", () => {
  it("searches TheMealDB and opens the selected recipe", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ meals: [summary] })).mockResolvedValueOnce(json({ meals: [detail] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<RecipeDiscovery onCancel={vi.fn()} onSaved={vi.fn()} onSessionExpired={vi.fn()} />);
    await searchAndOpen();
    expect(screen.getByText("Boil the pasta and add tomatoes.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(1,
      "https://www.themealdb.com/api/json/v1/1/search.php?s=pasta", expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(2,
      "https://www.themealdb.com/api/json/v1/1/lookup.php?i=52772", expect.any(Object));
  });

  it("handles an empty search result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ meals: null })));
    render(<RecipeDiscovery onCancel={vi.fn()} onSaved={vi.fn()} onSessionExpired={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search by recipe name"), { target: { value: "nothing" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("No recipes found. Try another search.")).toBeInTheDocument();
  });

  it("opens an editable recipe with a warning for nonnumeric measures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ meals: [summary] })).mockResolvedValueOnce(json({ meals: [detail] })));
    render(<RecipeDiscovery onCancel={vi.fn()} onSaved={vi.fn()} onSessionExpired={vi.fn()} />);
    await searchAndOpen();
    fireEvent.click(screen.getByRole("button", { name: "Review and save recipe" }));
    expect(await screen.findByRole("heading", { name: "New recipe" })).toBeInTheDocument();
    expect(screen.getByText(/Some amounts could not be converted/)).toBeInTheDocument();
    expect(screen.getByLabelText("Quantity 1")).toHaveValue(200);
    expect(screen.getByLabelText("Quantity 2")).toHaveValue(1);
    expect(screen.getByLabelText("Unit 2 (optional)")).toHaveValue("to taste");
  });

  it("saves the reviewed recipe to the user's collection", async () => {
    const saved = { id: 91, name: "Tomato pasta", category: "Pasta", preparationTime: 0,
      servings: 2, instructions: detail.strInstructions,
      ingredients: [{ name: "Pasta", quantity: 200, unit: "g" }, { name: "Tomatoes", quantity: 1, unit: "to taste" }] };
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ meals: [summary] }))
      .mockResolvedValueOnce(json({ meals: [detail] })).mockResolvedValueOnce(json({ recipe: saved }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();
    render(<RecipeDiscovery onCancel={vi.fn()} onSaved={onSaved} onSessionExpired={vi.fn()} />);
    await searchAndOpen();
    fireEvent.click(screen.getByRole("button", { name: "Review and save recipe" }));
    fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/recipes", expect.objectContaining({
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
    }));
  });

  it("shows a service error without saving", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
    render(<RecipeDiscovery onCancel={vi.fn()} onSaved={vi.fn()} onSessionExpired={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search by recipe name"), { target: { value: "pasta" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
  });
});
