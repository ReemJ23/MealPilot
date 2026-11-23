import { Component } from "react";
import type { FormEvent } from "react";

export interface Ingredient {
  name: string;
  quantity: number;
  unit: string;
}

export interface RecipeInput {
  name: string;
  category: string;
  preparationTime: number;
  servings: number;
  instructions: string;
  ingredients: Ingredient[];
}

export interface Recipe extends RecipeInput { id: number }
export type RecipeSummary = Pick<Recipe, "id" | "name" | "category" | "preparationTime" | "servings">;

interface RecipeFormProps {
  recipe: Recipe | null;
  pending: boolean;
  error: string;
  onSave: (recipe: RecipeInput) => void;
  onCancel: () => void;
}

interface IngredientDraft { key: number; name: string; quantity: string; unit: string }
interface RecipeFormState {
  name: string;
  category: string;
  preparationTime: string;
  servings: string;
  instructions: string;
  ingredients: IngredientDraft[];
}

export default class RecipeForm extends Component<RecipeFormProps, RecipeFormState> {
  private nextIngredientKey = 1;

  constructor(props: RecipeFormProps) {
    super(props);
    const recipe = props.recipe;
    this.state = {
      name: recipe?.name ?? "", category: recipe?.category ?? "",
      preparationTime: String(recipe?.preparationTime ?? 15), servings: String(recipe?.servings ?? 2),
      instructions: recipe?.instructions ?? "",
      ingredients: (recipe?.ingredients ?? [{ name: "", quantity: 1, unit: "" }]).map((ingredient) => ({
        ...ingredient, quantity: String(ingredient.quantity), key: this.nextIngredientKey++,
      })),
    };
  }

  private updateIngredient(key: number, field: "name" | "quantity" | "unit", value: string): void {
    this.setState(({ ingredients }) => ({
      ingredients: ingredients.map((ingredient) => ingredient.key === key ? { ...ingredient, [field]: value } : ingredient),
    }));
  }

  private addIngredient = (): void => {
    const ingredient = { key: this.nextIngredientKey++, name: "", quantity: "1", unit: "" };
    this.setState(({ ingredients }) => ({ ingredients: [...ingredients, ingredient] }));
  };

  private submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (this.props.pending) return;
    const { name, category, preparationTime, servings, instructions, ingredients } = this.state;
    // Keep editable numbers as strings until the form is submitted.
    this.props.onSave({
      name, category, preparationTime: Number(preparationTime), servings: Number(servings), instructions,
      ingredients: ingredients.map((ingredient) => ({
        name: ingredient.name, quantity: Number(ingredient.quantity), unit: ingredient.unit,
      })),
    });
  };

  override render() {
    const { recipe, pending, error, onCancel } = this.props;
    const { name, category, preparationTime, servings, instructions, ingredients } = this.state;
    return (
      <section className="card recipe-editor" aria-labelledby="recipe-form-heading">
        <h2 id="recipe-form-heading">{recipe ? "Edit recipe" : "New recipe"}</h2>
        <p className="intro">Save the ingredients and preparation details for your recipe.</p>
        <form onSubmit={this.submit} aria-labelledby="recipe-form-heading" aria-busy={pending}>
          <fieldset disabled={pending}>
            <div className="form-grid">
              <label>Recipe name
                <input required maxLength={120} value={name} onChange={(event) => this.setState({ name: event.target.value })} />
              </label>
              <label>Category
                <input required maxLength={50} placeholder="For example, Dinner" value={category}
                  onChange={(event) => this.setState({ category: event.target.value })} />
              </label>
              <label>Preparation time (minutes)
                <input type="number" required min={0} max={1440} step={1} value={preparationTime}
                  onChange={(event) => this.setState({ preparationTime: event.target.value })} />
              </label>
              <label>Servings
                <input type="number" required min={1} max={100} step={1} value={servings}
                  onChange={(event) => this.setState({ servings: event.target.value })} />
              </label>
            </div>

            <fieldset className="ingredients-editor">
              <legend>Ingredients</legend>
              <p className="hint">Use a quantity for each ingredient. Leave the unit blank for whole items.</p>
              {ingredients.map((ingredient, index) => (
                <div className="ingredient-fields" key={ingredient.key}>
                  <label className="ingredient-name">Ingredient {index + 1}
                    <input required maxLength={100} value={ingredient.name}
                      onChange={(event) => this.updateIngredient(ingredient.key, "name", event.target.value)} />
                  </label>
                  <label>Quantity {index + 1}
                    <input type="number" required min={0.001} max={100000} step={0.001} value={ingredient.quantity}
                      onChange={(event) => this.updateIngredient(ingredient.key, "quantity", event.target.value)} />
                  </label>
                  <label>Unit {index + 1} (optional)
                    <input maxLength={30} placeholder="g, cup, tbsp" value={ingredient.unit}
                      onChange={(event) => this.updateIngredient(ingredient.key, "unit", event.target.value)} />
                  </label>
                  <button type="button" className="secondary" aria-label={`Remove ingredient ${index + 1}`}
                    disabled={ingredients.length === 1} onClick={() => this.setState({
                      ingredients: ingredients.filter((entry) => entry.key !== ingredient.key),
                    })}>Remove</button>
                </div>
              ))}
              <button type="button" className="secondary" disabled={ingredients.length >= 50} onClick={this.addIngredient}>
                Add ingredient
              </button>
            </fieldset>

            <label>Instructions
              <textarea required maxLength={10000} rows={7} value={instructions}
                onChange={(event) => this.setState({ instructions: event.target.value })} />
            </label>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="actions">
              <button type="submit">{pending ? "Saving..." : "Save recipe"}</button>
              <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
            </div>
          </fieldset>
        </form>
      </section>
    );
  }
}
