import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarOptions, EventDropInfo } from "@fullcalendar/react";
import type * as CalendarModule from "@fullcalendar/react";
import MealCalendar from "../MealCalendar";

const calendar = vi.hoisted(() => ({ options: null as CalendarOptions | null }));

// Render the real calendar. Capturing its callbacks lets one test exercise a drag
// without pretending that jsdom provides real pointer geometry.
vi.mock("@fullcalendar/react", async (importOriginal) => {
  const actual = await importOriginal<typeof CalendarModule>();
  const Calendar = actual.default;
  return { ...actual, default: (props: React.ComponentProps<typeof Calendar>) => {
    calendar.options = props;
    return <Calendar {...props} />;
  } };
});

const recipes = [
  { id: 3, name: "Tomato pasta", category: "Dinner", preparationTime: 20, servings: 2 },
  { id: 4, name: "Lentil soup", category: "Lunch", preparationTime: 30, servings: 4 },
];
const planned = { id: 7, recipeId: 3, recipeName: "Tomato pasta", date: "2026-11-25" };

function json(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status }); }

function stubRequests(meals = [planned]) {
  const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
    if (url === "/api/recipes") return Promise.resolve(json({ recipes }));
    if (url === "/api/meals" && !options?.method) return Promise.resolve(json({ meals }));
    throw new Error(`Unexpected request ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-25T12:00:00Z"));
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  calendar.options = null;
});

describe("Meal calendar", () => {
  it("renders saved meals in the actual calendar and switches between month and week", async () => {
    stubRequests([planned, { id: 8, recipeId: 4, recipeName: "Lentil soup", date: planned.date }]);
    render(<MealCalendar onSessionExpired={vi.fn()} onOpenRecipes={vi.fn()} />);

    expect(await screen.findByText("Tomato pasta")).toBeInTheDocument();
    expect(screen.getByText("Lentil soup")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Month view" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Week view" }));
    expect(screen.getByRole("tab", { name: "Week view" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Month view" }));
    expect(screen.getByText("Tomato pasta")).toBeInTheDocument();
  });

  it("creates a planned meal with a numeric recipe ID and an unchanged calendar date", async () => {
    const fetchMock = stubRequests([]);
    render(<MealCalendar onSessionExpired={vi.fn()} onOpenRecipes={vi.fn()} />);
    await screen.findByText("No meals planned yet.");
    fireEvent.click(screen.getByRole("button", { name: "Add meal" }));
    fireEvent.change(screen.getByLabelText("Recipe"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-12-02" } });
    fetchMock.mockResolvedValueOnce(json({ meal: { id: 8, recipeId: 4, recipeName: "Lentil soup", date: "2026-12-02" } }, 201));
    fireEvent.click(screen.getByRole("button", { name: "Save meal" }));

    await waitFor(() => expect(screen.queryByRole("form")).not.toBeInTheDocument());
    expect(await screen.findByText("Lentil soup")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/meals", expect.objectContaining({
      method: "POST", body: JSON.stringify({ recipeId: 4, date: "2026-12-02" }), credentials: "same-origin",
    }));
  });

  it("opens a planned meal and saves changes to its recipe and date", async () => {
    const fetchMock = stubRequests();
    render(<MealCalendar onSessionExpired={vi.fn()} onOpenRecipes={vi.fn()} />);
    fireEvent.click(await screen.findByText("Tomato pasta"));
    expect(screen.getByLabelText("Date")).toHaveValue("2026-11-25");
    fireEvent.change(screen.getByLabelText("Recipe"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-26" } });
    fetchMock.mockResolvedValueOnce(json({ meal: { ...planned, recipeId: 4, recipeName: "Lentil soup", date: "2026-11-26" } }));
    fireEvent.click(screen.getByRole("button", { name: "Save meal" }));

    await waitFor(() => expect(screen.queryByRole("form")).not.toBeInTheDocument());
    expect(await screen.findByText("Lentil soup")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/meals/7", expect.objectContaining({
      method: "PUT", body: JSON.stringify({ recipeId: 4, date: "2026-11-26" }),
    }));
    expect(screen.queryByText("Tomato pasta")).not.toBeInTheDocument();
  });

  it("uses a clicked calendar date and keeps the chosen view when the form is cancelled", async () => {
    stubRequests();
    render(<MealCalendar onSessionExpired={vi.fn()} onOpenRecipes={vi.fn()} />);
    await screen.findByText("Tomato pasta");
    fireEvent.click(screen.getByRole("tab", { name: "Week view" }));
    fireEvent.click(screen.getByRole("button", { name: "Next Week" }));
    const title = screen.getByRole("table").getAttribute("aria-labelledby");
    const displayedRange = title ? document.getElementById(title)?.textContent : "";
    act(() => calendar.options?.dateClick?.({ dateStr: "2026-12-02" } as Parameters<NonNullable<CalendarOptions["dateClick"]>>[0]));

    expect(screen.getByLabelText("Date")).toHaveValue("2026-12-02");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Week view" })).toHaveAttribute("aria-selected", "true");
    expect(title && document.getElementById(title)?.textContent).toBe(displayedRange);
  });

  it("cancels removal, then removes only the planned entry after confirmation", async () => {
    const fetchMock = stubRequests();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<MealCalendar onSessionExpired={vi.fn()} onOpenRecipes={vi.fn()} />);
    fireEvent.click(await screen.findByText("Tomato pasta"));
    fireEvent.click(screen.getByRole("button", { name: "Remove meal" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    fireEvent.click(screen.getByRole("button", { name: "Remove meal" }));

    expect(await screen.findByText("No meals planned yet.")).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("recipe will stay"));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/meals/7", expect.objectContaining({ method: "DELETE", body: "{}" }));
    expect(screen.getByRole("button", { name: "Add meal" })).toBeEnabled();
  });

  it("preserves the draft after a save failure and allows retry", async () => {
    const fetchMock = stubRequests([]);
    render(<MealCalendar onSessionExpired={vi.fn()} onOpenRecipes={vi.fn()} />);
    await screen.findByText("No meals planned yet.");
    fireEvent.click(screen.getByRole("button", { name: "Add meal" }));
    fireEvent.change(screen.getByLabelText("Recipe"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-26" } });
    fetchMock.mockResolvedValueOnce(json({ message: "Unable to save the meal." }, 500));
    fireEvent.click(screen.getByRole("button", { name: "Save meal" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to save the meal.");
    expect(screen.getByLabelText("Recipe")).toHaveValue("4");
    expect(screen.getByLabelText("Date")).toHaveValue("2026-11-26");
    fetchMock.mockResolvedValueOnce(json({ meal: { id: 8, recipeId: 4, recipeName: "Lentil soup", date: "2026-11-26" } }, 201));
    fireEvent.click(screen.getByRole("button", { name: "Save meal" }));
    await waitFor(() => expect(screen.queryByRole("form")).not.toBeInTheDocument());
    expect(screen.getByText("Lentil soup")).toBeInTheDocument();
  });

  it("disables editing controls while a save is pending", async () => {
    const fetchMock = stubRequests([]);
    render(<MealCalendar onSessionExpired={vi.fn()} onOpenRecipes={vi.fn()} />);
    await screen.findByText("No meals planned yet.");
    fireEvent.click(screen.getByRole("button", { name: "Add meal" }));
    let complete!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { complete = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Save meal" }));

    expect(screen.getByLabelText("Recipe")).toBeDisabled();
    expect(screen.getByLabelText("Date")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add meal" })).toBeDisabled();
    expect(calendar.options?.editable).toBe(false);
    await act(async () => complete(json({ meal: planned }, 201)));
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.getByText("Tomato pasta")).toBeInTheDocument();
  });

  it("offers a retry when loading fails", async () => {
    const fetchMock = stubRequests();
    fetchMock.mockRejectedValueOnce(new Error("Network unavailable"));
    render(<MealCalendar onSessionExpired={vi.fn()} onOpenRecipes={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection unavailable.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Tomato pasta")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("guides a user without recipes back to the recipe collection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ recipes: [] })).mockResolvedValueOnce(json({ meals: [] })));
    const openRecipes = vi.fn();
    render(<MealCalendar onSessionExpired={vi.fn()} onOpenRecipes={openRecipes} />);
    fireEvent.click(await screen.findByRole("button", { name: "Go to my recipes" }));

    expect(openRecipes).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Add meal" })).toBeDisabled();
  });

  it("expires the session when loading planned meals returns unauthorized", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ recipes }))
      .mockResolvedValueOnce(json({ message: "Please sign in." }, 401)));
    const expired = vi.fn();
    render(<MealCalendar onSessionExpired={expired} onOpenRecipes={vi.fn()} />);
    await waitFor(() => expect(expired).toHaveBeenCalledOnce());
  });

  it("persists dragged dates and reverts a later drag when saving fails", async () => {
    const fetchMock = stubRequests();
    render(<MealCalendar onSessionExpired={vi.fn()} onOpenRecipes={vi.fn()} />);
    await screen.findByText("Tomato pasta");
    const revert = vi.fn();
    fetchMock.mockResolvedValueOnce(json({ meal: { ...planned, date: "2026-11-26" } }));
    await act(async () => calendar.options?.eventDrop?.({
      event: { id: "7", startStr: "2026-11-26" }, revert,
    } as unknown as EventDropInfo));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/meals/7", expect.objectContaining({
      method: "PUT", body: JSON.stringify({ recipeId: 3, date: "2026-11-26" }),
    }));
    expect(revert).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(json({ message: "Unable to save the new date." }, 500));
    await act(async () => calendar.options?.eventDrop?.({
      event: { id: "7", startStr: "2026-11-27" }, revert,
    } as unknown as EventDropInfo));
    expect(revert).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to save the new date.");
    expect(screen.getByText("Tomato pasta")).toBeInTheDocument();
  });
});
