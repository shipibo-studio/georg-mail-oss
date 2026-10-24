// The dashboard's Content-Security-Policy. Kept free of imports: the Vite preview server uses it too,
// so the production build is checked under the same policy the Worker sends.
// Remote images are allowed here only so that "Load images" can work for one email: the email
// frame adds its own, stricter policy that blocks them until the owner asks.
export const DASHBOARD_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");
