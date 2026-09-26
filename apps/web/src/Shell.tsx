import type { MeResponse, Team } from "@ark/contracts";
import {
  Activity,
  Bot,
  Box,
  CalendarClock,
  ChevronRight,
  FolderGit2,
  GitBranch,
  KeyRound,
  LoaderCircle,
  LogOut,
  Menu,
  Network,
  Play,
  RefreshCw,
  Server,
  ShieldCheck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { NavLink } from "react-router-dom";
import { api, ApiRequestError, errorMessage } from "./api";
import styles from "./App.module.css";

type Props = {
  me: MeResponse;
  onExpired: () => void;
  onLogout: () => void;
  onRefresh: () => void;
};
type TeamState =
  | { kind: "loading" }
  | { kind: "ready"; context: string; team: Team }
  | { kind: "error"; context: string; message: string };

function rememberedTeam(me: MeResponse) {
  try {
    const saved = localStorage.getItem(`ark:team:${me.user.id}`);
    return (
      me.teams.find((team) => team.id === saved)?.id ?? me.teams[0]?.id ?? ""
    );
  } catch {
    return me.teams[0]?.id ?? "";
  }
}

export function Shell({ me, onExpired, onLogout, onRefresh }: Props) {
  const [choice, setChoice] = useState(() => rememberedTeam(me));
  const selected = me.teams.find((team) => team.id === choice) ?? me.teams[0];
  const [teamState, setTeamState] = useState<TeamState>({ kind: "loading" });
  const [teamAttempt, setTeamAttempt] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [navigationOpen, setNavigationOpen] = useState(false);
  const navigationRef = useRef<HTMLElement>(null);
  const navigationToggleRef = useRef<HTMLButtonElement>(null);
  const navigationCloseRef = useRef<HTMLButtonElement>(null);
  const selectedId = selected?.id;
  const selectedRole = selected?.role;
  const selectedName = selected?.name;
  const teamContext = JSON.stringify([selectedId, selectedRole, selectedName]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 761px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setNavigationOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    try {
      localStorage.setItem(`ark:team:${me.user.id}`, selectedId);
    } catch {
      /* Storage is optional. */
    }
    void api
      .team(selectedId, controller.signal)
      .then((team) => {
        if (!controller.signal.aborted)
          setTeamState({ kind: "ready", context: teamContext, team });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiRequestError && error.status === 401)
          onExpired();
        else
          setTeamState({
            kind: "error",
            context: teamContext,
            message: errorMessage(error),
          });
      });
    return () => controller.abort();
  }, [selectedId, teamContext, me.user.id, teamAttempt, onExpired]);

  function closeNavigation() {
    setNavigationOpen(false);
    requestAnimationFrame(() => navigationToggleRef.current?.focus());
  }

  function navigationKeys(event: KeyboardEvent<HTMLElement>) {
    if (!navigationOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeNavigation();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = navigationRef.current?.querySelectorAll<HTMLElement>(
      "a[href],button:not(:disabled),select:not(:disabled)",
    );
    const first = controls?.[0];
    const last = controls?.[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError("");
    try {
      await api.logout();
      onLogout();
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) onLogout();
      else setSignOutError(errorMessage(error));
    } finally {
      setSigningOut(false);
    }
  }

  function future(label: string, Icon: LucideIcon) {
    return (
      <div key={label} className={styles.futureNav} aria-disabled="true">
        <Icon size={17} aria-hidden="true" />
        <span>{label}</span>
        {label === "Schedules" && <small>Later</small>}
      </div>
    );
  }

  const team =
    teamState.kind === "ready" && teamState.context === teamContext
      ? teamState.team
      : undefined;
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main-content">
        Skip to content
      </a>
      <aside
        ref={navigationRef}
        className={`${styles.sidebar} ${navigationOpen ? styles.sidebarOpen : ""}`}
        aria-label="Workspace navigation"
        role={navigationOpen ? "dialog" : undefined}
        aria-modal={navigationOpen ? true : undefined}
        onKeyDown={navigationKeys}
      >
        <div className={styles.sidebarBrand}>
          <div className={styles.brand}>
            <Box size={23} aria-hidden="true" />
            <span>ark</span>
          </div>
          <button
            ref={navigationCloseRef}
            className={`${styles.iconButton} ${styles.mobileOnly}`}
            type="button"
            aria-label="Close navigation"
            onClick={closeNavigation}
          >
            <X size={19} />
          </button>
        </div>
        <div className={styles.organization}>
          <span className={styles.orgIcon}>
            <Users size={17} aria-hidden="true" />
          </span>
          <div>
            <strong>{me.organization.name}</strong>
            <span>Organization</span>
          </div>
        </div>
        <div className={styles.teamPicker}>
          <label htmlFor="active-team">Active team</label>
          <select
            id="active-team"
            value={selectedId ?? ""}
            onChange={(event) => {
              setChoice(event.target.value);
              setTeamState({ kind: "loading" });
            }}
            disabled={!me.teams.length}
          >
            {!me.teams.length && <option value="">No team access</option>}
            {me.teams.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        <nav aria-label="Main navigation">
          <div className={styles.navGroup}>
            <h2>Run</h2>
            <NavLink
              to="/sessions"
              className={styles.activeNav}
              onClick={() => {
                if (navigationOpen) closeNavigation();
              }}
            >
              <Play size={17} aria-hidden="true" />
              <span>Sessions</span>
            </NavLink>
            {future("Schedules", CalendarClock)}
          </div>
          <div className={styles.navGroup}>
            <h2>
              Build <span>Coming later</span>
            </h2>
            {future("Workspaces", FolderGit2)}
            {future("Agents", Bot)}
            {future("Flows", GitBranch)}
            {future("Tools & MCP", Network)}
          </div>
          <div className={styles.navGroup}>
            <h2>
              Operate <span>Coming later</span>
            </h2>
            {future("Compute", Server)}
            {future("Secrets", KeyRound)}
            {future("Activity", Activity)}
          </div>
        </nav>
        <div className={styles.sidebarFooter}>
          <span className={styles.version}>Foundation preview</span>
          <span>Local development</span>
        </div>
      </aside>
      {navigationOpen && (
        <button
          type="button"
          className={styles.backdrop}
          tabIndex={-1}
          aria-label="Dismiss navigation"
          onClick={closeNavigation}
        />
      )}
      <div className={styles.workspace} inert={navigationOpen}>
        <header className={styles.topbar}>
          <div className={styles.breadcrumb}>
            <button
              ref={navigationToggleRef}
              type="button"
              className={`${styles.iconButton} ${styles.mobileOnly}`}
              aria-label="Open navigation"
              aria-expanded={navigationOpen}
              onClick={() => {
                setNavigationOpen(true);
                requestAnimationFrame(() =>
                  navigationCloseRef.current?.focus(),
                );
              }}
            >
              <Menu size={20} />
            </button>
            <span>{selected?.name ?? me.organization.name}</span>
            <ChevronRight size={14} aria-hidden="true" />
            <strong>Sessions</strong>
          </div>
          <details
            className={styles.userMenu}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.currentTarget.open = false;
                event.currentTarget.querySelector("summary")?.focus();
              }
            }}
          >
            <summary aria-label="Account menu">
              <span className={styles.avatar}>
                {me.user.name.slice(0, 1).toUpperCase()}
              </span>
              <span className={styles.userName}>{me.user.name}</span>
            </summary>
            <div className={styles.userPopover}>
              <strong>{me.user.name}</strong>
              <span>{me.user.email}</span>
              <span className={styles.role}>{me.organization.role}</span>
              {signOutError && (
                <p className={styles.fieldError} role="alert">
                  {signOutError}
                </p>
              )}
              <button
                type="button"
                className={styles.signOut}
                onClick={() => void signOut()}
                disabled={signingOut}
              >
                <LogOut size={16} aria-hidden="true" />
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </details>
        </header>
        <main id="main-content" className={styles.mainContent} tabIndex={-1}>
          <div className={styles.pageHeading}>
            <div>
              <div className={styles.eyebrow}>Run</div>
              <h1>Sessions</h1>
              <p>A shared place to follow work, evidence, and decisions.</p>
            </div>
            <span className={styles.scopeBadge}>
              <Users size={14} aria-hidden="true" />
              Team workspace
            </span>
          </div>
          {!selected ? (
            <section className={styles.statusPanel}>
              <Users size={26} aria-hidden="true" />
              <h2>No team access</h2>
              <p>
                Your account has no current team membership. Contact your
                organization owner.
              </p>
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={onRefresh}
              >
                <RefreshCw size={16} aria-hidden="true" />
                Refresh access
              </button>
            </section>
          ) : teamState.kind === "error" &&
            teamState.context === teamContext ? (
            <section className={styles.statusPanel}>
              <h2>Couldn’t open this team</h2>
              <p role="alert">{teamState.message}</p>
              <div className={styles.buttonRow}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => {
                    setTeamState({ kind: "loading" });
                    setTeamAttempt((value) => value + 1);
                  }}
                >
                  <RefreshCw size={16} aria-hidden="true" />
                  Retry
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={onRefresh}
                >
                  Refresh access
                </button>
              </div>
            </section>
          ) : !team ? (
            <section className={styles.statusPanel} role="status">
              <LoaderCircle
                className={styles.spinner}
                size={24}
                aria-hidden="true"
              />
              <p>Checking team access…</p>
            </section>
          ) : (
            <div className={styles.sessionsLayout}>
              <section
                className={styles.sessionPanel}
                aria-labelledby="session-heading"
              >
                <div className={styles.panelHeading}>
                  <h2 id="session-heading">Team sessions</h2>
                  <span>{team.name}</span>
                </div>
                <div className={styles.emptyState}>
                  <div className={styles.emptyIcon}>
                    <GitBranch size={29} strokeWidth={1.5} aria-hidden="true" />
                  </div>
                  <h2>Your workspace is ready</h2>
                  <p>
                    Sessions will appear here when execution is available. Your
                    organization, account, and team are saved.
                  </p>
                  <span className={styles.quietBadge}>
                    Session execution is coming later
                  </span>
                </div>
              </section>
              <aside
                className={styles.contextPanel}
                aria-labelledby="context-heading"
              >
                <h2 id="context-heading">Current context</h2>
                <dl>
                  <div>
                    <dt>Organization</dt>
                    <dd>{me.organization.name}</dd>
                  </div>
                  <div>
                    <dt>Team</dt>
                    <dd>{team.name}</dd>
                  </div>
                  <div>
                    <dt>Organization role</dt>
                    <dd className={styles.role}>{me.organization.role}</dd>
                  </div>
                  <div>
                    <dt>Team role</dt>
                    <dd className={styles.role}>{team.role}</dd>
                  </div>
                </dl>
                <div className={styles.contextNote}>
                  <ShieldCheck size={17} aria-hidden="true" />
                  <p>Access is checked against your current team membership.</p>
                </div>
                <div className={styles.teamId}>
                  <span>Team ID</span>
                  <code>{team.id}</code>
                </div>
              </aside>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
