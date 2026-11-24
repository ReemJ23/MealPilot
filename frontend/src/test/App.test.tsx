import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";

const user = { id: 1, name: "Reem", email: "reem@example.com" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

// Recipe loading is separate from the authentication requests checked below.
function stubAuthRequests(authFetch: (input: RequestInfo | URL, options?: RequestInit) => Promise<Response>): void {
  vi.stubGlobal("fetch", (input: RequestInfo | URL, options?: RequestInit) => {
    if (String(input).startsWith("/api/recipes")) return Promise.resolve(jsonResponse({ recipes: [] }));
    return authFetch(input, options);
  });
}

function loggedOut(): Response {
  return jsonResponse({ message: "Please log in." }, 401);
}

function enterCredentials(): void {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: user.email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "MealPilot123!" } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MealPilot accounts", () => {
  it("shows the login form when there is no active session", async () => {
    stubAuthRequests(vi.fn().mockResolvedValue(loggedOut()));
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("restores the signed-in account after a page load", async () => {
    stubAuthRequests(vi.fn().mockResolvedValue(jsonResponse({ user })));
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Welcome, Reem" })).toBeInTheDocument();
    expect(screen.getByText(user.email)).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("registers an account and opens its protected home", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(loggedOut()).mockResolvedValueOnce(jsonResponse({ user }, 201));
    stubAuthRequests(fetchMock);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Create an account" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: user.name } });
    enterCredentials();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("heading", { name: "Welcome, Reem" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/auth/register", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: user.name, email: user.email, password: "MealPilot123!" }),
      credentials: "same-origin",
    }));
  });

  it("shows a login error and allows a successful retry", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(loggedOut())
      .mockResolvedValueOnce(jsonResponse({ message: "Email or password is incorrect." }, 401))
      .mockResolvedValueOnce(jsonResponse({ user }));
    stubAuthRequests(fetchMock);
    render(<App />);
    await screen.findByRole("heading", { name: "Welcome back" });
    enterCredentials();
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect.");
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("heading", { name: "Welcome, Reem" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/auth/login", expect.objectContaining({
      method: "POST", body: JSON.stringify({ email: user.email, password: "MealPilot123!" }),
    }));
  });

  it("clears the password when switching between account forms", async () => {
    stubAuthRequests(vi.fn().mockResolvedValue(loggedOut()));
    render(<App />);
    await screen.findByRole("heading", { name: "Welcome back" });
    enterCredentials();
    fireEvent.click(screen.getByRole("button", { name: "Create an account" }));

    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByLabelText("Email")).toHaveValue(user.email);
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
  });

  it("logs out and returns to the login form", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ user }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    stubAuthRequests(fetchMock);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Log out" }));

    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/auth/logout", expect.objectContaining({
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    }));
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });

  it("keeps the account visible when logout fails", async () => {
    stubAuthRequests(vi.fn().mockResolvedValueOnce(jsonResponse({ user }))
      .mockRejectedValueOnce(new Error("Network unavailable")));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Log out" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Connection unavailable.");
    expect(screen.getByRole("heading", { name: "Welcome, Reem" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeEnabled();
  });

  it("offers a retry when the server is unavailable", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValueOnce(loggedOut());
    stubAuthRequests(fetchMock);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not treat a server error as a missing session", async () => {
    stubAuthRequests(vi.fn().mockResolvedValue(jsonResponse({ message: "Database unavailable." }, 500)));
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Connection unavailable" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Log in" })).not.toBeInTheDocument();
  });

  it("returns to login when the recipe API reports an expired session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ user }))
      .mockResolvedValueOnce(jsonResponse({ message: "Please sign in to continue." }, 401)));
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Your session has expired. Please log in again.");
    expect(screen.queryByRole("heading", { name: "My recipes" })).not.toBeInTheDocument();
  });

  it("disables the form while a login request is pending", async () => {
    let finishLogin!: (response: Response) => void;
    const pendingLogin = new Promise<Response>((resolve) => { finishLogin = resolve; });
    const fetchMock = vi.fn().mockResolvedValueOnce(loggedOut()).mockReturnValueOnce(pendingLogin);
    stubAuthRequests(fetchMock);
    render(<App />);
    await screen.findByRole("heading", { name: "Welcome back" });
    enterCredentials();
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(screen.getByRole("button", { name: "Please wait..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create an account" })).toBeDisabled();
    expect(screen.getByLabelText("Email")).toBeDisabled();
    finishLogin(jsonResponse({ user }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Welcome, Reem" })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("MealPilot calendar navigation", () => {
  it("opens the calendar and returns to recipes when the user needs a recipe first", async () => {
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => Promise.resolve(
      String(input) === "/api/auth/me" ? jsonResponse({ user }) :
        String(input) === "/api/recipes" ? jsonResponse({ recipes: [] }) : jsonResponse({ meals: [] }),
    ));
    render(<App />);
    await screen.findByRole("heading", { name: "My recipes" });
    fireEvent.click(screen.getByRole("button", { name: "Meal calendar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Go to my recipes" }));

    expect(await screen.findByRole("heading", { name: "My recipes" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Welcome, Reem" })).toBeInTheDocument();
  });

  it("returns to login when the calendar API reports an expired session", async () => {
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => Promise.resolve(
      String(input) === "/api/auth/me" ? jsonResponse({ user }) :
        String(input) === "/api/recipes" ? jsonResponse({ recipes: [] }) : loggedOut(),
    ));
    render(<App />);
    await screen.findByRole("heading", { name: "My recipes" });
    fireEvent.click(screen.getByRole("button", { name: "Meal calendar" }));

    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Your session has expired. Please log in again.");
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});

describe("MealPilot inventory navigation", () => {
  it("opens the inventory and refreshes it when the user returns to the section", async () => {
    const inventoryFetch = vi.fn().mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 3, name: "Flour", quantity: 2, unit: "kg" }] }));
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      if (String(input) === "/api/inventory") return inventoryFetch();
      return Promise.resolve(String(input) === "/api/auth/me" ? jsonResponse({ user }) : jsonResponse({ recipes: [] }));
    });
    render(<App />);
    await screen.findByRole("heading", { name: "My recipes" });
    fireEvent.click(screen.getByRole("button", { name: "Kitchen inventory" }));

    expect(await screen.findByText("No ingredients yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kitchen inventory" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "My recipes" }));
    await screen.findByRole("heading", { name: "My recipes" });
    fireEvent.click(screen.getByRole("button", { name: "Kitchen inventory" }));
    expect(await screen.findByRole("heading", { name: "Flour" })).toBeInTheDocument();
    expect(inventoryFetch).toHaveBeenCalledTimes(2);
  });

  it("returns to login when the inventory API reports an expired session", async () => {
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => Promise.resolve(
      String(input) === "/api/auth/me" ? jsonResponse({ user }) :
        String(input) === "/api/recipes" ? jsonResponse({ recipes: [] }) : loggedOut(),
    ));
    render(<App />);
    await screen.findByRole("heading", { name: "My recipes" });
    fireEvent.click(screen.getByRole("button", { name: "Kitchen inventory" }));

    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Your session has expired. Please log in again.");
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("does not retain the previous user's inventory after another account logs in", async () => {
    const nextUser = { id: 2, name: "Sam", email: "sam@example.com" };
    let signedInUser = user;
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/auth/logout") return Promise.resolve(new Response(null, { status: 204 }));
      if (path === "/api/auth/login") signedInUser = nextUser;
      if (path.startsWith("/api/auth")) return Promise.resolve(jsonResponse({ user: signedInUser }));
      if (path === "/api/inventory") return Promise.resolve(jsonResponse({ items: signedInUser.id === 1 ? [
        { id: 3, name: "Flour", quantity: 2, unit: "kg" },
      ] : [] }));
      return Promise.resolve(jsonResponse({ recipes: [] }));
    });
    render(<App />);
    await screen.findByRole("heading", { name: "My recipes" });
    fireEvent.click(screen.getByRole("button", { name: "Kitchen inventory" }));
    await screen.findByRole("heading", { name: "Flour" });
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    await screen.findByRole("heading", { name: "Welcome back" });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: nextUser.email } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "MealPilot123!" } });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    await screen.findByRole("heading", { name: "Welcome, Sam" });
    expect(screen.getByRole("heading", { name: "My recipes" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Kitchen inventory" }));

    expect(await screen.findByText("No ingredients yet")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Flour" })).not.toBeInTheDocument();
  });
});

