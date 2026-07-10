/*
 * Simplified-Chinese overlay for Better Auth Studio.
 *
 * Studio has no real i18n (its UI strings are hardcoded English in a minified bundle),
 * so we translate the rendered DOM: an exact-match dictionary of visible labels plus a
 * few regex patterns for dynamic strings, re-applied on every DOM mutation. A floating
 * 中/EN toggle (shared localStorage key `bas-lang`, default zh) lets users switch back.
 *
 * Only exact, whole-string matches are translated, so untranslated content (names, demo
 * data, country/brand names) is left untouched.
 */
(function () {
  "use strict";
  var LANG_KEY = "bas-lang";
  function lang() {
    try {
      return localStorage.getItem(LANG_KEY) || "zh";
    } catch (e) {
      return "zh";
    }
  }

  // english -> 中文. Keyed on the exact trimmed DOM text node (Title Case; CSS uppercases
  // nav/tiles visually, which is a no-op for Chinese).
  var DICT = {
    // header / chrome
    "Better-Auth Studio.": "用户管理后台", "PUBLIC BETA": "公开测试版",
    "Watch Off": "监听关闭", "Watch On": "监听开启", "Docs": "文档", "Support": "支持",
    "Daily": "每日", "Widgets": "小组件", "Search...": "搜索…", "Search…": "搜索…",
    "medium": "中等", "high": "高", "low": "低", "critical": "严重", "pending": "待处理",
    "ALL": "全部", "TOTAL USER": "用户总数",
    // nav + tiles
    "Dashboard": "仪表盘", "Users": "用户", "Organizations": "组织", "Database": "数据库",
    "Emails": "邮件", "Tools": "工具", "Settings": "设置", "Events": "事件", "Overview": "概览",
    "OVERVIEW": "概览",
    "Orgs": "组织", "Sessions": "会话", "Hits": "访问次数", "New": "新增", "Teams": "团队",
    "Members": "成员", "Logins": "登录次数", "Signups": "注册次数",
    // dashboard cards
    "Total Users": "用户总数", "Total User": "用户总数", "Active Users": "活跃用户",
    "New Users": "新增用户", "Activity Hits": "活动次数", "Security Insights": "安全洞察",
    "Rate Limiting": "速率限制", "Rate Limiting Configuration": "速率限制配置",
    "Tracked events in selected period": "所选时段内记录的事件",
    "Users with active session in the time frame": "该时段内拥有活跃会话的用户",
    "Newly registered Users in the time frame": "该时段内新注册的用户",
    "Total organizations in the time frame": "该时段内的组织总数",
    "Total teams in the time frame": "该时段内的团队总数",
    "Recent Users": "最近用户", "Users by Location": "用户地区分布",
    // users page
    "Manage your application users": "管理你的应用用户",
    "Manage users and their accounts": "管理用户及其账户",
    "Export CSV": "导出 CSV", "Export Data": "导出数据", "Seed": "填充示例数据",
    "Seed Users": "生成示例用户", "Add User": "添加用户", "Create User": "创建用户",
    "Search users...": "搜索用户…", "Search users…": "搜索用户…", "Add Filter": "添加筛选",
    "User": "用户", "Actions": "操作", "Ban User": "封禁用户", "Unban User": "解封用户",
    "Ban Reason": "封禁原因", "Delete User": "删除用户", "Update Password": "更新密码",
    "View user details": "查看用户详情", "View active user sessions": "查看活跃用户会话",
    "Cannot delete current user": "无法删除当前用户", "No users found": "未找到用户",
    "No users to export": "没有可导出的用户", "User ID": "用户 ID", "User Agent": "用户代理",
    "IP Address": "IP 地址", "Created At": "创建时间", "Updated At": "更新时间",
    "Email Verified": "邮箱已验证", "Not Verified": "未验证", "Phone number": "手机号",
    "Role": "角色", "Status": "状态", "Name": "名称", "Email": "邮箱",
    "Try adjusting your search or filter criteria": "尝试调整搜索或筛选条件",
    // organizations
    "Manage organizations and teams": "管理组织与团队", "Create Organization": "创建组织",
    "Create Team": "创建团队", "Delete Team": "删除团队", "Organization ID": "组织 ID",
    "Organization Not Found": "未找到组织", "Back to Organizations": "返回组织列表",
    "No Members Yet": "暂无成员", "No teams found": "未找到团队", "Send Invitation": "发送邀请",
    "Invitations": "邀请", "Seed Organizations": "生成示例组织", "Seed Sessions": "生成示例会话",
    "No organization selected": "未选择组织",
    // database
    "View database schema and tables": "查看数据库结构与数据表",
    "Export database tables to JSON or CSV": "将数据库表导出为 JSON 或 CSV",
    "Schema Visualizer": "结构可视化", "Error Loading Schema": "加载结构出错",
    "Loading schema...": "正在加载结构…", "No tables": "无数据表", "Table name": "表名",
    "Field name": "字段名", "Primary Key": "主键", "Secondary Storage": "二级存储",
    "Fit View": "适应视图", "Zoom In": "放大", "Download PNG": "下载 PNG", "Default value": "默认值",
    // emails
    "View email templates": "查看邮件模板", "Email Preview": "邮件预览", "Email subject": "邮件主题",
    "Send Test Email": "发送测试邮件", "Email Verification": "邮箱验证",
    "Your Verification Code": "你的验证码", "Organization Invitation": "组织邀请",
    "Preview Mode": "预览模式", "Edit Mode": "编辑模式",
    // tools
    "View tools and utilities": "查看工具与实用程序", "JWT Decoder": "JWT 解码器",
    "Decode and inspect JWT tokens": "解码并检查 JWT 令牌", "Token Generator": "令牌生成器",
    "Secret Generator": "密钥生成器", "Generate Secret": "生成密钥", "UUID Generator": "UUID 生成器",
    "Generate and validate UUIDs": "生成并校验 UUID", "Password Strength Checker": "密码强度检测",
    "Hash Password": "哈希密码", "Hash Result": "哈希结果", "OAuth Tester": "OAuth 测试工具",
    "Test OAuth": "测试 OAuth", "OAuth Providers": "OAuth 提供商", "Plugin Generator": "插件生成器",
    "Health Check": "健康检查", "Run system health check": "运行系统健康检查",
    "System Info": "系统信息", "Copy to Clipboard": "复制到剪贴板", "Copy All": "全部复制",
    "Click to copy": "点击复制",
    // settings
    "Enabled Plugins": "已启用插件", "Client Plugin": "客户端插件", "Server Plugin": "服务端插件",
    "Client Setup": "客户端配置", "Server Setup": "服务端配置", "Control Panel": "控制面板",
    "Toggle Theme": "切换主题", "Get help and support": "获取帮助与支持",
    "Refresh Studio": "刷新 Studio", "Hard refresh the studio data": "强制刷新 Studio 数据",
    // common buttons
    "Add": "添加", "Create": "创建", "Update": "更新", "Delete": "删除", "Edit": "编辑",
    "Remove": "移除", "Cancel": "取消", "Close": "关闭", "Search": "搜索", "Filter": "筛选",
    "Export": "导出", "Refresh": "刷新", "Copy": "复制", "Apply": "应用", "Reset": "重置",
    "Send": "发送", "Verify": "验证", "Next": "下一步", "Previous": "上一步", "Resend": "重新发送",
    "Save": "保存", "Done": "完成", "Yes, Overwrite": "是，覆盖", "Select types": "选择类型",
    "Select Event Types": "选择事件类型",
    // status / toasts
    "Loading...": "加载中…", "Loading users...": "正在加载用户…",
    "Loading organizations...": "正在加载组织…", "Not set": "未设置", "Not configured": "未配置",
    "Not verified": "未验证", "Unknown error": "未知错误", "No reason provided": "未提供原因",
    "Copied to clipboard": "已复制到剪贴板", "Health check passed": "健康检查通过",
    "Health check failed": "健康检查未通过", "User banned successfully!": "用户封禁成功！",
    "User unbanned successfully!": "用户解封成功！", "User deleted successfully!": "用户删除成功！",
    "Organization deleted successfully!": "组织删除成功！", "Team deleted successfully!": "团队删除成功！",
    "Session created successfully!": "会话创建成功！", "Session deleted successfully!": "会话删除成功！",
    "Test email sent successfully!": "测试邮件发送成功！",
    // time
    "just now": "刚刚", "Today": "今天", "Last 24h": "近 24 小时", "Last 7 days": "近 7 天",
    "Last 30 days": "近 30 天", "Custom Range": "自定义范围"
  };

  // dynamic strings: [regexp, replacement-with-$1]
  var PATTERNS = [
    [/^(\d+)m ago$/, "$1 分钟前"], [/^(\d+)h ago$/, "$1 小时前"], [/^(\d+)d ago$/, "$1 天前"],
    [/^(\d+) selected$/, "已选择 $1 项"], [/^(\d+) records$/, "$1 条记录"],
    [/^(\d+) rows$/, "$1 行"], [/^(\d+) days$/, "$1 天"], [/^(\d+) hours$/, "$1 小时"]
  ];

  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, PRE: 1, NOSCRIPT: 1, svg: 1, SVG: 1 };

  function tr(text) {
    var key = text.trim();
    if (!key) return null;
    if (Object.prototype.hasOwnProperty.call(DICT, key)) return text.replace(key, DICT[key]);
    for (var i = 0; i < PATTERNS.length; i++) {
      if (PATTERNS[i][0].test(key)) return text.replace(PATTERNS[i][0], PATTERNS[i][1]);
    }
    return null;
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) {
      var out = tr(root.nodeValue);
      if (out !== null && out !== root.nodeValue) root.nodeValue = out;
      return;
    }
    if (root.nodeType !== 1) return;
    if (SKIP[root.nodeName] || (root.className && String(root.className).indexOf("language-") === 0)) return;
    // translate a couple of attribute strings (search box placeholder, tooltips)
    if (root.placeholder) { var p = tr(root.placeholder); if (p) root.placeholder = p; }
    var kids = root.childNodes;
    for (var i = 0; i < kids.length; i++) walk(kids[i]);
  }

  function toggle() {
    var btn = document.createElement("button");
    btn.id = "bas-lang-toggle";
    btn.type = "button";
    btn.style.cssText =
      "position:fixed;top:10px;right:12px;z-index:99999;font:600 12px system-ui,sans-serif;" +
      "padding:5px 10px;border-radius:8px;border:1px solid rgba(128,128,128,.35);cursor:pointer;" +
      "background:rgba(246,130,31,.12);color:inherit;backdrop-filter:blur(4px);";
    btn.textContent = lang() === "zh" ? "EN" : "中文";
    btn.title = lang() === "zh" ? "Switch to English" : "切换到中文";
    btn.onclick = function () {
      try {
        localStorage.setItem(LANG_KEY, lang() === "zh" ? "en" : "zh");
      } catch (e) {}
      location.reload();
    };
    document.body.appendChild(btn);
  }

  function start() {
    toggle();
    if (lang() !== "zh") return; // English = leave the native UI untouched
    walk(document.body);
    var mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === "characterData") {
          var out = tr(m.target.nodeValue);
          if (out !== null && out !== m.target.nodeValue) m.target.nodeValue = out;
        } else if (m.type === "attributes") {
          var el = m.target;
          if (el.placeholder) {
            var pp = tr(el.placeholder);
            if (pp) el.placeholder = pp;
          }
        } else {
          for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
        }
      }
    });
    mo.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["placeholder"],
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
