import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";

function healthyResponse(): Response {
  return new Response(JSON.stringify({ status: "ok", service: "mealpilot-api" }), { status: 200 });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MealPilot home", () => {
  it("confirms that the application can connect to the server", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(healthyResponse()));

    render(<App />);

    expect(await screen.findByText("MealPilot is connected")).toBeInTheDocument();
  });

  it("shows a useful message when the server cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network unavailable")));

    render(<App />);

    expect(await screen.findByText(/Connection unavailable/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("connects successfully after the user retries", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValueOnce(healthyResponse());
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByText("MealPilot is connected")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });
});
