const MESSAGES: Record<string, string> = {
  created: "Cliente creado.",
  saved: "Cambios guardados.",
  active: "Organización activada.",
  suspended: "Organización suspendida.",
  plan: "Plan guardado.",
  settings: "Ajustes guardados.",
  profile: "Perfil guardado.",
  branding: "Branding guardado.",
  invited: "Invitación enviada.",
  role: "Rol actualizado.",
  removed: "Usuario eliminado.",
  revoked: "Invitación revocada.",
  forbidden: "No tienes permiso para esa acción.",
  user_created: "Usuario creado y añadido a la organización.",
  user_attached: "El usuario ya existía: se ha añadido a la organización.",
  sent: "Enviado.",
  password: "Contraseña actualizada.",
};

/**
 * Displays results of server actions.
 *  - `ok`: a key from the URL (?ok=…). Only known keys are shown, so a crafted
 *    link cannot display arbitrary text as a success message.
 *  - `message`: trusted success text computed by the page itself.
 *  - `error`: error text (React-escaped, length-capped).
 */
export function Flash({ ok, error, message }: { ok?: string; error?: string; message?: string }) {
  if (!ok && !error && !message) return null;
  const text = error ? (MESSAGES[error] ?? error) : (message ?? MESSAGES[ok!] ?? "Hecho.");
  return (
    <div
      role="status"
      className={`mb-4 rounded-md border px-4 py-2 text-sm ${error ? "border-danger/30 bg-danger/5 text-danger" : "border-success/30 bg-success/5 text-success"}`}
    >
      {text.slice(0, 300)}
    </div>
  );
}
