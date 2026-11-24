import { Component } from "react";
import type { FormEvent } from "react";
import RecipeForm from "./RecipeForm";
import type { Ingredient, Recipe, RecipeInput } from "./RecipeForm";

interface MealSummary {
  idMeal: string;
  strMeal: string;
  strMealThumb: string | null;
}

interface MealDetail extends MealSummary {
  strCategory: string | null;
  strInstructions: string | null;
  strArea: string | null;
  [key: string]: string | null;
}

interface Props {
  onCancel: () => void;
  onSaved: (recipe: Recipe) => void;
  onSessionExpired: () => void;
}

interface State {
  query: string;
  results: MealSummary[];
  selected: MealDetail | null;
  draft: RecipeInput | null;
  loading: boolean;
  saving: boolean;
  searched: boolean;
  error: string;
  note: string;
}

/** External recipes remain editable before they enter a user's private collection. */
export default class RecipeDiscovery extends Component<Props, State> {
  override state: State = {
    query: "", results: [], selected: null, draft: null, loading: false,
    saving: false, searched: false, error: "", note: "",
  };
  private controller?: AbortController;

  override componentWillUnmount(): void { this.controller?.abort(); }

  private startRequest(): AbortController {
    this.controller?.abort();
    this.controller = new AbortController();
    return this.controller;
  }

