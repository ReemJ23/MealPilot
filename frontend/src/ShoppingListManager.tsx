import { Component } from "react";
import type { FormEvent } from "react";

interface ShoppingItem {
  id: number;
  name: string;
  quantity: number | null;
  unit: string;
  purchased: boolean;
}

interface ShoppingSuggestion {
  key: string;
  name: string;
  quantity: number;
  unit: string;
  hasUnknownQuantity: boolean;
}

interface ShoppingPreview { mealCount: number; suggestions: ShoppingSuggestion[] }
interface ShoppingListProps { onSessionExpired: () => void }
interface ShoppingListState {
  items: ShoppingItem[];
  loading: boolean;
  loaded: boolean;
  mode: "list" | "edit" | "generate";
  selectedId: number | null;
  name: string;
  quantity: string;
  unit: string;
  startDate: string;
  endDate: string;
  preview: ShoppingPreview | null;
  selectedKeys: string[];
  pending: boolean;
  error: string;
  message: string;
}

export default class ShoppingListManager extends Component<ShoppingListProps, ShoppingListState> {
  override state: ShoppingListState = {
    items: [], loading: true, loaded: false, mode: "list", selectedId: null,
    name: "", quantity: "", unit: "", ...ShoppingListManager.initialPeriod(),
    preview: null, selectedKeys: [], pending: false, error: "", message: "",
  };
  private requestController?: AbortController;

  private static initialPeriod() {
    const start = new Date();
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    // Use calendar dates in the user's local time zone.
    const format = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { startDate: format(start), endDate: format(end) };
  }

  override componentDidMount(): void { void this.loadItems(); }
  override componentWillUnmount(): void { this.requestController?.abort(); }

  private startRequest(): AbortController {
    this.requestController?.abort();
    this.requestController = new AbortController();
    return this.requestController;
  }

