import { Component } from "react";
import type { FormEvent } from "react";
import RecipeManager from "./RecipeManager";
import MealCalendar from "./MealCalendar";

interface User {
  id: number;
  name: string;
  email: string;
}

interface AppState {
  status: "checking" | "ready" | "offline";
  user: User | null;
  mode: "login" | "register";
  section: "recipes" | "calendar";
  name: string;
  email: string;
  password: string;
  pending: boolean;
  error: string;
}

export default class App extends Component<Record<string, never>, AppState> {
  override state: AppState = {
    status: "checking", user: null, mode: "login", section: "recipes",
    name: "", email: "", password: "", pending: false, error: "",
  };
  private requestController?: AbortController;

  override componentDidMount(): void {
    void this.restoreSession();
  }

  override componentWillUnmount(): void {
    this.requestController?.abort();
  }

  private startRequest(): AbortController {
    this.requestController?.abort();
    this.requestController = new AbortController();
    return this.requestController;
  }

  private async request(path: string, controller: AbortController, options: RequestInit = {}): Promise<Response> {
    // The browser sends the session cookie. Passwords and tokens are never saved locally.
    return fetch(`/api/auth/${path}`, {
      ...options,
      credentials: "same-origin",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
    }).catch(() => {
      throw new Error("Connection unavailable. Check that the server is running.");
    });
  }

  private async readUser(response: Response): Promise<User> {
    const data: { user?: User; message?: string } = await response.json();
    if (!response.ok || !data.user) {
      throw new Error(data.message || "Unable to complete your request. Please try again.");
    }
    return data.user;
  }

  private restoreSession = async (): Promise<void> => {
    const controller = this.startRequest();
    this.setState({ status: "checking", error: "" });
    try {
      const response = await this.request("me", controller);
      // A missing or expired session is normal and opens the login form.
      const user = response.status === 401 ? null : await this.readUser(response);
      if (!controller.signal.aborted) this.setState({ status: "ready", user });
    } catch {
      if (!controller.signal.aborted) this.setState({ status: "offline" });
    }
  };

  private submitAccount = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (this.state.pending) return;
    const { mode, name, email, password } = this.state;
    const controller = this.startRequest();
    this.setState({ pending: true, error: "" });

    try {
      const response = await this.request(mode, controller, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "register" ? { name, email, password } : { email, password }),
      });
      const user = await this.readUser(response);
      if (!controller.signal.aborted) {
        this.setState({ user, password: "", name: "", pending: false, section: "recipes" });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        this.setState({ pending: false, error: error instanceof Error ? error.message : "Unable to sign in." });
      }
    }
  };

  private logout = async (): Promise<void> => {
    if (this.state.pending) return;
    const controller = this.startRequest();
    this.setState({ pending: true, error: "" });
    try {
      const response = await this.request("logout", controller, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const data: { message?: string } = await response.json();
        throw new Error(data.message || "Unable to log out. Please try again.");
      }
      if (!controller.signal.aborted) {
        this.setState({ user: null, mode: "login", password: "", pending: false });
      }
    } catch (error) {
      // Keep the account visible until the server confirms logout.
      if (!controller.signal.aborted) {
        this.setState({ pending: false, error: error instanceof Error ? error.message : "Unable to log out." });
      }
    }
  };

  private switchMode = (): void => {
    this.setState(({ mode }) => ({
      mode: mode === "login" ? "register" : "login", password: "", error: "",
    }));
  };

  private sessionExpired = (): void => {
    this.requestController?.abort();
    this.setState({ user: null, mode: "login", password: "", pending: false,
      error: "Your session has expired. Please log in again." });
  };

  private openRecipes = (): void => { this.setState({ section: "recipes" }); };

  private renderForm() {
    const { mode, name, email, password, pending, error } = this.state;
    const registering = mode === "register";
    return (
      <section className="card" aria-labelledby="account-heading">
        <h2 id="account-heading">{registering ? "Create your account" : "Welcome back"}</h2>
        <p className="intro">{registering ? "Start organizing your kitchen with MealPilot." : "Log in to your MealPilot account."}</p>
        <form onSubmit={(event) => void this.submitAccount(event)} aria-labelledby="account-heading">
          <fieldset disabled={pending}>
            {registering && (
              <label>
                Name
                <input name="name" autoComplete="name" required minLength={2} maxLength={80}
                  value={name} onChange={(event) => this.setState({ name: event.target.value })} />
              </label>
            )}
            <label>
              Email
              <input name="email" type="email" autoComplete="email" required maxLength={254}
                value={email} onChange={(event) => this.setState({ email: event.target.value })} />
            </label>
            <label>
              Password
              <input name="password" type="password" autoComplete={registering ? "new-password" : "current-password"}
                required minLength={registering ? 8 : undefined} maxLength={128}
                aria-describedby={registering ? "password-help" : undefined}
                value={password} onChange={(event) => this.setState({ password: event.target.value })} />
            </label>
            {registering && <p className="hint" id="password-help">Use 8 to 128 characters.</p>}
            {error && <p className="error" role="alert">{error}</p>}
            <button className="submit" type="submit">
              {pending ? "Please wait..." : registering ? "Create account" : "Log in"}
            </button>
          </fieldset>
        </form>
        <p className="switch-mode">
          {registering ? "Already have an account? " : "New to MealPilot? "}
          <button className="text-button" type="button" disabled={pending} onClick={this.switchMode}>
            {registering ? "Log in" : "Create an account"}
          </button>
        </p>
      </section>
    );
  }

  override render() {
    const { status, user, pending, error, section } = this.state;
    return (
      <main className={`app${user ? " app-signed-in" : ""}`}>
        <header>
          <h1>MealPilot</h1>
          <p>Plan your meals and keep your kitchen organized.</p>
        </header>
        {status === "checking" && <p className="card" role="status">Checking your account...</p>}
        {status === "offline" && (
          <section className="card" aria-labelledby="connection-heading">
            <h2 id="connection-heading">Connection unavailable</h2>
            <p role="alert">Check that the server is running, then try again.</p>
            <button type="button" onClick={() => void this.restoreSession()}>Try again</button>
          </section>
        )}
        {status === "ready" && (user ? (
          <>
          <section className="card account-bar" aria-labelledby="welcome-heading">
            <div>
              <h2 id="welcome-heading">Welcome, {user.name}</h2>
              <p>{user.email}</p>
            </div>
            <button type="button" disabled={pending} onClick={() => void this.logout()}>
              {pending ? "Logging out..." : "Log out"}
            </button>
            {error && <p className="error" role="alert">{error}</p>}
          </section>
          <nav className="feature-navigation" aria-label="MealPilot sections">
            <button type="button" className={section === "recipes" ? "" : "secondary"}
              aria-pressed={section === "recipes"} disabled={pending} onClick={this.openRecipes}>My recipes</button>
            <button type="button" className={section === "calendar" ? "" : "secondary"}
              aria-pressed={section === "calendar"} disabled={pending}
              onClick={() => this.setState({ section: "calendar" })}>Meal calendar</button>
          </nav>
          {section === "recipes" ? <RecipeManager key={user.id} onSessionExpired={this.sessionExpired} /> :
            <MealCalendar key={user.id} onSessionExpired={this.sessionExpired} onOpenRecipes={this.openRecipes} />}
          </>
        ) : this.renderForm())}
      </main>
    );
  }
}