  private async mealDb(path: string, controller: AbortController): Promise<MealDetail[]> {
    // TheMealDB's documented developer key is 1. No private keys are stored in the browser.
    const response = await fetch(`https://www.themealdb.com/api/json/v1/1/${path}`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
    });
    if (!response.ok) throw new Error("Recipe service unavailable. Please try again.");
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || !("meals" in data)) {
      throw new Error("The recipe service returned an unexpected response.");
    }
    const meals = (data as { meals: unknown }).meals;
    if (meals === null) return [];
    if (!Array.isArray(meals)) throw new Error("The recipe service returned an unexpected response.");
    return meals.filter((item): item is MealDetail =>
      item !== null && typeof item === "object" &&
      typeof item.idMeal === "string" && typeof item.strMeal === "string");
  }

  private search = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const query = this.state.query.trim();
    if (!query || this.state.loading) return;
    const controller = this.startRequest();
    this.setState({ loading: true, searched: false, error: "", selected: null, draft: null });
    try {
      const results = await this.mealDb(`search.php?s=${encodeURIComponent(query)}`, controller);
      if (!controller.signal.aborted) this.setState({ results, searched: true, loading: false });
    } catch (error) {
      if (!controller.signal.aborted) this.setState({ loading: false, error: error instanceof Error ? error.message : "Search failed." });
    }
  };

  private select = async (id: string): Promise<void> => {
    if (!/^\d+$/.test(id)) return;
    const controller = this.startRequest();
    this.setState({ loading: true, error: "", draft: null });
    try {
      const meals = await this.mealDb(`lookup.php?i=${encodeURIComponent(id)}`, controller);
      if (!controller.signal.aborted) {
        this.setState({ selected: meals[0] ?? null, loading: false,
          error: meals.length ? "" : "This recipe is no longer available." });
      }
    } catch (error) {
      if (!controller.signal.aborted) this.setState({ loading: false, error: error instanceof Error ? error.message : "Unable to load recipe." });
    }
  };

  private static readMeasure(raw: string): { quantity: number; unit: string; approximate: boolean } {
    const measure = raw.trim().replace(/\s+/g, " ");
    // Read common integer, decimal, fractional and mixed-number measures.
    const match = measure.match(/^(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?(?:\s*\/\s*(\d+))?\s*(.*)$/);
    if (!match) return { quantity: 1, unit: measure.slice(0, 30), approximate: true };
    let quantity = Number(match[1]);
    let unit = match[5] ?? "";
    if (match[2] && match[3]) quantity += Number(match[2]) / Number(match[3]);
    if (match[4]) {
      quantity = Number(match[1]) / Number(match[4]);
      unit = match[5] ?? "";
    }
    const rounded = Math.round(quantity * 1000) / 1000;
    const approximate = !Number.isFinite(quantity) || quantity !== rounded || quantity <= 0 || quantity > 100000 || unit.length > 30;
    if (approximate) return { quantity: 1, unit: measure.slice(0, 30), approximate: true };
    return { quantity: rounded, unit, approximate: false };
  }

  private prepare = (): void => {
    const meal = this.state.selected;
    if (!meal) return;
    const ingredients: Ingredient[] = [];
    let needsReview = false;
    for (let index = 1; index <= 20; index++) {
      const name = meal[`strIngredient${index}`]?.trim();
      if (!name) continue;
      const measure = RecipeDiscovery.readMeasure(meal[`strMeasure${index}`] ?? "");
      ingredients.push({ name: name.slice(0, 100), quantity: measure.quantity, unit: measure.unit });
      needsReview ||= measure.approximate;
    }
    if (!ingredients.length || !meal.strInstructions?.trim()) {
      this.setState({ error: "This external recipe lacks ingredients or instructions and cannot be imported." });
      return;
    }
    const draft: RecipeInput = {
      name: meal.strMeal.slice(0, 120), category: (meal.strCategory?.trim() || "Other").slice(0, 50),
      // TheMealDB does not guarantee preparation time or serving count.
      preparationTime: 0, servings: 2, instructions: meal.strInstructions.slice(0, 10000), ingredients,
    };
    this.setState({ draft, error: "", note: needsReview
      ? "Review all ingredient measurements. Some amounts could not be converted and were set to 1. Also set preparation time and servings."
      : "Review the ingredient quantities, preparation time and servings before saving." });
  };

  private save = async (recipe: RecipeInput): Promise<void> => {
    if (this.state.saving) return;
    const controller = this.startRequest();
    this.setState({ saving: true, error: "" });
    try {
      const response = await fetch("/api/recipes", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(recipe),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      });
      if (response.status === 401) {
        if (!controller.signal.aborted) this.props.onSessionExpired();
        return;
      }
      const data: { recipe?: Recipe; message?: string } = await response.json();
      if (!response.ok || !data.recipe) throw new Error(data.message || "Unable to save recipe.");
      if (!controller.signal.aborted) this.props.onSaved(data.recipe);
    } catch (error) {
      if (!controller.signal.aborted) this.setState({ saving: false, error: error instanceof Error ? error.message : "Unable to save recipe." });
    }
  };

  override render() {
    const { query, results, selected, draft, loading, saving, searched, error, note } = this.state;
    if (draft) return <>
      <p className="card" role="status">{note}</p>
      <RecipeForm recipe={null} initialRecipe={draft} pending={saving} error={error}
        onSave={(input) => void this.save(input)} onCancel={() => this.setState({ draft: null, error: "" })} />
    </>;
    return <section className="recipe-discovery" aria-labelledby="discovery-heading">
      <div className="section-heading">
        <h2 id="discovery-heading">Discover recipes</h2>
        <button type="button" className="secondary" onClick={this.props.onCancel}>Back to my recipes</button>
      </div>
      <p>Search recipes from TheMealDB. You can review and edit a recipe before saving it to your collection.</p>
      <form className="discovery-search" onSubmit={(event) => void this.search(event)}>
        <label>Search by recipe name
          <input required maxLength={80} value={query} onChange={(event) => this.setState({ query: event.target.value })} placeholder="For example, chicken" />
        </label>
        <button type="submit" disabled={loading}>Search</button>
      </form>
      {loading && <p role="status">Loading recipes...</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {!loading && selected ? <article className="card discovery-detail">
        <button type="button" className="text-button" onClick={() => this.setState({ selected: null, error: "" })}>Back to results</button>
        <h3>{selected.strMeal}</h3>
        <p>{[selected.strCategory, selected.strArea].filter(Boolean).join(" · ")}</p>
        {selected.strMealThumb?.startsWith("https://www.themealdb.com/") &&
          <img className="discovery-photo" src={selected.strMealThumb} alt={selected.strMeal} />}
        <p className="instructions">{selected.strInstructions}</p>
        <button type="button" onClick={this.prepare}>Review and save recipe</button>
      </article> : !loading && <>
        {searched && results.length === 0 && <p role="status">No recipes found. Try another search.</p>}
        <div className="recipe-grid">
          {results.map((meal) => <article className="recipe-tile" key={meal.idMeal}>
            <h3>{meal.strMeal}</h3>
            <button type="button" className="secondary" onClick={() => void this.select(meal.idMeal)} aria-label={`View ${meal.strMeal}`}>View recipe</button>
          </article>)}
        </div>
      </>}
      <p className="discovery-credit">Recipe information provided by <a href="https://www.themealdb.com/" target="_blank" rel="noreferrer">TheMealDB</a>.</p>
    </section>;
  }
}