  private async request(path: string, controller: AbortController, options: RequestInit = {}): Promise<Response> {
    const response = await fetch(`/api/shopping-list${path}`, {
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

  private loadItems = async (): Promise<void> => {
    const controller = this.startRequest();
    this.setState({ loading: true, error: "" });
    try {
      const response = await this.request("", controller);
      const data: { items: ShoppingItem[] } = await response.json();
      if (!Array.isArray(data.items)) throw new Error("Unable to load your shopping list. Please try again.");
      if (!controller.signal.aborted) this.setState({ items: data.items, loading: false, loaded: true });
    } catch (error) { this.showError(error, controller); }
  };

  private openForm = (item?: ShoppingItem): void => {
    if (this.state.pending) return;
    this.setState({ mode: "edit", selectedId: item?.id ?? null, name: item?.name ?? "",
      quantity: item?.quantity?.toString() ?? "", unit: item?.unit ?? "", error: "", message: "" });
  };

  private applyItem(item: ShoppingItem): void {
    this.setState(({ items }) => ({
      items: [...items.filter((entry) => entry.id !== item.id), item]
        .sort((a, b) => Number(a.purchased) - Number(b.purchased) || a.name.localeCompare(b.name) || a.id - b.id),
      pending: false, mode: "list", selectedId: null,
    }));
  }

  private saveItem = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (this.state.pending) return;
    const { selectedId, name, quantity, unit } = this.state;
    const controller = this.startRequest();
    this.setState({ pending: true, error: "" });
    try {
      const response = await this.request(selectedId === null ? "" : `/${selectedId}`, controller, {
        method: selectedId === null ? "POST" : "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), quantity: quantity === "" ? null : Number(quantity), unit: unit.trim() }),
      });
      const { item }: { item: ShoppingItem } = await response.json();
      if (!item) throw new Error("Unable to read the saved item. Please try again.");
      if (!controller.signal.aborted) this.applyItem(item);
    } catch (error) { this.showError(error, controller); }
  };

  private setPurchased = async (item: ShoppingItem): Promise<void> => {
    if (this.state.pending) return;
    const controller = this.startRequest();
    this.setState({ pending: true, error: "", message: "" });
    try {
      const response = await this.request(`/${item.id}`, controller, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchased: !item.purchased }),
      });
      const data: { item: ShoppingItem } = await response.json();
      if (!data.item) throw new Error("Unable to read the updated item. Please try again.");
      if (!controller.signal.aborted) this.applyItem(data.item);
    } catch (error) { this.showError(error, controller); }
  };

  private removeItem = async (item: ShoppingItem): Promise<void> => {
    if (this.state.pending || !window.confirm(`Remove "${item.name}" from your shopping list?`)) return;
    const controller = this.startRequest();
    this.setState({ pending: true, error: "", message: "" });
    try {
      // A successful deletion returns an empty body.
      await this.request(`/${item.id}`, controller, {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      if (!controller.signal.aborted) {
        this.setState(({ items }) => ({ items: items.filter((entry) => entry.id !== item.id), pending: false }));
      }
    } catch (error) { this.showError(error, controller); }
  };

  private openGenerator = (): void => {
    this.setState({ mode: "generate", preview: null, selectedKeys: [], error: "", message: "" });
  };

  private changeDate(field: "startDate" | "endDate", value: string): void {
    // A preview only applies to the dates that produced it.
    this.setState((state) => ({
      startDate: field === "startDate" ? value : state.startDate,
      endDate: field === "endDate" ? value : state.endDate,
      preview: null, selectedKeys: [], error: "",
    }));
  }

  private previewItems = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (this.state.pending) return;
    const { startDate, endDate } = this.state;
    const controller = this.startRequest();
    this.setState({ pending: true, preview: null, selectedKeys: [], error: "" });
    try {
      const response = await this.request("/preview", controller, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ startDate, endDate }),
      });
      const preview: ShoppingPreview = await response.json();
      if (!Array.isArray(preview.suggestions)) throw new Error("Unable to load missing ingredients. Please try again.");
      if (!controller.signal.aborted) {
        this.setState({ preview, selectedKeys: preview.suggestions.map((item) => item.key), pending: false });
      }
    } catch (error) { this.showError(error, controller); }
  };

  private generateItems = async (): Promise<void> => {
    const { startDate, endDate, selectedKeys, preview, pending } = this.state;
    if (pending || !preview || selectedKeys.length === 0) return;
    const controller = this.startRequest();
    this.setState({ pending: true, error: "" });
    try {
      const response = await this.request("/generate", controller, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate, selectedKeys }),
      });
      const data: { items: ShoppingItem[]; addedCount: number } = await response.json();
      if (!Array.isArray(data.items)) throw new Error("Unable to read the updated shopping list. Please try again.");
      if (!controller.signal.aborted) {
        this.setState({ items: data.items, mode: "list", pending: false, preview: null, selectedKeys: [],
          message: data.addedCount > 0 ? "Shopping list updated." : "The selected ingredients are already covered. Nothing was added." });
      }
    } catch (error) { this.showError(error, controller); }
  };

  private cancel = (): void => {
    this.setState({ mode: "list", selectedId: null, preview: null, selectedKeys: [], error: "" });
  };

  private renderForm() {
    const { selectedId, name, quantity, unit, pending, error } = this.state;
    return (
      <form className="card shopping-form" onSubmit={(event) => void this.saveItem(event)} aria-labelledby="shopping-form-heading">
        <h3 id="shopping-form-heading">{selectedId === null ? "Add item" : "Edit item"}</h3>
        <fieldset disabled={pending}>
          <label>Item name
            <input name="name" required maxLength={100} value={name} onChange={(event) => this.setState({ name: event.target.value })} />
          </label>
          <div className="form-grid">
            <label>Quantity (optional)
              <input name="quantity" type="number" min={0.001} max={9999999999.999} step={0.001} value={quantity}
                onChange={(event) => this.setState({ quantity: event.target.value })} />
            </label>
            <label>Unit (optional)
              <input name="unit" maxLength={30} value={unit} onChange={(event) => this.setState({ unit: event.target.value })} />
            </label>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="actions">
            <button type="submit">{pending ? "Saving..." : "Save item"}</button>
            <button type="button" className="secondary" onClick={this.cancel}>Cancel</button>
          </div>
        </fieldset>
      </form>
    );
  }

  private renderGenerator() {
    const { startDate, endDate, preview, selectedKeys, pending, error } = this.state;
    return (
      <form className="card shopping-form" onSubmit={(event) => void this.previewItems(event)} aria-labelledby="shopping-generator-heading">
        <h3 id="shopping-generator-heading">Generate from meals</h3>
        <p className="shopping-help">Choose the full period you plan to shop for. Recorded inventory and items still to buy count toward these meals.</p>
        <p className="shopping-help">Use matching ingredient names and units. Different units, such as g and kg, are compared separately.</p>
        <fieldset disabled={pending}>
          <div className="form-grid">
            <label>Start date
              <input type="date" required min="1000-01-01" max="9999-12-31" value={startDate}
                onChange={(event) => this.changeDate("startDate", event.target.value)} />
            </label>
            <label>End date
              <input type="date" required min={startDate || "1000-01-01"} max="9999-12-31" value={endDate}
                onChange={(event) => this.changeDate("endDate", event.target.value)} />
            </label>
          </div>
          <button type="submit" className="secondary">Find missing ingredients</button>
          {pending && <p role="status">Please wait...</p>}
          {error && <p className="error" role="alert">{error}</p>}
          {preview && (preview.mealCount === 0 ? (
            <p role="status">No meals planned for these dates. Add meals in Meal calendar or choose another period.</p>
          ) : preview.suggestions.length === 0 ? (
            <p role="status">Nothing to add. Recorded inventory and items still to buy cover these meals.</p>
          ) : (
            <div className="shopping-preview">
              <h4>Choose ingredients to add</h4>
              <div className="shopping-suggestions">
                {preview.suggestions.map((item) => (
                  <label className="shopping-check shopping-suggestion" key={item.key}>
                    <input type="checkbox" aria-label={`Include ${item.name}`} checked={selectedKeys.includes(item.key)}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        this.setState(({ selectedKeys }) => ({ selectedKeys: checked
                          ? [...selectedKeys, item.key] : selectedKeys.filter((key) => key !== item.key) }));
                      }} />
                    <span>
                      <strong>{item.name}</strong> <span>{item.quantity}{item.unit && ` ${item.unit}`} to add</span>
                      {item.hasUnknownQuantity && <span className="shopping-note">An amount is unrecorded in your inventory or list. Check what you have before adding this item.</span>}
                    </span>
                  </label>
                ))}
              </div>
              <button type="button" disabled={selectedKeys.length === 0} onClick={() => void this.generateItems()}>Add selected ingredients</button>
            </div>
          ))}
          <button type="button" className="text-button shopping-cancel" onClick={this.cancel}>Cancel</button>
        </fieldset>
      </form>
    );
  }

  private renderList() {
    const { items, loading, loaded, pending, error, message } = this.state;
    if (loading) return <p role="status">Loading shopping list...</p>;
    if (!loaded) return <div className="card">
      <p className="error" role="alert">{error}</p>
      <button type="button" onClick={() => void this.loadItems()}>Try again</button>
    </div>;
    return <>
      <p className="shopping-help">Mark items as purchased while you shop. Update your kitchen inventory after shopping before generating another list.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {pending && <p role="status">Updating shopping list...</p>}
      {message && <p role="status">{message}</p>}
      {items.length === 0 ? <div className="card empty-shopping">
        <h3>Your shopping list is empty</h3>
        <p>Add an item yourself or find missing ingredients from your planned meals.</p>
      </div> : <div className="shopping-items">
        {items.map((item) => <article className={`shopping-item${item.purchased ? " purchased" : ""}`} key={item.id}>
          <div className="shopping-details">
            <h3>{item.name}</h3>
            <p>{item.quantity === null ? "Quantity not recorded" : item.quantity}{item.unit && ` ${item.quantity === null ? "· " : ""}${item.unit}`}</p>
          </div>
          <label className="shopping-check">
            <input type="checkbox" aria-label={`Purchased ${item.name}`} checked={item.purchased} disabled={pending}
              onChange={() => void this.setPurchased(item)} />
            Purchased
          </label>
          <div className="actions">
            <button type="button" className="secondary" disabled={pending} aria-label={`Edit ${item.name}`} onClick={() => this.openForm(item)}>Edit</button>
            <button type="button" className="danger" disabled={pending} aria-label={`Remove ${item.name}`} onClick={() => void this.removeItem(item)}>Remove</button>
          </div>
        </article>)}
      </div>}
    </>;
  }

  override render() {
    const { mode, loading, loaded, pending } = this.state;
    return <section className="shopping-list" aria-labelledby="shopping-heading">
      <div className="section-heading">
        <h2 id="shopping-heading">Shopping list</h2>
        {mode === "list" && <div className="actions">
          <button type="button" className="secondary" disabled={loading || !loaded || pending} onClick={this.openGenerator}>Generate from meals</button>
          <button type="button" disabled={loading || !loaded || pending} onClick={() => this.openForm()}>Add item</button>
        </div>}
      </div>
      {mode === "edit" ? this.renderForm() : mode === "generate" ? this.renderGenerator() : this.renderList()}
    </section>;
  }
}
