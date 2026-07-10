// Simplified-Chinese strings for the better-auth-ui login views. Passed to
// AuthUIProvider's `localization` prop, which merges over the English defaults —
// so only the keys we translate change; anything omitted falls back to English.
export const zhCN: Record<string, string> = {
  // sign in / sign up
  SIGN_IN: "登录",
  SIGN_IN_ACTION: "登录",
  SIGN_IN_DESCRIPTION: "输入你的邮箱以登录账户",
  SIGN_IN_USERNAME_DESCRIPTION: "输入你的用户名或邮箱以登录账户",
  SIGN_IN_WITH: "使用", // composes as "使用 通行密钥" / "使用 Google"
  SIGN_OUT: "退出登录",
  SIGN_UP: "注册",
  SIGN_UP_ACTION: "创建账户",
  SIGN_UP_DESCRIPTION: "填写信息以创建账户",
  SIGN_UP_EMAIL: "请查收邮件中的验证链接。",
  DONT_HAVE_AN_ACCOUNT: "还没有账户？",
  OR_CONTINUE_WITH: "或使用以下方式继续",

  // fields
  EMAIL: "邮箱",
  EMAIL_PLACEHOLDER: "m@example.com",
  EMAIL_REQUIRED: "请输入邮箱地址",
  PASSWORD: "密码",
  PASSWORD_PLACEHOLDER: "密码",
  PASSWORD_REQUIRED: "请输入密码",
  NAME: "名称",
  NAME_PLACEHOLDER: "名称",
  USERNAME: "用户名",
  USERNAME_PLACEHOLDER: "用户名",

  // email OTP
  EMAIL_OTP: "邮箱验证码",
  EMAIL_OTP_SEND_ACTION: "发送验证码",
  EMAIL_OTP_VERIFY_ACTION: "验证验证码",
  EMAIL_OTP_DESCRIPTION: "输入你的邮箱以接收验证码",
  EMAIL_OTP_VERIFICATION_SENT: "请查收邮件中的验证码。",
  RESEND_CODE: "重新发送验证码",
  ONE_TIME_PASSWORD: "一次性验证码",
  SEND_VERIFICATION_CODE: "发送验证码",

  // passkey
  PASSKEY: "通行密钥",
  PASSKEYS: "通行密钥",
  PASSKEYS_DESCRIPTION: "管理你的通行密钥以安全访问。",
  PASSKEYS_INSTRUCTIONS: "无需密码即可安全访问你的账户。",

  // account / session
  SETTINGS: "设置",
  SECURITY: "安全",
  SESSIONS: "会话",
  SESSIONS_DESCRIPTION: "管理你的活跃会话并撤销访问。",
  SWITCH_ACCOUNT: "切换账户",
  PERSONAL_ACCOUNT: "个人账户",
  SAVE: "保存",
  DONE: "完成",
  GO_BACK: "返回",
  LINK: "关联",
  UNLINK: "取消关联",
  REVOKE: "撤销",
  PROVIDERS: "登录方式",
  PROVIDERS_DESCRIPTION: "将你的账户与第三方服务关联。",
  REMEMBER_ME: "记住我",

  // common errors
  INVALID_EMAIL: "邮箱无效",
  INVALID_EMAIL_OR_PASSWORD: "邮箱或密码不正确",
  INVALID_PASSWORD: "密码无效",
  INVALID_OTP: "验证码无效",
  OTP_EXPIRED: "验证码已过期",
  TOO_MANY_ATTEMPTS: "尝试次数过多",
  USER_NOT_FOUND: "未找到用户",
  USER_ALREADY_EXISTS: "用户已存在",
  EMAIL_NOT_VERIFIED: "邮箱未验证",
  UNKNOWN_ERROR: "出错了，请重试",
  REQUEST_FAILED: "请求失败",
};
