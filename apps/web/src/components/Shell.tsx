import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Boxes,
  ChevronRight,
  Factory,
  Handshake,
  PanelLeftClose,
  PanelLeftOpen,
  CalendarRange,
  ClipboardCheck,
  Cog,
  FileText,
  HardHat,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Package,
  PieChart,
  Plus,
  Receipt,
  Search,
  ShoppingCart,
  Sparkles,
  Sun,
  Truck,
  Users,
  Wallet,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { BRAND } from "@ironline/shared";
import { api, type Me } from "../api.ts";
import { cx } from "./ui.tsx";

type NavItem = { to: string; label: string; icon: LucideIcon; soon?: boolean };
type NavGroup = { key: string; label: string; icon: LucideIcon; items: NavItem[] };
const HOME: NavItem = { to: "/", label: "Home", icon: LayoutDashboard };
const GROUPS: NavGroup[] = [
  {
    key: "sales",
    label: "Sales",
    icon: Handshake,
    items: [
      { to: "/customers", label: "Customers", icon: Users },
      { to: "/quotes", label: "Quotes", icon: FileText },
      { to: "/sales-orders", label: "Sales orders", icon: ShoppingCart },
    ],
  },
  {
    key: "production",
    label: "Production",
    icon: Factory,
    items: [
      { to: "/jobs", label: "Jobs", icon: Wrench },
      { to: "/floor", label: "Shop floor", icon: HardHat },
      { to: "/floor/board", label: "Schedule board", icon: CalendarRange },
    ],
  },
  { key: "quality", label: "Quality", icon: ClipboardCheck, items: [{ to: "/quality", label: "Quality", icon: ClipboardCheck }] },
  {
    key: "supply",
    label: "Supply",
    icon: Package,
    items: [
      { to: "/items", label: "Parts & materials", icon: Package },
      { to: "/inventory", label: "Inventory", icon: Boxes },
      { to: "/purchasing", label: "Purchasing", icon: Receipt },
      { to: "/soon/shipping", label: "Shipping", icon: Truck, soon: true },
    ],
  },
  {
    key: "finance",
    label: "Finance",
    icon: Wallet,
    items: [
      { to: "/soon/invoicing", label: "Invoicing", icon: Wallet, soon: true },
      { to: "/reports", label: "Reports", icon: PieChart },
    ],
  },
  { key: "setup", label: "Setup", icon: Cog, items: [{ to: "/work-centers", label: "Work centers", icon: Cog }] },
];

