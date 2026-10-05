/**
 * Plain-language notes for environment variables many projects use: what the value is, where to get it, or how to make
 * one. Matched on the name; the first match wins. A note is a hint for the person filling the value in, never a value.
 */
export interface EnvHint {
  text: string;
  /** a random value is fine: the Environment dialog offers to generate one */
  generate?: 'secret';
}

const HINTS: [RegExp, EnvHint][] = [
  [/^NODE_ENV$/, { text: 'Usually development for a preview.' }],
  [/^(NEXT_PUBLIC|VITE|EXPO_PUBLIC|REACT_APP|PUBLIC)_/, { text: 'Sent to the browser by the build: never put a secret here.' }],
  [/(^|_)(DATABASE|POSTGRES|PG|MYSQL|DB)_URL$|^DATABASE_URL$/, { text: 'Database connection string, such as postgresql://USER:PASSWORD@localhost:5432/NAME. When the preview\u2019s Services run the database, use the user, password, port and database name from the compose file.' }],
  [/^(REDIS|KV)_URL$/, { text: 'Redis address, such as redis://localhost:6379 when the preview\u2019s Services run Redis.' }],
  [/^(MONGO|MONGODB)_(URL|URI)$/, { text: 'MongoDB connection string, such as mongodb://localhost:27017/NAME.' }],
  [/TELEGRAM.*TOKEN/, { text: 'Bot token from @BotFather in Telegram: /newbot creates a bot, /token shows the token of an existing one. A separate test bot keeps previews away from the real one.' }],
  [/TELEGRAM.*(CHAT|USER|ADMIN).*ID/, { text: 'A numeric Telegram id. Message @userinfobot (or your bot) and it replies with your id.' }],
  [/^OPENAI_API_KEY$/, { text: 'From platform.openai.com → API keys.' }],
  [/^ANTHROPIC_API_KEY$/, { text: 'From console.anthropic.com → API keys.' }],
  [/^(GEMINI|GOOGLE_GENERATIVE_AI|GOOGLE_AI)_API_KEY$/, { text: 'From aistudio.google.com → Get API key.' }],
  [/^STRIPE_WEBHOOK_SECRET$/, { text: 'Printed by `stripe listen --forward-to <your webhook URL>` (Stripe CLI), or Stripe dashboard → Developers → Webhooks.' }],
  [/^STRIPE_/, { text: 'Stripe dashboard → Developers → API keys. Use test-mode keys (sk_test_…, pk_test_…) for previews.' }],
  [/^GOOGLE_CLIENT_(ID|SECRET)$/, { text: 'Google Cloud Console → APIs & Services → Credentials → OAuth client ID. Add the preview address to its redirect URIs.' }],
  [/^GITHUB_(CLIENT_ID|CLIENT_SECRET)$/, { text: 'GitHub → Settings → Developer settings → OAuth Apps. The callback URL must point at the preview address.' }],
  [/^(NEXT_PUBLIC_)?SUPABASE_/, { text: 'Supabase dashboard → Project settings → API (URL, anon key, service role key).' }],
  [/^AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY)$/, { text: 'AWS IAM → Users → Security credentials. Give the key only the permissions the app needs.' }],
  [/^SENTRY_DSN$|_SENTRY_DSN$/, { text: 'Sentry → Project settings → Client keys (DSN). Optional for a preview.' }],
  [/^(SMTP|MAIL|EMAIL)_/, { text: "Your mail provider's SMTP settings. For a preview, a local catcher such as Mailpit (smtp://localhost:1025) keeps mail from going out." }],
  [/^(NEXTAUTH|AUTH|BETTER_AUTH)_URL$|^(APP|BASE|SITE|PUBLIC|FRONTEND|WEB)_URL$/, { text: "The app's own address. For a preview, the address Foundry gives the app (see Open preview), such as http://localhost:<port>." }],
  [/(^|_)(SECRET|SECRET_KEY|JWT_SECRET|SESSION_SECRET|COOKIE_SECRET|ENCRYPTION_KEY|SIGNING_KEY|APP_KEY|SALT)$/, { text: 'Any long random string the app signs or encrypts with. Generate makes one (same as `openssl rand -base64 32`).', generate: 'secret' }],
  [/WEBHOOK_SECRET$/, { text: 'The secret the sending service shows when you create the webhook.' }],
  [/(_API_KEY|_ACCESS_TOKEN|_TOKEN|_KEY)$/, { text: 'A credential issued by the service in its name: look in that service\'s dashboard under API keys or tokens.' }],
  [/_(URL|URI|HOST|ENDPOINT)$/, { text: 'An address the app connects to. For a service the compose file runs, use localhost and its port.' }],
];

export function envHint(key: string): EnvHint | null {
  return HINTS.find(([re]) => re.test(key))?.[1] ?? null;
}
