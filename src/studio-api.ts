import { drizzle } from "drizzle-orm/d1";
import { eq, desc, count as sqlCount } from "drizzle-orm";
import * as schema from "./db/schema";
import type { Auth } from "./auth";
import type { Env } from "./types";

/**
 * Full read+write API for Better Auth Studio, running on Cloudflare Workers.
 *
 * The Studio frontend calls ~100 of its own `/api/*` routes (its built-in server is Node-only
 * and not bundled for Workers — the adapter returns 501 for anything we don't handle). We serve:
 *   • reads   → the Better Auth Drizzle adapter over D1 (create/findMany/update/delete/count)
 *   • writes  → Better Auth's own admin/organization server API (auth.api.*), so user creation
 *               hashes passwords + makes a credential account, and ban expiry is handled correctly.
 *
 * The official Cloudflare example is read-only; this is not.
 *
 * `context.path` is the request path (e.g. "/api/users"). The session cookie rides on the
 * request; we forward request.headers to auth.api.* so its admin checks pass.
 */
type Handler = (auth: Auth, env: Env, req: Request, ctx: { path: string }) => Promise<Response | null>;

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

/** Unwrap an auth.api call, turning Better Auth APIError into a JSON error response. */
async function callApi<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; res: Response }> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    const anyE = e as { status?: number; body?: { message?: string }; message?: string };
    const status = typeof anyE.status === "number" ? anyE.status : 400;
    return { ok: false, res: json({ success: false, message: anyE.body?.message || anyE.message || "error" }, status) };
  }
}

