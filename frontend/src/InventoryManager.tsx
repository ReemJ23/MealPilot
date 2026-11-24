import { Component } from "react";
import type { FormEvent } from "react";

interface InventoryItem {
  id: number;
  name: string;
  quantity: number | null;
  unit: string;
}

interface InventoryManagerProps { onSessionExpired: () => void }
interface InventoryManagerState {
  items: InventoryItem[];
  loading: boolean;
  loaded: boolean;
  editing: boolean;
  selectedId: number | null;
  name: string;
  quantity: string;
  unit: string;
  pending: boolean;
  error: string;
}

export default class InventoryManager extends Component<InventoryManagerProps, InventoryManagerState> {
  override state: InventoryManagerState = {
    items: [], loading: true, loaded: false, editing: false, selectedId: null,
    name: "", quantity: "", unit: "", pending: false, error: "",
  };
  private requestController?: AbortController;

  override componentDidMount(): void { void this.loadItems(); }
  override componentWillUnmount(): void { this.requestController?.abort(); }

  private startRequest(): AbortController {
    this.requestController?.abort();
    this.requestController = new AbortController();
    return this.requestController;
  }

  private async request(path: string, controller: AbortController, options: RequestInit = {}): Promise<Response> {
    const response = await fetch(`/api/inventory${path}`, {
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
      const data: { items: InventoryItem[] } = await response.json();
      if (!Array.isArray(data.items)) throw new Error("Unable to load your inventory. Please try again.");
      if (!controller.signal.aborted) this.setState({ items: data.items, loading: false, loaded: true });
    } catch (error) { this.showError(error, controller); }
  };

  private openForm = (item?: InventoryItem): void => {
    if (this.state.pending) return;
    this.setState({
      editing: true, selectedId: item?.id ?? null, name: item?.name ?? "",
      // An unknown amount stays blank. A recorded zero must stay visible.
      quantity: item?.quantity?.toString() ?? "", unit: item?.unit ?? "", error: "",
    });
  };

  private saveItem = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (this.state.pending) return;
    const { selectedId, name, quantity, unit } = this.state;
    const controller = this.startRequest();
    this.setState({ pending: true, error: "" });
    try {
      const response = await this.request(selectedId === null ? "" : `/${selectedId}`, controller, {
        method: selectedId === null ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), quantity: quantity === "" ? null : Number(quantity), unit: unit.trim() }),
      });
      const { item }: { item: InventoryItem } = await response.json();
      if (!item) throw new Error("Unable to read the saved ingredient. Please try again.");
      if (!controller.signal.aborted) {
        // Update the list from the saved response without another request.
        this.setState(({ items }) => ({
          items: [...items.filter((entry) => entry.id !== item.id), item]
            .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id),
          editing: false, selectedId: null, pending: false,
        }));
      }
    } catch (error) { this.showError(error, controller); }
  };

  private removeItem = async (item: InventoryItem): Promise<void> => {
    if (this.state.pending || !window.confirm(`Remove "${item.name}" from your kitchen inventory?`)) return;
    const controller = this.startRequest();
    this.setState({ pending: true, error: "" });
    try {
      // Successful deletion has an empty response body.
      await this.request(`/${item.id}`, controller, {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      if (!controller.signal.aborted) {
        this.setState(({ items }) => ({ items: items.filter((entry) => entry.id !== item.id), pending: false }));
      }
    } catch (error) { this.showError(error, controller); }
  };

  private renderForm() {
    const { selectedId, name, quantity, unit, pending, error } = this.state;
    return (
      <form className="card inventory-form" onSubmit={(event) => void this.saveItem(event)} aria-labelledby="inventory-form-heading">
        <h3 id="inventory-form-heading">{selectedId === null ? "Add ingredient" : "Edit ingredient"}</h3>
        <fieldset disabled={pending}>
          <label>
            Ingredient name
            <input name="name" required maxLength={100} value={name}
              onChange={(event) => this.setState({ name: event.target.value })} />
          </label>
          <div className="form-grid">
            <label>
              Quantity (optional)
              <input name="quantity" type="number" min={0} max={100000} step={0.001} value={quantity}
                aria-describedby="inventory-quantity-help" onChange={(event) => this.setState({ quantity: event.target.value })} />
            </label>
            <label>
              Unit (optional)
              <input name="unit" maxLength={30} placeholder="e.g. cups, kg, pieces" value={unit}
                onChange={(event) => this.setState({ unit: event.target.value })} />
            </label>
          </div>
          <p className="hint" id="inventory-quantity-help">Leave quantity blank when you do not know the amount. Use 0 when none remains.</p>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="actions">
            <button type="submit">{pending ? "Saving..." : "Save ingredient"}</button>
            <button type="button" className="secondary" onClick={() => this.setState({ editing: false, selectedId: null, error: "" })}>
              Cancel
            </button>
          </div>
        </fieldset>
      </form>
    );
  }

  private renderList() {
    const { items, loading, loaded, pending, error } = this.state;
    if (loading) return <p role="status">Loading inventory...</p>;
    if (!loaded) {
      return <div className="card">
        <p className="error" role="alert">{error}</p>
        <button type="button" onClick={() => void this.loadItems()}>Try again</button>
      </div>;
    }
    return (
      <>
        {error && <p className="error" role="alert">{error}</p>}
        {pending && <p role="status">Removing ingredient...</p>}
        {items.length === 0 ? (
          <div className="card empty-inventory">
            <h3>No ingredients yet</h3>
            <p>Add the ingredients you keep in your kitchen.</p>
          </div>
        ) : (
          <div className="inventory-list">
            {items.map((item) => (
              <article className="inventory-item" key={item.id}>
                <div>
                  <h3>{item.name}</h3>
                  <p>{item.quantity === null ? "Quantity not recorded" : item.quantity}{item.unit && ` ${item.quantity === null ? "· " : ""}${item.unit}`}</p>
                </div>
                <div className="actions">
                  <button type="button" className="secondary" disabled={pending} aria-label={`Edit ${item.name}`} onClick={() => this.openForm(item)}>Edit</button>
                  <button type="button" className="danger" disabled={pending} aria-label={`Remove ${item.name}`} onClick={() => void this.removeItem(item)}>Remove</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </>
    );
  }

  override render() {
    const { editing, loading, loaded, pending } = this.state;
    return (
      <section className="kitchen-inventory" aria-labelledby="inventory-heading">
        <div className="section-heading">
          <h2 id="inventory-heading">Kitchen inventory</h2>
          {!editing && <button type="button" disabled={loading || !loaded || pending} onClick={() => this.openForm()}>Add ingredient</button>}
        </div>
        {editing ? this.renderForm() : this.renderList()}
      </section>
    );
  }
}
