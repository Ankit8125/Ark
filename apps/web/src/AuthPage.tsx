import {
  BootstrapRequestSchema,
  LoginRequestSchema,
  type MeResponse,
} from "@ark/contracts";
import { ArrowRight, Box, Info, LoaderCircle, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiRequestError, errorMessage } from "./api";
import styles from "./App.module.css";

type Props = {
  mode: "setup" | "login";
  notice?: string;
  onSuccess: (me: MeResponse) => void;
  onSetupComplete: () => void;
};

export function AuthPage({ mode, notice, onSuccess, onSetupComplete }: Props) {
  const isSetup = mode === "setup";
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState("");
  const [dirty, setDirty] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isSetup || !dirty || pending) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, isSetup, pending]);

  function focusError(fields: Record<string, string[]>) {
    requestAnimationFrame(() => {
      const field = formRef.current?.elements.namedItem(
        Object.keys(fields)[0] ?? "",
      );
      if (field instanceof HTMLElement) field.focus();
      else errorRef.current?.focus();
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const parsed = isSetup
      ? BootstrapRequestSchema.safeParse(data)
      : LoginRequestSchema.safeParse(data);
    setErrors({});
    setMessage("");
    if (!parsed.success) {
      const fields: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "");
        (fields[key] ??= []).push(issue.message);
      }
      setErrors(fields);
      setMessage("Check the highlighted fields.");
      focusError(fields);
      return;
    }
    setPending(true);
    try {
      const me = await api.authenticate(mode, parsed.data);
      setDirty(false);
      onSuccess(me);
    } catch (error) {
      if (isSetup && error instanceof ApiRequestError && error.status === 409) {
        onSetupComplete();
        return;
      }
      const fields = error instanceof ApiRequestError ? error.fieldErrors : {};
      setErrors(fields);
      setMessage(errorMessage(error));
      focusError(fields);
    } finally {
      setPending(false);
    }
  }

  function field(
    name: string,
    label: string,
    autoComplete: string,
    type = "text",
    hint?: string,
  ) {
    const error = errors[name]?.[0];
    const describedBy =
      [hint ? `${name}-hint` : "", error ? `${name}-error` : ""]
        .filter(Boolean)
        .join(" ") || undefined;
    return (
      <div className={styles.field}>
        <label htmlFor={name}>{label}</label>
        <input
          id={name}
          name={name}
          type={type}
          autoComplete={autoComplete}
          spellCheck={type === "email" ? false : undefined}
          required
          disabled={pending}
          maxLength={type === "password" ? 128 : type === "email" ? 254 : 80}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
        />
        {hint && (
          <span id={`${name}-hint`} className={styles.hint}>
            {hint}
          </span>
        )}
        {error && (
          <span id={`${name}-error`} className={styles.fieldError}>
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={styles.authPage}>
      <header className={styles.authHeader}>
        <div className={styles.brand}>
          <Box size={22} aria-hidden="true" />
          <span>ark</span>
        </div>
        <span className={styles.environment}>Local workspace</span>
      </header>
      <main className={styles.authMain}>
        <div className={styles.authCard}>
          <div className={styles.authIcon}>
            <ShieldCheck size={22} aria-hidden="true" />
          </div>
          <h1>{isSetup ? "Set up your workspace" : "Welcome back"}</h1>
          <p className={styles.authDescription}>
            {isSetup
              ? "Create your organization and its first team. You’ll be the organization owner."
              : "Sign in to your organization to continue."}
          </p>
          {notice && (
            <div className={styles.notice} role="status">
              <Info size={17} aria-hidden="true" />
              <span>{notice}</span>
            </div>
          )}
          <form
            ref={formRef}
            onSubmit={submit}
            onChange={() => setDirty(true)}
            noValidate
            aria-busy={pending}
          >
            {message && (
              <div
                ref={errorRef}
                className={styles.error}
                role="alert"
                tabIndex={-1}
              >
                {message}
              </div>
            )}
            {isSetup && field("ownerName", "Owner name", "name")}
            {field("email", "Email address", "username", "email")}
            {field(
              "password",
              "Password",
              isSetup ? "new-password" : "current-password",
              "password",
              isSetup ? "Use at least 12 characters." : undefined,
            )}
            {isSetup && <div className={styles.formDivider} />}
            {isSetup &&
              field("organizationName", "Organization name", "organization")}
            {isSetup &&
              field(
                "teamName",
                "Team name",
                "off",
                "text",
                "Start with one team. More team controls arrive later.",
              )}
            <button
              className={styles.primaryButton}
              type="submit"
              disabled={pending}
            >
              {pending && (
                <LoaderCircle
                  size={17}
                  className={styles.spinner}
                  aria-hidden="true"
                />
              )}
              {pending
                ? isSetup
                  ? "Creating organization…"
                  : "Signing in…"
                : isSetup
                  ? "Create organization"
                  : "Sign in"}
              {!pending && <ArrowRight size={16} aria-hidden="true" />}
            </button>
          </form>
          <p className={styles.authFootnote}>
            {isSetup
              ? "Setup is available once for this Ark installation."
              : "Use the account created during local setup."}
          </p>
        </div>
      </main>
      <footer className={styles.authFooter}>Ark · Development platform</footer>
    </div>
  );
}
