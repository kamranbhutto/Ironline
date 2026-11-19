import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { BRAND } from "@ironline/shared";
import { api, ApiError } from "../api.ts";
import { Mark } from "../components/Shell.tsx";
import { Button, ErrorNote, Field, Input } from "../components/ui.tsx";

export function AuthPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [form, setForm] = useState({ orgName: "", name: "", email: "", password: "" });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const fields = error instanceof ApiError ? error.fields ?? {} : {};
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = mode === "login"
        ? await api("/auth/login", "POST", { email: form.email, password: form.password })
        : await api("/auth/signup", "POST", form);
      qc.setQueryData(["me"], me);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-[#2340A8] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        {/* Scribe lines, like layout fluid on a fresh plate */}
        <svg className="absolute inset-0 h-full w-full opacity-[0.12]" aria-hidden>
          <defs>
            <pattern id="scribe" width="56" height="56" patternUnits="userSpaceOnUse">
              <path d="M56 0H0V56" fill="none" stroke="#fff" strokeWidth="0.8" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#scribe)" />
        </svg>
        <div className="relative flex items-center gap-3">
          <Mark className="h-9 w-9" />
          <span className="text-xl font-semibold">{BRAND.name}</span>
        </div>
        <div className="relative">
          <h1 className="max-w-lg text-[44px] font-semibold leading-[1.08]" style={{ fontStretch: "86%" }}>
            {BRAND.tagline}.
          </h1>
          <ul className="mt-8 max-w-md space-y-3 text-[15px] text-white/85">
            <li className="flex gap-3"><span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[#F5C518]" />Quotes priced from real machine time and material</li>
            <li className="flex gap-3"><span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[#F5C518]" />Drawings and 3D models follow every part to the floor</li>
            <li className="flex gap-3"><span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[#F5C518]" />Live estimate vs actual cost on every job</li>
          </ul>
        </div>
        <div className="relative text-sm text-white/70">Shop management for machining and fabrication.</div>
      </div>

      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <div>
            <h2 className="text-2xl font-semibold">{mode === "login" ? "Log in" : "Create your shop"}</h2>
            <p className="mt-1 text-sm text-muted">
              {mode === "login" ? "Welcome back." : "Start with your company and your own account."}
            </p>
          </div>
          {mode === "signup" && (
            <>
              <Field label="Company name" error={fields.orgName}>
                <Input value={form.orgName} onChange={set("orgName")} required autoFocus />
              </Field>
              <Field label="Your name" error={fields.name}>
                <Input value={form.name} onChange={set("name")} required autoComplete="name" />
              </Field>
            </>
          )}
          <Field label="E-mail" error={fields.email}>
            <Input type="email" value={form.email} onChange={set("email")} required autoComplete="email" autoFocus={mode === "login"} />
          </Field>
          <Field label="Password" error={fields.password} hint={mode === "signup" ? "At least 10 characters." : undefined}>
            <Input
              type="password"
              value={form.password}
              onChange={set("password")}
              required
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </Field>
          {error && !Object.keys(fields).length ? <ErrorNote error={error} /> : null}
          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create shop"}
          </Button>
          <p className="text-center text-sm text-muted">
            {mode === "login" ? "New here? " : "Already have an account? "}
            <button type="button" className="font-medium text-accent hover:underline" onClick={() => (setMode(mode === "login" ? "signup" : "login"), setError(null))}>
              {mode === "login" ? "Create a shop" : "Log in"}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
