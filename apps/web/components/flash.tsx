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
};

/** Displays ?ok= / ?error= results of server actions. Text is escaped by React. */
export function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (!ok && !error) return null;
  const text = error ? (MESSAGES[error] ?? error) : (MESSAGES[ok!] ?? "Hecho.");
  return (
    <div
      role="status"
      className={`mb-4 rounded-md border px-4 py-2 text-sm ${error ? "border-danger/30 bg-danger/5 text-danger" : "border-success/30 bg-success/5 text-success"}`}
    >
      {text.slice(0, 300)}
    </div>
  );
}
