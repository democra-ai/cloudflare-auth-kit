import { drizzle } from "drizzle-orm/d1";
import { eq, desc, or, like, count as sqlCount } from "drizzle-orm";
import * as schema from "./db/schema";
import type { Auth } from "./auth";
import type { ResolvedApp } from "./apps";
import type { Env } from "./types";

/**
 * Full read+write API for Better Auth Studio, running on Cloudflare Workers.
 *
 * The Studio frontend calls ~100 of its own `/api/*` routes (its built-in server is Node-only
 * and not bundled for Workers — the adapter returns 501 for anything we don't handle).
 *
 * READS go through Drizzle over the app's D1. WRITES go through Better Auth's
 * `$context.internalAdapter`, i.e. the data layer BELOW the admin plugin. That matters for
 * multi-tenancy: `auth.api.*` re-authorizes against an admin session in the *app's own*
 * database, which the platform operator (authenticated against the control-plane app, and
 * carrying a differently-prefixed cookie the tenant instance cannot even read) never has.
 * Going through internalAdapter keeps Better Auth's semantics — password hashing, id
 * generation, timestamps, db hooks — while letting the operator gate live in the Worker.
 *
 * `ctx.path` is the request path with any Studio basePath already stripped (e.g. "/api/users").
 */
export interface StudioCtx {
  /** Better Auth bound to THIS app's D1 + KV + secret. */
  auth: Auth;
  env: Env;
  app: ResolvedApp;
  /** Public base of this app's auth endpoints, e.g. https://auth.example.com/citetrack/api/auth */
  authBaseURL: string;
}

type Handler = (ctx: StudioCtx, req: Request, r: { path: string }) => Promise<Response | null>;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...CORS } });

const num = (v: string | null, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

/** Turn a thrown Better Auth / D1 error into a JSON error response. */
async function guard(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    const anyE = e as { status?: number; body?: { message?: string }; message?: string };
    const status = typeof anyE.status === "number" ? anyE.status : 400;
    return json({ success: false, message: anyE.body?.message || anyE.message || "error" }, status);
  }
}

/** The social providers this kit supports, and whether each is configured on this deployment. */
const PROVIDERS = [
  { id: "google", name: "Google", idVar: "GOOGLE_CLIENT_ID", secretVar: "GOOGLE_CLIENT_SECRET" },
  { id: "apple", name: "Apple", idVar: "APPLE_CLIENT_ID", secretVar: "APPLE_CLIENT_SECRET" },
  { id: "github", name: "GitHub", idVar: "GITHUB_CLIENT_ID", secretVar: "GITHUB_CLIENT_SECRET" },
  { id: "microsoft", name: "Microsoft", idVar: "MICROSOFT_CLIENT_ID", secretVar: "MICROSOFT_CLIENT_SECRET" },
] as const;

/** Show enough of a client id to identify it, never enough to use it. Secrets are never returned. */
const maskId = (v?: string) => (!v ? null : v.length <= 12 ? `${v.slice(0, 3)}…` : `${v.slice(0, 8)}…${v.slice(-4)}`);

