import type { Env } from "./types";
import { listApps, resolveApp } from "./apps";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The control-plane home page: every application, each with its own database.
 * Clicking one opens the Studio scoped to THAT app's users.
 *
 * Rendered by the Worker (not a static asset) because the user counts come from N different
 * D1 databases. Gated by the caller — never serve this to a non-admin.
 */
export async function renderMasterPage(env: Env, authUrl: string): Promise<Response> {
  const rows = await Promise.all(
    listApps(env).map(async (def) => {
      try {
        const app = resolveApp(env, def.slug);
        const r = await app.db.prepare("SELECT COUNT(*) AS c FROM user").first<{ c: number }>();
        return { slug: app.slug, name: app.name, users: r?.c ?? 0, error: null as string | null };
      } catch (e) {
        return { slug: def.slug, name: def.name ?? def.slug, users: 0, error: (e as Error).message };
      }
    }),
  );

  const cards = rows
    .map(
      (a) => `
      <a class="card${a.error ? " broken" : ""}" href="/${esc(a.slug)}">
        <div class="row">
          <div class="dot"></div>
          <div class="name">${esc(a.name)}</div>
          <div class="slug">/${esc(a.slug)}</div>
        </div>
        ${
          a.error
            ? `<div class="err">配置错误：${esc(a.error)}</div>`
            : `<div class="meta"><span class="n">${a.users}</span> 个用户 · 独立数据库</div>
               <div class="endpoint">${esc(authUrl)}/${esc(a.slug)}/api/auth</div>`
        }
      </a>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>应用 · 用户管理后台</title>
<style>
  :root{--bg:#fafaf9;--fg:#171717;--muted:#71717a;--line:#e4e4e7;--panel:#fff;--brand:hsl(28 92% 54%)}
  @media (prefers-color-scheme:dark){:root{--bg:#0a0a0a;--fg:#fafafa;--muted:#a1a1aa;--line:#262626;--panel:#141414}}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);
    font:15px/1.6 ui-sans-serif,-apple-system,"PingFang SC","Microsoft YaHei",system-ui,sans-serif}
  .wrap{max-width:840px;margin:0 auto;padding:64px 24px 80px}
  .brand{display:flex;align-items:center;gap:10px;margin-bottom:6px}
  .bdot{width:11px;height:11px;border-radius:50%;background:var(--brand)}
  h1{font-size:22px;margin:0;letter-spacing:-.01em}
  .sub{color:var(--muted);font-size:14px;margin:0 0 36px 21px}
  .grid{display:grid;gap:14px}
  a.card{display:block;text-decoration:none;color:inherit;background:var(--panel);
    border:1px solid var(--line);border-radius:14px;padding:20px 22px;transition:border-color .15s,transform .15s}
  a.card:hover{border-color:var(--brand);transform:translateY(-1px)}
  a.card.broken{border-color:#c0342b}
  .row{display:flex;align-items:center;gap:10px}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--brand);flex:none}
  .name{font-weight:650;font-size:16px}
  .slug{margin-left:auto;color:var(--muted);font-size:12.5px;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .meta{color:var(--muted);font-size:13px;margin-top:9px;margin-left:18px}
  .meta .n{color:var(--fg);font-weight:650}
  .endpoint{margin-top:8px;margin-left:18px;font-size:12px;color:var(--muted);
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
    background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:6px 9px;
    overflow-x:auto;white-space:nowrap}
  .err{color:#c0342b;font-size:13px;margin-top:9px;margin-left:18px}
  .note{color:var(--muted);font-size:12.5px;margin-top:32px;line-height:1.75}
  .note code{background:var(--panel);border:1px solid var(--line);border-radius:5px;padding:1px 5px;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
</style></head>
<body><div class="wrap">
  <div class="brand"><div class="bdot"></div><h1>应用</h1></div>
  <p class="sub">每个应用有各自独立的数据库，用户互不可见。点击进入该应用的用户管理。</p>
  <div class="grid">${cards}</div>
  <p class="note">
    新增一个应用需要：创建它的 D1 与 KV、设置它自己的签名密钥、把它加进 <code>APPS</code>，然后重新部署 —— 绑定必须静态声明，这是硬隔离的代价。
  </p>
</div></body></html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
