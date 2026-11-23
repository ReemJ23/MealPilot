import { Component } from "react";

interface AppState {
  connection: "checking" | "connected" | "offline";
}

const messages = {
  checking: "Checking your connection",
  connected: "MealPilot is connected",
  offline: "Connection unavailable. Check that the server is running.",
};

export default class App extends Component<Record<string, never>, AppState> {
  override state: AppState = { connection: "checking" };
  private requestController?: AbortController;

  override componentDidMount(): void {
    void this.checkConnection();
  }

  override componentWillUnmount(): void {
    this.requestController?.abort();
  }

  private checkConnection = async (): Promise<void> => {
    // Stop the previous request when retrying or leaving the page.
    this.requestController?.abort();
    const controller = new AbortController();
    this.requestController = controller;
    this.setState({ connection: "checking" });

    try {
      const response = await fetch("/api/health", {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]),
      });
      const data: unknown = await response.json();

      // Confirm that the response came from the expected application.
      if (
        !response.ok || typeof data !== "object" || data === null ||
        !("status" in data) || data.status !== "ok" ||
        !("service" in data) || data.service !== "mealpilot-api"
      ) {
        throw new Error("The server is unavailable.");
      }

      if (!controller.signal.aborted) {
        this.setState({ connection: "connected" });
      }
    } catch {
      if (!controller.signal.aborted) {
        this.setState({ connection: "offline" });
      }
    }
  };

  override render() {
    const { connection } = this.state;

    return (
      <main className="app">
        <header>
          <h1>MealPilot</h1>
          <p>Plan your meals and keep your kitchen organized.</p>
        </header>

        <section className="connection" aria-labelledby="connection-heading">
          <h2 id="connection-heading">Connection status</h2>
          <p className={connection} role="status" aria-live="polite">
            {messages[connection]}
          </p>
          {connection === "offline" && (
            <button type="button" onClick={() => void this.checkConnection()}>
              Try again
            </button>
          )}
        </section>

        <p className="note">The application is in development. More features are coming soon.</p>
      </main>
    );
  }
}
