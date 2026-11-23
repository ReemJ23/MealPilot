import { Component } from "react";
import RecipeForm from "./RecipeForm";
import type { Recipe, RecipeInput, RecipeSummary } from "./RecipeForm";

interface RecipeManagerProps { onSessionExpired: () => void }
interface RecipeManagerState {
  view: "list" | "detail" | "form";
  recipes: RecipeSummary[];
  selected: Recipe | null;
  detailId: number | null;
  loading: boolean;
  pending: boolean;
  error: string;
}

export default class RecipeManager extends Component<RecipeManagerProps, RecipeManagerState> {
  override state: RecipeManagerState = {
    view: "list", recipes: [], selected: null, detailId: null, loading: true, pending: false, error: "",
  };
  private requestController?: AbortController;

  override componentDidMount(): void { void this.loadRecipes(); }
  override componentWillUnmount(): void { this.requestController?.abort(); }

  private startRequest(): AbortController {
    this.requestController?.abort();
    this.requestController = new AbortController();
    return this.requestController;
  }

  private async request(path: string, controller: AbortController, options: RequestInit = {}): Promise<Response> {
    const response = await fetch(`/api/recipes${path}`, {
      ...options, credentials: "same-origin",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
    }).catch(() => { throw new Error("Connection unavailable. Please try again."); });

    if (response.status === 401) {
      if (!controller.signal.aborted) this.props.onSessionExpired();
      throw new Error("Your session has expired. Please log in again.");
    }
    if (!response.ok) {
      const data: { message?: string } = await response.json().catch(() => ({}));
      throw new Error(data.message || "Unable to complete your request. Please try again.");
    }
    return response;
  }

  private showError(error: unknown, controller: AbortController): void {
    if (!controller.signal.aborted) {
      this.setState({ loading: false, pending: false, error: error instanceof Error ? error.message : "Please try again." });
    }
  }

  private loadRecipes = async (): Promise<void> => {
    const controller = this.startRequest();
    this.setState({ loading: true, error: "" });
    try {
      const response = await this.request("", controller);
      const data: { recipes: RecipeSummary[] } = await response.json();
      if (!Array.isArray(data.recipes)) throw new Error("Unable to load your recipes. Please try again.");
      if (!controller.signal.aborted) this.setState({ recipes: data.recipes, loading: false });
    } catch (error) { this.showError(error, controller); }
  };

  private openRecipe = async (id: number): Promise<void> => {
    const controller = this.startRequest();
    this.setState({ view: "detail", detailId: id, selected: null, loading: true, error: "" });
    try {
      const response = await this.request(`/${id}`, controller);
      const data: { recipe: Recipe } = await response.json();
      if (!data.recipe) throw new Error("Unable to load this recipe. Please try again.");
      if (!controller.signal.aborted) this.setState({ selected: data.recipe, loading: false });
    } catch (error) { this.showError(error, controller); }
  };

  private saveRecipe = async (input: RecipeInput): Promise<void> => {
    if (this.state.pending) return;
    const controller = this.startRequest();
    const id = this.state.selected?.id;
    this.setState({ pending: true, error: "" });
    try {
      const response = await this.request(id ? `/${id}` : "", controller, {
        method: id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
      });
      const { recipe }: { recipe: Recipe } = await response.json();
      if (!recipe) throw new Error("Unable to read the saved recipe. Please try again.");
      if (!controller.signal.aborted) {
        // The saved response updates the collection without a second write or reload.
        this.setState(({ recipes }) => ({
          recipes: [...recipes.filter((entry) => entry.id !== recipe.id), recipe].sort((a, b) => b.id - a.id),
          selected: recipe, detailId: recipe.id, view: "detail", pending: false,
        }));
      }
    } catch (error) { this.showError(error, controller); }
  };

