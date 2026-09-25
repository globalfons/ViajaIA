// Generates the local JWT secret and anon/service keys (HS256). Local only.
import { createHmac, randomBytes } from "node:crypto";
const secret = process.env.JWT_SECRET ?? randomBytes(32).toString("hex");
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sign = (payload) => {
  const data = `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}`;
  return `${data}.${createHmac("sha256", secret).update(data).digest("base64url")}`;
};
const exp = Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600;
console.log(`JWT_SECRET=${secret}`);
console.log(`ANON_KEY=${sign({ role: "anon", iss: "supabase-e2e", exp })}`);
console.log(`SERVICE_ROLE_KEY=${sign({ role: "service_role", iss: "supabase-e2e", exp })}`);
