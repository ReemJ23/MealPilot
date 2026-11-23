import { Component, createRef } from "react";
import type { FormEvent } from "react";
import FullCalendar from "@fullcalendar/react";
import type { CalendarOptions, CalendarRef, DateClickInfo, EventClickInfo, EventDropInfo, EventInput } from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import themePlugin from "@fullcalendar/react/themes/monarch";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/monarch/theme.css";
import "@fullcalendar/react/themes/monarch/palettes/green.css";
import type { RecipeSummary } from "./RecipeForm";

interface PlannedMeal { id: number; recipeId: number; recipeName: string; date: string }
interface MealCalendarProps { onSessionExpired: () => void; onOpenRecipes: () => void }
interface MealCalendarState {
  recipes: RecipeSummary[];
  meals: PlannedMeal[];
  loading: boolean;
  ready: boolean;
  pending: boolean;
  error: string;
  formOpen: boolean;
  selectedId: number | null;
  recipeId: string;
  date: string;
}

// Stable options let FullCalendar retain the chosen month and view while the form changes.
const calendarOptions: CalendarOptions = {
  plugins: [themePlugin, dayGridPlugin, interactionPlugin],
  initialView: "dayGridMonth",
  headerToolbar: { left: "prev,next today", center: "title", right: "dayGridMonth,dayGridWeek" },
  buttons: { today: { text: "Today" }, dayGridMonth: { text: "Month" }, dayGridWeek: { text: "Week" } },
  headerToolbarClass: "meal-calendar-toolbar",
  toolbarSectionClass: "meal-calendar-toolbar-section",
  toolbarTitleClass: "meal-calendar-title",
  height: "auto", firstDay: 1, fixedWeekCount: false, dayMaxEvents: 3,
  eventDurationEditable: false, eventInteractive: true, eventDisplay: "block",
  eventColor: "#245b3e", eventContrastColor: "#ffffff",
};

export default class MealCalendar extends Component<MealCalendarProps, MealCalendarState> {
  override state: MealCalendarState = {
    recipes: [], meals: [], loading: true, ready: false, pending: false, error: "",
    formOpen: false, selectedId: null, recipeId: "", date: "",
  };
  private calendar = createRef<CalendarRef>();
  private requestController?: AbortController;
  private renderedMeals?: PlannedMeal[];
  private calendarEvents: EventInput[] = [];

  override componentDidMount(): void { void this.loadCalendar(); }
  override componentWillUnmount(): void { this.requestController?.abort(); }

  private startRequest(): AbortController {
    this.requestController?.abort();
    this.requestController = new AbortController();
    return this.requestController;
  }

  private async request(path: string, controller: AbortController, options: RequestInit = {}): Promise<Response> {
    const response = await fetch(`/api/${path}`, {
      ...options, credentials: "same-origin",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
    }).catch(() => { throw new Error("Connection unavailable. Please try again."); });
    if (response.status === 401) {
      if (!controller.signal.aborted) {
        controller.abort();
        this.props.onSessionExpired();
      }
      throw new Error("Your session has expired. Please log in again.");
    }
    if (!response.ok) {
      const data: { message?: string } = await response.json().catch(() => ({}));
      throw new Error(data.message || "Unable to update your meal calendar. Please try again.");
    }
    return response;
  }

  private showError(error: unknown, controller: AbortController): void {
    if (!controller.signal.aborted) this.setState({ loading: false, pending: false,
      error: error instanceof Error ? error.message : "Unable to update your meal calendar." });
  }

  private loadCalendar = async (): Promise<void> => {
    const controller = this.startRequest();
    this.setState({ loading: true, error: "" });
    try {
      const [recipeResponse, mealResponse] = await Promise.all([
        this.request("recipes", controller), this.request("meals", controller),
      ]);
      const { recipes }: { recipes: RecipeSummary[] } = await recipeResponse.json();
      const { meals }: { meals: PlannedMeal[] } = await mealResponse.json();
      if (!Array.isArray(recipes) || !Array.isArray(meals)) throw new Error("Unable to load your meal calendar. Please try again.");
      if (!controller.signal.aborted) this.setState({ recipes, meals, loading: false, ready: true });
    } catch (error) { this.showError(error, controller); }
  };

  private openForm(date?: string, meal?: PlannedMeal): void {
    if (this.state.pending || this.state.formOpen || !this.state.recipes.length) return;
    // Local date fields avoid moving today's date when the browser is outside UTC.
    const today = new Date();
    const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    this.setState({ formOpen: true, selectedId: meal?.id ?? null, recipeId: String(meal?.recipeId ?? this.state.recipes[0].id),
      date: meal?.date ?? date ?? localToday, error: "" });
  }

  private dateClicked = (info: DateClickInfo): void => { this.openForm(info.dateStr); };
  private mealClicked = (info: EventClickInfo): void => {
    const meal = this.state.meals.find((entry) => entry.id === Number(info.event.id));
    if (meal) this.openForm(undefined, meal);
  };

  private async writeMeal(recipeId: number, date: string, id: number | null, controller: AbortController): Promise<PlannedMeal> {
    const response = await this.request(id === null ? "meals" : `meals/${id}`, controller, {
      method: id === null ? "POST" : "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipeId, date }),
    });
    const { meal }: { meal: PlannedMeal } = await response.json();
    if (!meal) throw new Error("Unable to read the saved meal. Please try again.");
    return meal;
  }