describe("MealPilot shopping list navigation", () => {
  it("opens the shopping list and refreshes it when the user returns", async () => {
    const shoppingFetch = vi.fn().mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 3, name: "Flour", quantity: 2, unit: "kg", purchased: false }] }));
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      if (String(input) === "/api/shopping-list") return shoppingFetch();
      return Promise.resolve(String(input) === "/api/auth/me" ? jsonResponse({ user }) : jsonResponse({ recipes: [] }));
    });
    render(<App />);
    await screen.findByRole("heading", { name: "My recipes" });
    fireEvent.click(screen.getByRole("button", { name: "Shopping list" }));

    expect(await screen.findByText("Your shopping list is empty")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Shopping list" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "My recipes" }));
    await screen.findByRole("heading", { name: "My recipes" });
    fireEvent.click(screen.getByRole("button", { name: "Shopping list" }));
    expect(await screen.findByRole("heading", { name: "Flour" })).toBeInTheDocument();
    expect(shoppingFetch).toHaveBeenCalledTimes(2);
  });

  it("returns to login when the shopping API reports an expired session", async () => {
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => Promise.resolve(
      String(input) === "/api/auth/me" ? jsonResponse({ user }) :
        String(input) === "/api/recipes" ? jsonResponse({ recipes: [] }) : loggedOut(),
    ));
    render(<App />);
    await screen.findByRole("heading", { name: "My recipes" });
    fireEvent.click(screen.getByRole("button", { name: "Shopping list" }));

    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Your session has expired. Please log in again.");
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("does not show the previous account's shopping list after another user logs in", async () => {
    const nextUser = { id: 2, name: "Sam", email: "sam@example.com" };
    let signedInUser = user;
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/auth/logout") return Promise.resolve(new Response(null, { status: 204 }));
      if (path === "/api/auth/login") signedInUser = nextUser;
      if (path.startsWith("/api/auth")) return Promise.resolve(jsonResponse({ user: signedInUser }));
      if (path === "/api/shopping-list") return Promise.resolve(jsonResponse({ items: signedInUser.id === 1 ? [
        { id: 3, name: "Flour", quantity: 2, unit: "kg", purchased: false },
      ] : [] }));
      return Promise.resolve(jsonResponse({ recipes: [] }));
    });
    render(<App />);
    await screen.findByRole("heading", { name: "My recipes" });
    fireEvent.click(screen.getByRole("button", { name: "Shopping list" }));
    await screen.findByRole("heading", { name: "Flour" });
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    await screen.findByRole("heading", { name: "Welcome back" });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: nextUser.email } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "MealPilot123!" } });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    await screen.findByRole("heading", { name: "Welcome, Sam" });
    expect(screen.getByRole("heading", { name: "My recipes" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Shopping list" }));

    expect(await screen.findByText("Your shopping list is empty")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Flour" })).not.toBeInTheDocument();
  });
});