/** Longest matching nav path wins, so /floor/board highlights "Schedule board", not "Shop floor". */
function activePath(pathname: string) {
  const all = [HOME, ...GROUPS.flatMap((g) => g.items)].map((i) => i.to);
  return all.filter((to) => (to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`))).sort((a, b) => b.length - a.length)[0] ?? null;
}

const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : (JSON.parse(v) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode: preference just isn't remembered */
    }
  },
};

const CREATE = [
  { to: "/quotes/new", label: "Quote" },
  { to: "/customers?new=1", label: "Customer" },
  { to: "/items/new", label: "Part or material" },
  { to: "/work-centers?new=1", label: "Work center" },
];

export function Mark({ className = "h-7 w-7" }: { className?: string }) {
  // An I-beam section in white on layout blue, with a yellow datum point.
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#2340A8" />
      <path d="M9 8.5h14v3.2h-5.4v8.6H23v3.2H9v-3.2h5.4v-8.6H9z" fill="#fff" />
      <circle cx="25.5" cy="25.5" r="2.4" fill="#F5C518" />
    </svg>
  );
}

function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? "light");
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("ironline-theme", next);
    } catch {
      /* private mode: theme just isn't remembered */
    }
    setTheme(next);
  };
  return { theme, toggle };
}

type Hit = { kind: string; id: string; title: string; sub: string | null };
const HIT_PATH: Record<string, string> = { customer: "customers", item: "items", quote: "quotes", sales_order: "sales-orders", job: "jobs" };
const HIT_LABEL: Record<string, string> = { customer: "Customer", item: "Part", quote: "Quote", sales_order: "Order", job: "Job" };

function GlobalSearch() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const hits = useQuery({
    queryKey: ["search", q],
    queryFn: () => api<Hit[]>(`/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
    staleTime: 5_000,
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const list = hits.data ?? [];
  const go = (h: Hit) => {
    nav(`/${HIT_PATH[h.kind]}/${h.id}`);
    setQ("");
    setOpen(false);
    input.current?.blur();
  };
  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input
        ref={input}
        type="search"
        value={q}
        placeholder="Search customers, parts, quotes, orders, jobs"
        aria-label="Search"
        onChange={(e) => (setQ(e.target.value), setOpen(true), setActive(0))}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(a + 1, list.length - 1)));
          if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
          if (e.key === "Enter" && list[active]) go(list[active]);
          if (e.key === "Escape") input.current?.blur();
        }}
        className="w-full rounded-lg border border-line bg-panel-2 py-2 pl-9 pr-10 text-sm placeholder:text-muted focus:border-accent focus:bg-panel focus:outline-none focus:ring-3 focus:ring-accent/15"
      />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-line px-1.5 text-[11px] text-muted">/</kbd>
      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl bg-panel shadow-xl ring-1 ring-line">
          {list.length === 0 ? (
            <div className="px-4 py-3 text-sm text-muted">{hits.isFetching ? "Searching…" : `Nothing matches “${q}”.`}</div>
          ) : (
            <ul className="max-h-96 overflow-y-auto py-1">
              {list.map((h, i) => (
                <li key={`${h.kind}-${h.id}`}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => go(h)}
                    className={cx("flex w-full items-center gap-3 px-4 py-2 text-left", i === active ? "bg-accent-soft" : "hover:bg-panel-2")}
                  >
                    <span className="w-12 shrink-0 text-xs text-muted">{HIT_LABEL[h.kind]}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{h.title}</span>
                      {h.sub && <span className="block truncate text-xs text-muted">{h.sub}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function CreateMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-accent-ink hover:brightness-110"
      >
        <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Create</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-xl bg-panel py-1 shadow-xl ring-1 ring-line">
          {CREATE.map((c) => (
            <Link key={c.to} to={c.to} onClick={() => setOpen(false)} className="block px-4 py-2 text-sm hover:bg-panel-2">
              {c.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function NavRow({ item, active, collapsed, onNavigate, nested, iconless }: { item: NavItem; active: boolean; collapsed?: boolean; onNavigate: () => void; nested?: boolean; iconless?: boolean }) {
  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={cx(
        "group/row relative flex items-center gap-2.5 rounded-lg py-1.5 text-sm transition-colors",
        collapsed ? "justify-center px-0" : nested ? "pl-9 pr-2.5" : "px-2.5",
        active ? "bg-accent-soft font-medium text-accent" : item.soon ? "text-muted hover:bg-panel-2" : "text-ink hover:bg-panel-2",
      )}
    >
      {active && !collapsed && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-accent" aria-hidden />}
      {((!nested && !iconless) || collapsed) && <item.icon className="h-[18px] w-[18px] shrink-0" />}
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}

    </Link>
  );
}

function Sidebar({ me, collapsed, onToggle, onNavigate, mobile }: { me: Me; collapsed: boolean; onToggle?: () => void; onNavigate: () => void; mobile?: boolean }) {
  const { pathname } = useLocation();
  const current = activePath(pathname);
  const activeGroup = GROUPS.find((g) => g.items.some((i) => i.to === current))?.key;
  const [open, setOpen] = useState<Record<string, boolean>>(() => store.get("ironline-nav-open", { sales: true, production: true, supply: true }));
  const [flyout, setFlyout] = useState<string | null>(null);
  const [flyTop, setFlyTop] = useState(0);
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (activeGroup && !open[activeGroup]) setOpen((o) => ({ ...o, [activeGroup]: true }));
  }, [activeGroup]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => store.set("ironline-nav-open", open), [open]);
  useEffect(() => {
    if (!flyout) return;
    const close = (e: MouseEvent) => navRef.current && !navRef.current.contains(e.target as Node) && setFlyout(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setFlyout(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => (document.removeEventListener("mousedown", close), document.removeEventListener("keydown", esc));
  }, [flyout]);
  useEffect(() => setFlyout(null), [pathname]);
  const initials = me.org.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const go = () => (setFlyout(null), onNavigate());

  return (
    <nav ref={navRef} aria-label="Main" className="flex h-full flex-col border-r border-line bg-rail">
      <div className={cx("flex h-[57px] shrink-0 items-center gap-2.5 border-b border-line", collapsed ? "justify-center px-2" : "px-4")}>
        <Link to="/" onClick={go} className="flex items-center gap-2.5" title={BRAND.name}>
          <Mark />
          {!collapsed && (
            <span className="text-[17px] font-semibold tracking-tight" style={{ fontStretch: "88%" }}>
              {BRAND.name}
            </span>
          )}
        </Link>
      </div>

      <div className={cx("flex-1 overflow-y-auto overflow-x-hidden py-3", collapsed ? "px-2" : "px-2.5")}>
        <NavRow item={HOME} active={current === "/"} collapsed={collapsed} onNavigate={go} />
        <div className="my-2 h-px bg-line" />
        <ul className="space-y-0.5">
          {GROUPS.map((g) => {
            const allSoon = g.items.every((i) => i.soon);
            const isActive = g.key === activeGroup;
            // A group with one built page is just a link.
            if (g.items.length === 1 && !g.items[0]!.soon) {
              const only = g.items[0]!;
              return (
                <li key={g.key}>
                  <NavRow item={only} active={only.to === current} collapsed={collapsed} onNavigate={go} />
                </li>
              );
            }
            if (collapsed) {
              return (
                <li key={g.key} className="relative">
                  <button
                    type="button"
                    title={g.label}
                    aria-label={g.label}
                    aria-expanded={flyout === g.key}
                    onClick={(e) => {
                      setFlyTop(e.currentTarget.getBoundingClientRect().top);
                      setFlyout(flyout === g.key ? null : g.key);
                    }}
                    className={cx(
                      "flex w-full items-center justify-center rounded-lg py-2 transition-colors",
                      isActive ? "bg-accent-soft text-accent" : allSoon ? "text-muted hover:bg-panel-2" : "text-ink hover:bg-panel-2",
                    )}
                  >
                    <g.icon className="h-[18px] w-[18px]" />
                  </button>
                  {flyout === g.key && (
                    <div className="fixed left-[72px] z-50 w-56 rounded-xl bg-panel p-1.5 shadow-xl ring-1 ring-line" style={{ top: Math.min(flyTop, window.innerHeight - 260) }}>
                      <div className="px-2.5 pb-1 pt-1 text-xs font-medium text-muted">{g.label}</div>
                      {g.items.map((it) => (
                        <NavRow key={it.to} item={it} active={it.to === current} onNavigate={go} iconless />
                      ))}
                    </div>
                  )}
                </li>
              );
            }
            const isOpen = !!open[g.key];
            return (
              <li key={g.key}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen({ ...open, [g.key]: !isOpen })}
                  className={cx(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-panel-2",
                    isActive && !isOpen ? "font-medium text-accent" : allSoon ? "text-muted" : "text-ink",
                  )}
                >
                  <g.icon className="h-[18px] w-[18px] shrink-0" />
                  <span className="flex-1">{g.label}</span>
                  {allSoon && <span className="rounded border border-line px-1.5 text-[10px] leading-4 text-muted">Planned</span>}
                  <ChevronRight className={cx("h-4 w-4 text-muted transition-transform", isOpen && "rotate-90")} />
                </button>
                {isOpen && (
                  <div className="relative mt-0.5 space-y-0.5 before:absolute before:bottom-1 before:left-[19px] before:top-1 before:w-px before:bg-line">
                    {g.items.map((it) => (
                      <NavRow key={it.to} item={it} active={it.to === current} onNavigate={go} nested />
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className={cx("shrink-0 border-t border-line", collapsed ? "p-2" : "p-2.5")}>
        <div className={cx("flex items-center gap-2.5 rounded-lg", collapsed ? "justify-center py-1" : "px-1.5 py-1.5")} title={collapsed ? me.org.name : undefined}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-panel-2 text-xs font-semibold text-ink ring-1 ring-line">{initials}</span>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{me.org.name}</div>
              <div className="truncate text-xs capitalize text-muted">{me.role} · {me.org.currency}</div>
            </div>
          )}
        </div>
        {!mobile && onToggle && (
          <button
            type="button"
            onClick={onToggle}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cx("mt-1 flex w-full items-center gap-2.5 rounded-lg py-1.5 text-sm text-muted hover:bg-panel-2 hover:text-ink", collapsed ? "justify-center" : "px-2.5")}
          >
            {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
            {!collapsed && "Collapse"}
          </button>
        )}
      </div>
    </nav>
  );
}

export function Shell({ me, children }: { me: Me; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => store.get("ironline-nav-collapsed", false));
  const toggleCollapsed = () => setCollapsed((c) => (store.set("ironline-nav-collapsed", !c), !c));
  const { theme, toggle } = useTheme();
  const qc = useQueryClient();
  const loc = useLocation();
  const logout = async () => {
    await api("/auth/logout", "POST");
    qc.clear();
    window.location.href = "/";
  };
  const initials = me.user.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  // The operator screen is a tablet kiosk: no office chrome, the job gets the whole screen.
  if (loc.pathname.startsWith("/floor/op/")) return <div className="h-full overflow-y-auto">{children}</div>;
  return (
    <div className="flex h-full">
      <aside className={cx("hidden shrink-0 transition-[width] duration-200 lg:block", collapsed ? "w-16" : "w-60")}>
        <Sidebar me={me} collapsed={collapsed} onToggle={toggleCollapsed} onNavigate={() => setOpen(false)} />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-[#172230]/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 shadow-xl">
            <Sidebar me={me} collapsed={false} mobile onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line bg-panel px-4 py-2.5 sm:px-6">
          <button type="button" onClick={() => setOpen((o) => !o)} aria-label="Menu" className="rounded-lg p-1.5 hover:bg-panel-2 lg:hidden">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-2">
            <CreateMenu />
            <Link to="/soon/assistant" title={`Ask ${BRAND.assistantName}`} className="hidden rounded-lg p-2 text-muted hover:bg-panel-2 hover:text-ink sm:block">
              <Sparkles className="h-4 w-4" />
            </Link>
            <button type="button" onClick={toggle} aria-label={theme === "dark" ? "Use light theme" : "Use dark theme"} className="rounded-lg p-2 text-muted hover:bg-panel-2 hover:text-ink">
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <div className="group relative">
              <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-ink" aria-label="Account">
                {initials}
              </button>
              <div className="invisible absolute right-0 top-full z-50 mt-1 w-56 rounded-xl bg-panel py-2 opacity-0 shadow-xl ring-1 ring-line transition group-focus-within:visible group-focus-within:opacity-100">
                <div className="px-4 pb-2">
                  <div className="text-sm font-medium">{me.user.name}</div>
                  <div className="truncate text-xs text-muted">{me.user.email}</div>
                  <div className="mt-0.5 text-xs capitalize text-muted">{me.role}</div>
                </div>
                <button type="button" onClick={logout} className="flex w-full items-center gap-2 border-t border-line px-4 pt-2 text-sm hover:text-accent">
                  <LogOut className="h-4 w-4" /> Log out
                </button>
              </div>
            </div>
          </div>
        </header>
        <main key={loc.pathname} className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