  private saveMeal = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (this.state.pending) return;
    const { recipeId, date, selectedId } = this.state;
    const controller = this.startRequest();
    this.setState({ pending: true, error: "" });
    try {
      const meal = await this.writeMeal(Number(recipeId), date, selectedId, controller);
      if (!controller.signal.aborted) this.setState(({ meals }) => ({
        meals: [...meals.filter((entry) => entry.id !== meal.id), meal], pending: false, formOpen: false,
      }), () => this.calendar.current?.getApi().gotoDate(meal.date));
    } catch (error) { this.showError(error, controller); }
  };

  private removeMeal = async (): Promise<void> => {
    const { selectedId, pending } = this.state;
    if (selectedId === null || pending || !window.confirm("Remove this planned meal? The recipe will stay in your collection.")) return;
    const controller = this.startRequest();
    this.setState({ pending: true, error: "" });
    try {
      await this.request(`meals/${selectedId}`, controller, {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      if (!controller.signal.aborted) this.setState(({ meals }) => ({
        meals: meals.filter((entry) => entry.id !== selectedId), pending: false, formOpen: false,
      }));
    } catch (error) { this.showError(error, controller); }
  };

  private moveMeal = async (info: EventDropInfo): Promise<void> => {
    const meal = this.state.meals.find((entry) => entry.id === Number(info.event.id));
    if (!meal || this.state.pending || this.state.formOpen) { info.revert(); return; }
    const controller = this.startRequest();
    this.setState({ pending: true, error: "" });
    try {
      // FullCalendar supplies a date-only startStr for all-day meals.
      const saved = await this.writeMeal(meal.recipeId, info.event.startStr, meal.id, controller);
      if (!controller.signal.aborted) this.setState(({ meals }) => ({
        meals: meals.map((entry) => entry.id === saved.id ? saved : entry), pending: false,
      }));
    } catch (error) {
      if (!controller.signal.aborted) info.revert();
      this.showError(error, controller);
    }
  };

  private events(): EventInput[] {
    // Keep the event array stable while a dragged meal is waiting for its save response.
    if (this.renderedMeals !== this.state.meals) {
      this.renderedMeals = this.state.meals;
      this.calendarEvents = this.state.meals.map((meal) => ({
        id: String(meal.id), title: meal.recipeName, start: meal.date, allDay: true,
      }));
    }
    return this.calendarEvents;
  }

  private renderForm() {
    const { selectedId, recipeId, date, recipes, pending } = this.state;
    return (
      <form className="card meal-form" aria-labelledby="meal-form-heading" onSubmit={(event) => void this.saveMeal(event)}>
        <h3 id="meal-form-heading">{selectedId === null ? "Plan a meal" : "Edit planned meal"}</h3>
        <fieldset disabled={pending}>
          <div className="form-grid">
            <label>Recipe
              <select value={recipeId} required onChange={(event) => this.setState({ recipeId: event.target.value })}>
                {recipes.map((recipe) => <option value={recipe.id} key={recipe.id}>{recipe.name}</option>)}
              </select>
            </label>
            <label>Date
              <input type="date" required min="1000-01-01" max="9999-12-31" value={date}
                onChange={(event) => this.setState({ date: event.target.value })} />
            </label>
          </div>
          <div className="actions">
            <button type="submit">{pending ? "Please wait..." : "Save meal"}</button>
            <button type="button" className="secondary" onClick={() => this.setState({ formOpen: false, error: "" })}>Cancel</button>
            {selectedId !== null && <button type="button" className="danger" onClick={() => void this.removeMeal()}>Remove meal</button>}
          </div>
        </fieldset>
      </form>
    );
  }

  override render() {
    const { loading, ready, recipes, meals, pending, error, formOpen } = this.state;
    return (
      <section className="meal-calendar" aria-labelledby="calendar-heading">
        <div className="section-heading">
          <h2 id="calendar-heading">Meal calendar</h2>
          <button type="button" disabled={!ready || pending || formOpen || !recipes.length} onClick={() => this.openForm()}>Add meal</button>
        </div>
        {loading ? <p role="status">Loading your meal calendar...</p> : !ready ? (
          <div className="card">
            <p className="error" role="alert">{error}</p>
            <button type="button" onClick={() => void this.loadCalendar()}>Try again</button>
          </div>
        ) : !recipes.length ? (
          <div className="card">
            <h3>Add a recipe to get started</h3>
            <p>Your saved recipes will be available here to plan meals.</p>
            <button type="button" onClick={this.props.onOpenRecipes}>Go to my recipes</button>
          </div>
        ) : (
          <>
            <p className="calendar-help">Choose a date to add a meal. Select a planned meal to edit it, or drag it to another day.</p>
            {!meals.length && <p>No meals planned yet.</p>}
            {error && <p className="error" role="alert">{error}</p>}
            {pending && !formOpen && <p role="status">Saving the new date...</p>}
            {formOpen && this.renderForm()}
            <div className="card calendar-card">
              <FullCalendar {...calendarOptions} ref={this.calendar} events={this.events()}
                editable={!pending && !formOpen} dateClick={this.dateClicked} eventClick={this.mealClicked}
                eventDrop={this.moveMeal} />
            </div>
          </>
        )}
      </section>
    );
  }
}