  private deleteRecipe = async (): Promise<void> => {
    const recipe = this.state.selected;
    if (!recipe || this.state.pending || !window.confirm(`Delete "${recipe.name}"? This cannot be undone.`)) return;
    const controller = this.startRequest();
    this.setState({ pending: true, error: "" });
    try {
      await this.request(`/${recipe.id}`, controller, {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      if (!controller.signal.aborted) {
        this.setState(({ recipes }) => ({
          recipes: recipes.filter((entry) => entry.id !== recipe.id), selected: null, detailId: null,
          view: "list", pending: false,
        }));
      }
    } catch (error) { this.showError(error, controller); }
  };

  private showList = (): void => {
    this.requestController?.abort();
    this.setState({ view: "list", selected: null, detailId: null, loading: false, error: "" });
  };

  private renderCollection() {
    const { recipes, loading, error } = this.state;
    return (
      <section className="recipe-collection" aria-labelledby="recipes-heading">
        <div className="section-heading">
          <h2 id="recipes-heading">My recipes</h2>
          <button type="button" disabled={loading || Boolean(error)} onClick={() => this.setState({ view: "form", selected: null, error: "" })}>
            New recipe
          </button>
        </div>
        {loading ? <p role="status">Loading recipes...</p> : error ? (
          <div className="card">
            <p className="error" role="alert">{error}</p>
            <button type="button" onClick={() => void this.loadRecipes()}>Try again</button>
          </div>
        ) : recipes.length === 0 ? (
          <div className="card empty-recipes">
            <h3>No recipes yet</h3>
            <p>Add your first recipe to start building your personal collection.</p>
          </div>
        ) : (
          <div className="recipe-grid">
            {recipes.map((recipe) => (
              <article className="recipe-tile" key={recipe.id}>
                <p className="recipe-category">{recipe.category}</p>
                <h3>{recipe.name}</h3>
                <p className="recipe-meta">{recipe.preparationTime} min · {recipe.servings} servings</p>
                <button type="button" className="secondary" aria-label={`View ${recipe.name}`}
                  onClick={() => void this.openRecipe(recipe.id)}>View recipe</button>
              </article>
            ))}
          </div>
        )}
      </section>
    );
  }

  private renderDetail() {
    const { selected, detailId, loading, pending, error } = this.state;
    return (
      <section className="card recipe-detail" aria-label="Recipe details">
        <button type="button" className="text-button" disabled={pending} onClick={this.showList}>Back to recipes</button>
        {loading ? <p role="status">Loading recipe...</p> : selected && (
          <>
            <p className="recipe-category">{selected.category}</p>
            <h2>{selected.name}</h2>
            <p className="recipe-meta">{selected.preparationTime} min preparation · {selected.servings} servings</p>
            <div className="recipe-content">
              <section>
                <h3>Ingredients</h3>
                <ul className="ingredient-list">
                  {selected.ingredients.map((ingredient, index) => (
                    <li key={index}>{[ingredient.quantity, ingredient.unit, ingredient.name].filter((value) => value !== "").join(" ")}</li>
                  ))}
                </ul>
              </section>
              <section>
                <h3>Instructions</h3>
                <p className="instructions">{selected.instructions}</p>
              </section>
            </div>
            <div className="actions">
              <button type="button" disabled={pending} onClick={() => this.setState({ view: "form", error: "" })}>Edit recipe</button>
              <button type="button" className="danger" disabled={pending} onClick={() => void this.deleteRecipe()}>
                {pending ? "Deleting..." : "Delete recipe"}
              </button>
            </div>
          </>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        {!loading && !selected && detailId !== null && (
          <button type="button" onClick={() => void this.openRecipe(detailId)}>Try again</button>
        )}
      </section>
    );
  }

  override render() {
    if (this.state.view === "form") {
      return <RecipeForm recipe={this.state.selected} pending={this.state.pending} error={this.state.error}
        onSave={(input) => void this.saveRecipe(input)} onCancel={() => {
          if (this.state.selected) this.setState({ view: "detail", error: "" });
          else this.showList();
        }} />;
    }
    return this.state.view === "detail" ? this.renderDetail() : this.renderCollection();
  }
}
