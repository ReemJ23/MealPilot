import type { InventoryInput } from "./InventoryRepository.js";
import type { Ingredient } from "./RecipeRepository.js";
import type { ShoppingItem } from "./ShoppingListRepository.js";

export const MAX_SHOPPING_QUANTITY = 9_999_999_999.999;
export const MAX_SHOPPING_THOUSANDTHS = 9_999_999_999_999;

export interface ShoppingSuggestion {
  key: string;
  name: string;
  quantity: number;
  unit: string;
  hasUnknownQuantity: boolean;
}

interface IngredientTotal {
  name: string;
  unit: string;
  remaining: number;
  hasUnknownQuantity: boolean;
}

export class ShoppingListBuilder {
  static key(name: string, unit: string): string {
    return JSON.stringify([name, unit].map((value) => value.trim().replace(/\s+/g, " ").toLowerCase()));
  }

  build(required: Ingredient[], inventory: InventoryInput[], shopping: ShoppingItem[]): ShoppingSuggestion[] {
    const totals = new Map<string, IngredientTotal>();
    for (const ingredient of required) {
      const key = ShoppingListBuilder.key(ingredient.name, ingredient.unit);
      const total = totals.get(key) ?? {
        name: ingredient.name.trim(), unit: ingredient.unit.trim(), remaining: 0, hasUnknownQuantity: false,
      };
      total.remaining += this.toThousandths(ingredient.quantity);
      if (!Number.isSafeInteger(total.remaining)) {
        throw new RangeError("The required quantity is too large. Choose a shorter date range.");
      }
      totals.set(key, total);
    }

    // Integer thousandths keep decimal amounts exact while stock is subtracted.
    for (const item of inventory) this.subtract(totals, item);
    for (const item of shopping) {
      if (!item.purchased) this.subtract(totals, item);
    }

    const suggestions: ShoppingSuggestion[] = [];
    for (const [key, total] of totals) {
      if (total.remaining > MAX_SHOPPING_THOUSANDTHS) {
        throw new RangeError("The missing quantity is too large. Choose a shorter date range.");
      }
      if (total.remaining > 0) {
        suggestions.push({
          key, name: total.name, quantity: total.remaining / 1000,
          unit: total.unit, hasUnknownQuantity: total.hasUnknownQuantity,
        });
      }
    }
    return suggestions.sort((first, second) => first.name.localeCompare(second.name) || first.unit.localeCompare(second.unit));
  }

  private subtract(totals: Map<string, IngredientTotal>, item: InventoryInput): void {
    const total = totals.get(ShoppingListBuilder.key(item.name, item.unit));
    if (!total) return;
    if (item.quantity === null) {
      // An unrecorded amount cannot safely cover a measured requirement.
      total.hasUnknownQuantity = true;
    } else {
      total.remaining = Math.max(0, total.remaining - this.toThousandths(item.quantity));
    }
  }

  private toThousandths(quantity: number): number {
    const thousandths = Math.round(quantity * 1000);
    if (quantity < 0 || !Number.isSafeInteger(thousandths) || thousandths / 1000 !== quantity) {
      throw new RangeError("An ingredient quantity cannot be calculated safely. Check its recorded amount.");
    }
    return thousandths;
  }
}