export function createStudioApiHandler(): Handler {
  return async ({ auth, env, app, authBaseURL }, req, { path }) => {
    const method = req.method;
    const url = new URL(req.url);
    if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const db = drizzle(app.db, { schema });
    const bag = env as unknown as Record<string, string | undefined>;
    const adminEmails = (env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    /** Better Auth's internal data layer for THIS app (no session authorization). */
    const ia = async () => (await auth.$context).internalAdapter;

    // ── meta / boot ────────────────────────────────────────────────────────
    if (path === "/api/config")
      return json({
        success: true,
        config: {
          database: { provider: "cloudflare-d1", adapter: "drizzle" },
          baseURL: authBaseURL,
          app: { slug: app.slug, name: app.name },
          plugins: ["username", "admin", "organization", "passkey"],
          environment: "cloudflare-workers",
        },
      });
    if (path === "/api/db")
      return json({ success: true, database: { provider: "cloudflare-d1", connected: true, adapter: "drizzle" } });
    if (path === "/api/database/test") {
      const u = await db.select({ id: schema.user.id }).from(schema.user).limit(1);
      return json({ success: true, result: u });
    }
    if (path === "/api/version-check") return json({ success: true, updateAvailable: false });
    if (path === "/api/package-info") return json({ success: true, name: "cloudflare-auth-kit" });
    if (path === "/api/plugins")
      return json({
        plugins: [
          { id: "organization", name: "Organization", description: "Organizations & teams", enabled: true },
          { id: "admin", name: "Admin", description: "Admin controls", enabled: true },
          { id: "username", name: "Username", description: "Username login", enabled: true },
          { id: "passkey", name: "Passkey", description: "WebAuthn passkeys", enabled: true },
        ],
        totalPlugins: 4,
      });
    if (path === "/api/plugins/teams/status") return json({ enabled: false });
    if (path === "/api/plugins/organization/status") return json({ enabled: true });
    if (path === "/api/admin/status") return json({ enabled: true, adminEmails });
    if (path === "/api/events/status") return json({ enabled: false });
    if (path === "/api/events") return json({ success: true, events: [], total: 0 });
    if (path === "/api/events/count") return json({ count: 0 });
    if (path === "/api/geo/resolve") return json({ success: true, location: null });
    if (path === "/api/dashboard/invitations") return json({ invitations: [] });
    if (path === "/api/dashboard/geo-distribution") return json({ countries: [] });

    // ── tools ──────────────────────────────────────────────────────────────
    // OAuth status: which providers this app can use, and the exact redirect URI to register.
    // Client SECRETS are never returned; client ids are masked.
    if (path === "/api/tools/oauth/providers" && method === "GET") {
      const providers = PROVIDERS.map((p) => {
        const configured = Boolean(bag[p.idVar] && bag[p.secretVar]);
        return {
          id: p.id,
          provider: p.id,
          name: p.name,
          enabled: configured,
          configured,
          clientId: maskId(bag[p.idVar]),
          redirectURI: `${authBaseURL}/callback/${p.id}`,
        };
      });
      return json({ success: true, providers });
    }
    // Runtime env is read-only on Workers; secrets are set with `wrangler secret put`.
    if (path === "/api/tools/check-env-credentials" && method === "POST") {
      const b = await body<{ provider?: string }>(req);
      const p = PROVIDERS.find((x) => x.id === b.provider);
      return json({ success: true, hasExisting: Boolean(p && bag[p.idVar] && bag[p.secretVar]) });
    }
    if (path === "/api/tools/write-env-credentials" && method === "POST")
      return json(
        { success: false, error: "Worker env is read-only. Set provider secrets with `wrangler secret put`." },
        400,
      );

    if (path === "/api/tools/health-check" && method === "POST") {
      const checks: { name: string; status: string; message: string }[] = [];
      try {
        await db.select({ id: schema.user.id }).from(schema.user).limit(1);
        checks.push({ name: "D1 database", status: "pass", message: `${app.name}: reachable` });
      } catch (e) {
        checks.push({ name: "D1 database", status: "fail", message: (e as Error).message });
      }
      try {
        await app.kv.get("__health");
        checks.push({ name: "KV (sessions)", status: "pass", message: "reachable" });
      } catch (e) {
        checks.push({ name: "KV (sessions)", status: "fail", message: (e as Error).message });
      }
      checks.push({
        name: "Auth endpoints",
        status: "pass",
        message: authBaseURL,
      });
      const failed = checks.filter((c) => c.status === "fail").length;
      return json({ success: failed === 0, checks, message: failed ? `${failed} check(s) failed` : "healthy" }, failed ? 500 : 200);
    }

    if (path === "/api/tools/validate-config" && method === "POST") {
      const checks: { name: string; status: "pass" | "warning" | "error"; message: string }[] = [];
      const add = (name: string, status: "pass" | "warning" | "error", message: string) =>
        checks.push({ name, status, message });

      const secret = app.secret;
      if (!secret) add("Signing secret", "error", `missing secret for app "${app.slug}"`);
      else if (secret.length < 32) add("Signing secret", "error", "shorter than 32 characters");
      else add("Signing secret", "pass", "set, 32+ characters");

      if ((env.AUTH_URL ?? "").trim()) add("AUTH_URL", "pass", env.AUTH_URL);
      else add("AUTH_URL", "warning", "not pinned — inferred from the request origin");

      try {
        await db.select({ id: schema.user.id }).from(schema.user).limit(1);
        add("D1 database", "pass", `app "${app.slug}" schema reachable`);
      } catch (e) {
        add("D1 database", "error", (e as Error).message);
      }

      const live = PROVIDERS.filter((p) => bag[p.idVar] && bag[p.secretVar]);
      const halfConfigured = PROVIDERS.filter((p) => Boolean(bag[p.idVar]) !== Boolean(bag[p.secretVar]));
      for (const p of halfConfigured) add(`${p.name} OAuth`, "error", "only one of client id / secret is set");
      if (live.length) add("Social providers", "pass", live.map((p) => p.name).join(", "));
      else add("Social providers", "warning", "none configured");

      if (env.PASSWORD_LOGIN === "false") add("Password login", "pass", "disabled (passkey / email code only)");
      else add("Password login", "warning", "enabled — consider PASSWORD_LOGIN=false");

      if (env.ALLOW_SIGNUP === "true") add("Public sign-up", "warning", "OPEN — anyone can register");
      else add("Public sign-up", "pass", "closed");

      const errors = checks.filter((c) => c.status === "error").length;
      const warnings = checks.filter((c) => c.status === "warning").length;
      const passes = checks.filter((c) => c.status === "pass").length;
      return json({
        success: errors === 0,
        summary: { total: checks.length, errors, warnings, passes },
        checks,
      });
    }

    // ── counts / stats ─────────────────────────────────────────────────────
    if (path === "/api/counts") {
      const [u, s, o, m] = await Promise.all([
        db.select({ c: sqlCount() }).from(schema.user),
        db.select({ c: sqlCount() }).from(schema.session),
        db.select({ c: sqlCount() }).from(schema.organization),
        db.select({ c: sqlCount() }).from(schema.member),
      ]);
      return json({ users: u[0].c, sessions: s[0].c, organizations: o[0].c, teams: 0, members: m[0].c, events: 0 });
    }

    if (path === "/api/stats") {
      const users = await db.select().from(schema.user).limit(100000);
      const sessions = await db.select().from(schema.session).limit(100000);
      const accounts = await db.select({ userId: schema.account.userId, providerId: schema.account.providerId }).from(schema.account);
      const byProvider: Record<string, number> = { email: 0, credential: 0 };
      for (const a of accounts) byProvider[a.providerId] = (byProvider[a.providerId] ?? 0) + 1;
      const now = Date.now();
      const activeSessions = sessions.filter((s) => new Date(s.expiresAt as unknown as string).getTime() > now).length;
      return json({
        totalUsers: users.length,
        activeUsers: users.filter((u) => !u.banned).length,
        totalSessions: sessions.length,
        activeSessions,
        usersByProvider: { email: byProvider.credential ?? 0, ...byProvider },
        recentSignups: users.slice(-10).reverse().map((u) => ({ ...u, provider: "email" })),
        recentLogins: sessions.slice(-10).reverse(),
      });
    }

    if (path === "/api/analytics") {
      const period = url.searchParams.get("period") ?? "7d";
      const days = period === "30d" ? 30 : period === "24h" ? 1 : 7;
      const users = await db.select({ createdAt: schema.user.createdAt }).from(schema.user);
      const labels: string[] = [];
      const data: number[] = [];
      for (let i = days - 1; i >= 0; i--) {
        const day = new Date(Date.now() - i * 86400000);
        const key = day.toISOString().slice(0, 10);
        labels.push(key);
        data.push(users.filter((u) => String(new Date(u.createdAt as unknown as string).toISOString().slice(0, 10)) === key).length);
      }
      return json({ type: url.searchParams.get("type") ?? "signups", period, labels, data, percentageChange: 0 });
    }

    if (path === "/api/database/schema") {
      const tables = ["user", "session", "account", "verification", "organization", "member", "invitation", "passkey"];
      return json({ success: true, tables: tables.map((name) => ({ name })) });
    }

    if (path === "/api/dashboard/recent-users") {
      const rows = await db.select().from(schema.user).orderBy(desc(schema.user.createdAt)).limit(5);
      return json({ users: rows });
    }
    if (path === "/api/dashboard/recent-organizations") {
      const rows = await db.select().from(schema.organization).orderBy(desc(schema.organization.createdAt)).limit(5);
      return json({ organizations: rows });
    }
    if (path === "/api/dashboard/recent-teams") return json({ teams: [] });

    // ── users ──────────────────────────────────────────────────────────────
    if (path === "/api/users" && method === "GET") {
      const limit = num(url.searchParams.get("limit"), 25);
      const page = num(url.searchParams.get("page"), 1);
      const search = (url.searchParams.get("search") ?? url.searchParams.get("searchValue") ?? "").trim();
      const where = search
        ? or(like(schema.user.email, `%${search}%`), like(schema.user.name, `%${search}%`))
        : undefined;
      const total = (await db.select({ c: sqlCount() }).from(schema.user).where(where))[0].c;
      const users = await db
        .select()
        .from(schema.user)
        .where(where)
        .orderBy(desc(schema.user.createdAt))
        .limit(limit)
        .offset((page - 1) * limit);
      return json({ users, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) });
    }
    if (path === "/api/users/all" && method === "GET") {
      const rows = await db.select().from(schema.user).limit(100000);
      return json({ users: rows });
    }
    if (path === "/api/users" && method === "POST")
      return guard(async () => {
        const b = await body<{ email: string; password?: string; name?: string; role?: string; username?: string }>(req);
        if (!b.email) return json({ success: false, message: "email is required" }, 400);
        const c = await auth.$context;
        const user = (await c.internalAdapter.createUser({
          email: b.email,
          name: b.name || b.username || b.email,
          emailVerified: false,
          role: b.role || "user",
          ...(b.username ? { username: b.username, displayUsername: b.username } : {}),
        } as never)) as { id: string };
        if (b.password) {
          await c.internalAdapter.createAccount({
            userId: user.id,
            providerId: "credential",
            accountId: user.id,
            password: await c.password.hash(b.password),
          } as never);
        }
        return json({ success: true, user });
      });

    const uid = path.match(/^\/api\/users\/([^/]+)$/)?.[1];
    if (uid) {
      if (method === "GET") {
        const rows = await db.select().from(schema.user).where(eq(schema.user.id, uid)).limit(1);
        return rows.length ? json({ user: rows[0] }) : json({ error: "not found" }, 404);
      }
      if (method === "PUT")
        return guard(async () => {
          const b = await body<Record<string, unknown>>(req);
          // Never let the dashboard rewrite identity/plumbing columns.
          for (const k of ["id", "createdAt", "updatedAt"]) delete b[k];
          const user = await (await ia()).updateUser(uid, b as never);
          return json({ success: true, user });
        });
      if (method === "DELETE")
        return guard(async () => {
          const c = await ia();
          await c.deleteUserSessions(uid);
          await c.deleteAccounts(uid);
          await c.deleteUser(uid);
          return json({ success: true });
        });
    }

    const pwUid = path.match(/^\/api\/users\/([^/]+)\/password$/)?.[1];
    if (pwUid && method === "POST")
      return guard(async () => {
        const b = await body<{ password?: string; newPassword?: string }>(req);
        const pw = b.newPassword || b.password || "";
        if (pw.length < 8) return json({ success: false, message: "password must be at least 8 characters" }, 400);
        const c = await auth.$context;
        const existing = await db
          .select({ id: schema.account.id })
          .from(schema.account)
          .where(eq(schema.account.userId, pwUid));
        const hash = await c.password.hash(pw);
        if (existing.some(Boolean)) await c.internalAdapter.updatePassword(pwUid, hash);
        else
          await c.internalAdapter.createAccount({
            userId: pwUid,
            providerId: "credential",
            accountId: pwUid,
            password: hash,
          } as never);
        return json({ success: true });
      });

    const sessUid = path.match(/^\/api\/users\/([^/]+)\/sessions$/)?.[1];
    if (sessUid && method === "GET")
      return guard(async () => {
        const sessions = await (await ia()).listSessions(sessUid);
        return json({ sessions });
      });
    const accUid = path.match(/^\/api\/users\/([^/]+)\/accounts$/)?.[1];
    if (accUid && method === "GET") {
      const rows = await db.select().from(schema.account).where(eq(schema.account.userId, accUid));
      return json({ accounts: rows });
    }
    const orgUid = path.match(/^\/api\/users\/([^/]+)\/organizations$/)?.[1];
    if (orgUid && method === "GET") {
      const rows = await db
        .select({ id: schema.organization.id, name: schema.organization.name, slug: schema.organization.slug, role: schema.member.role })
        .from(schema.member)
        .innerJoin(schema.organization, eq(schema.member.organizationId, schema.organization.id))
        .where(eq(schema.member.userId, orgUid));
      return json({ organizations: rows });
    }
    if (/^\/api\/users\/[^/]+\/(teams|invitations)$/.test(path)) return json({ teams: [], invitations: [] });

    const delSession = path.match(/^\/api\/sessions\/([^/]+)$/)?.[1];
    if (delSession && method === "DELETE") {
      await db.delete(schema.session).where(eq(schema.session.id, delSession));
      return json({ success: true });
    }
    if (path === "/api/sessions" && method === "GET") {
      const limit = num(url.searchParams.get("limit"), 25);
      const page = num(url.searchParams.get("page"), 1);
      const total = (await db.select({ c: sqlCount() }).from(schema.session))[0].c;
      const rows = await db
        .select()
        .from(schema.session)
        .orderBy(desc(schema.session.createdAt))
        .limit(limit)
        .offset((page - 1) * limit);
      return json({ sessions: rows, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) });
    }

    // ── admin actions (internalAdapter: no per-app session required) ────────
    if (path === "/api/admin/ban-user" && method === "POST")
      return guard(async () => {
        const b = await body<{ userId: string; banReason?: string; banExpiresIn?: number }>(req);
        const user = await (await ia()).updateUser(b.userId, {
          banned: true,
          banReason: b.banReason ?? null,
          banExpires: b.banExpiresIn ? new Date(Date.now() + b.banExpiresIn * 1000) : null,
        } as never);
        return json({ success: true, user });
      });
    if (path === "/api/admin/unban-user" && method === "POST")
      return guard(async () => {
        const b = await body<{ userId: string }>(req);
        const user = await (await ia()).updateUser(b.userId, {
          banned: false,
          banReason: null,
          banExpires: null,
        } as never);
        return json({ success: true, user });
      });
    if (path === "/api/admin/set-role" && method === "POST")
      return guard(async () => {
        const b = await body<{ userId: string; role: string }>(req);
        const user = await (await ia()).updateUser(b.userId, { role: b.role } as never);
        return json({ success: true, user });
      });

    // ── organizations ────────────────────────────────────────────────────────
    if (path === "/api/organizations" && method === "GET") {
      const rows = await db.select().from(schema.organization).orderBy(desc(schema.organization.createdAt));
      return json({ organizations: rows });
    }
    if (path === "/api/organizations" && method === "POST")
      return guard(async () => {
        const b = await body<{ name: string; slug: string }>(req);
        if (!b.name || !b.slug) return json({ success: false, message: "name and slug are required" }, 400);
        const organization = { id: crypto.randomUUID(), name: b.name, slug: b.slug, logo: null, metadata: null, createdAt: new Date() };
        await db.insert(schema.organization).values(organization as never);
        return json({ success: true, organization });
      });
    const oid = path.match(/^\/api\/organizations\/([^/]+)$/)?.[1];
    if (oid) {
      if (method === "GET") {
        const rows = await db.select().from(schema.organization).where(eq(schema.organization.id, oid)).limit(1);
        if (!rows.length) return json({ error: "not found" }, 404);
        const members = await db
          .select({
            id: schema.member.id,
            role: schema.member.role,
            createdAt: schema.member.createdAt,
            userId: schema.user.id,
            name: schema.user.name,
            email: schema.user.email,
          })
          .from(schema.member)
          .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
          .where(eq(schema.member.organizationId, oid));
        return json({ organization: { ...rows[0], members }, members });
      }
      if (method === "DELETE")
        return guard(async () => {
          await db.delete(schema.member).where(eq(schema.member.organizationId, oid));
          await db.delete(schema.organization).where(eq(schema.organization.id, oid));
          return json({ success: true });
        });
    }
    const oMembers = path.match(/^\/api\/organizations\/([^/]+)\/members$/)?.[1];
    if (oMembers && method === "GET") {
      const members = await db
        .select({
          id: schema.member.id,
          role: schema.member.role,
          createdAt: schema.member.createdAt,
          userId: schema.user.id,
          name: schema.user.name,
          email: schema.user.email,
        })
        .from(schema.member)
        .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
        .where(eq(schema.member.organizationId, oMembers));
      return json({ members });
    }
    if (/^\/api\/organizations\/[^/]+\/(teams|invitations)$/.test(path)) return json({ teams: [], invitations: [] });

    // ── teams (not enabled in this kit) ──
    if (path === "/api/teams") return json({ teams: [] });

    // unhandled → fall through (adapter will 501, or /api/auth/* falls to Better Auth)
    return null;
  };
}