export function createStudioApiHandler(): Handler {
  return async (auth, env, req, { path }) => {
    const method = req.method;
    const url = new URL(req.url);
    const H = { headers: req.headers };
    if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const db = drizzle(env.DB, { schema });
    const adminEmails = (env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

    // ── meta / boot ────────────────────────────────────────────────────────
    if (path === "/api/config")
      return json({
        success: true,
        config: {
          database: { provider: "cloudflare-d1", adapter: "drizzle" },
          baseURL: env.AUTH_URL,
          plugins: ["username", "admin", "organization"],
          environment: "cloudflare-workers",
        },
      });
    if (path === "/api/db")
      return json({ success: true, database: { provider: "cloudflare-d1", connected: true, adapter: "drizzle" } });
    if (path === "/api/database/test") {
      const u = await db.select({ id: schema.user.id }).from(schema.user).limit(1);
      return json({ success: true, result: u });
    }
    if (path === "/api/plugins")
      return json({
        plugins: [
          { id: "organization", name: "Organization", description: "Organizations & teams", enabled: true },
          { id: "admin", name: "Admin", description: "Admin controls", enabled: true },
          { id: "username", name: "Username", description: "Username login", enabled: true },
        ],
        totalPlugins: 3,
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
      const tables = ["user", "session", "account", "verification", "organization", "member", "invitation"];
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
      const search = url.searchParams.get("search") ?? url.searchParams.get("searchValue") ?? "";
      const r = await callApi(() =>
        auth.api.listUsers({
          query: {
            limit,
            offset: (page - 1) * limit,
            ...(search ? { searchValue: search, searchField: "email", searchOperator: "contains" } : {}),
            sortBy: "createdAt",
            sortDirection: "desc",
          },
          ...H,
        } as never),
      );
      if (!r.ok) return r.res;
      const d = r.data as unknown as { users: unknown[]; total: number };
      return json({ users: d.users, total: d.total, page, limit, totalPages: Math.max(1, Math.ceil(d.total / limit)) });
    }
    if (path === "/api/users/all" && method === "GET") {
      const rows = await db.select().from(schema.user).limit(100000);
      return json({ users: rows });
    }
    if (path === "/api/users" && method === "POST") {
      const b = await body<{ email: string; password?: string; name?: string; role?: string; username?: string }>(req);
      const r = await callApi(() =>
        auth.api.createUser({
          body: {
            email: b.email,
            password: b.password || crypto.randomUUID(),
            name: b.name || b.username || b.email,
            role: (b.role as "user" | "admin") || "user",
            data: b.username ? { username: b.username } : undefined,
          },
          ...H,
        } as never),
      );
      return r.ok ? json({ success: true, user: (r.data as unknown as { user?: unknown }).user ?? r.data }) : r.res;
    }

    const uid = path.match(/^\/api\/users\/([^/]+)$/)?.[1];
    if (uid) {
      if (method === "GET") {
        const rows = await db.select().from(schema.user).where(eq(schema.user.id, uid)).limit(1);
        return rows.length ? json({ user: rows[0] }) : json({ error: "not found" }, 404);
      }
      if (method === "PUT") {
        const b = await body<Record<string, unknown>>(req);
        const r = await callApi(() => auth.api.adminUpdateUser({ body: { userId: uid, data: b }, ...H } as never));
        return r.ok ? json({ success: true, user: (r.data as { user?: unknown }).user ?? r.data }) : r.res;
      }
      if (method === "DELETE") {
        const r = await callApi(() => auth.api.removeUser({ body: { userId: uid }, ...H } as never));
        return r.ok ? json({ success: true }) : r.res;
      }
    }

    const pwUid = path.match(/^\/api\/users\/([^/]+)\/password$/)?.[1];
    if (pwUid && method === "POST") {
      const b = await body<{ password?: string; newPassword?: string }>(req);
      const r = await callApi(() =>
        auth.api.setUserPassword({ body: { userId: pwUid, newPassword: b.newPassword || b.password || "" }, ...H } as never),
      );
      return r.ok ? json({ success: true }) : r.res;
    }

    const sessUid = path.match(/^\/api\/users\/([^/]+)\/sessions$/)?.[1];
    if (sessUid && method === "GET") {
      const r = await callApi(() => auth.api.listUserSessions({ body: { userId: sessUid }, ...H } as never));
      return r.ok ? json({ sessions: (r.data as { sessions?: unknown[] }).sessions ?? r.data }) : r.res;
    }
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

    // ── admin actions ────────────────────────────────────────────────────────
    if (path === "/api/admin/ban-user" && method === "POST") {
      const b = await body<{ userId: string; banReason?: string; banExpiresIn?: number }>(req);
      const r = await callApi(() =>
        auth.api.banUser({ body: { userId: b.userId, banReason: b.banReason, banExpiresIn: b.banExpiresIn }, ...H } as never),
      );
      return r.ok ? json({ success: true, user: (r.data as { user?: unknown }).user ?? r.data }) : r.res;
    }
    if (path === "/api/admin/unban-user" && method === "POST") {
      const b = await body<{ userId: string }>(req);
      const r = await callApi(() => auth.api.unbanUser({ body: { userId: b.userId }, ...H } as never));
      return r.ok ? json({ success: true, user: (r.data as { user?: unknown }).user ?? r.data }) : r.res;
    }
    if (path === "/api/admin/set-role" && method === "POST") {
      const b = await body<{ userId: string; role: string }>(req);
      const r = await callApi(() => auth.api.setRole({ body: { userId: b.userId, role: b.role as never }, ...H } as never));
      return r.ok ? json({ success: true, user: (r.data as { user?: unknown }).user ?? r.data }) : r.res;
    }

    // ── organizations ────────────────────────────────────────────────────────
    if (path === "/api/organizations" && method === "GET") {
      const rows = await db.select().from(schema.organization).orderBy(desc(schema.organization.createdAt));
      return json({ organizations: rows });
    }
    if (path === "/api/organizations" && method === "POST") {
      const b = await body<{ name: string; slug: string }>(req);
      const r = await callApi(() => auth.api.createOrganization({ body: { name: b.name, slug: b.slug }, ...H } as never));
      return r.ok ? json({ success: true, organization: r.data }) : r.res;
    }
    const oid = path.match(/^\/api\/organizations\/([^/]+)$/)?.[1];
    if (oid) {
      if (method === "GET") {
        const r = await callApi(() => auth.api.getFullOrganization({ query: { organizationId: oid }, ...H } as never));
        return r.ok ? json({ organization: r.data }) : r.res;
      }
      if (method === "DELETE") {
        const r = await callApi(() => auth.api.deleteOrganization({ body: { organizationId: oid }, ...H } as never));
        return r.ok ? json({ success: true }) : r.res;
      }
    }
    const oMembers = path.match(/^\/api\/organizations\/([^/]+)\/members$/)?.[1];
    if (oMembers && method === "GET") {
      const r = await callApi(() => auth.api.getFullOrganization({ query: { organizationId: oMembers }, ...H } as never));
      return r.ok ? json({ members: (r.data as { members?: unknown[] }).members ?? [] }) : r.res;
    }
    if (/^\/api\/organizations\/[^/]+\/(teams|invitations)$/.test(path)) return json({ teams: [], invitations: [] });

    // ── teams (not enabled in this kit) ──
    if (path === "/api/teams") return json({ teams: [] });

    // unhandled → fall through (adapter will 501, or /api/auth/* falls to Better Auth)
    return null;
  };
}
