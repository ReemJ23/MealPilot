import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";

const user = { id: 1, name: "Reem", email: "reem@example.com" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(loggedOut()));
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("restores the signed-in account after a page load", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ user })));
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Welcome, Reem" })).toBeInTheDocument();
    expect(screen.getByText(user.email)).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("registers an account and opens its protected home", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(loggedOut()).mockResolvedValueOnce(jsonResponse({ user }, 201));
    vi.stubGlobal("fetch", fetchMock);
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
    vi.stubGlobal("fetch", fetchMock);
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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(loggedOut()));
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
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Log out" }));

    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/auth/logout", expect.objectContaining({
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    }));
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });

  it("keeps the account visible when logout fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ user }))
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
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not treat a server error as a missing session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ message: "Database unavailable." }, 500)));
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Connection unavailable" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Log in" })).not.toBeInTheDocument();
  });

  it("disables the form while a login request is pending", async () => {
    let finishLogin!: (response: Response) => void;
    const pendingLogin = new Promise<Response>((resolve) => { finishLogin = resolve; });
    const fetchMock = vi.fn().mockResolvedValueOnce(loggedOut()).mockReturnValueOnce(pendingLogin);
    vi.stubGlobal("fetch", fetchMock);
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
