/**
 * Embeddable loader: <script src="https://APP/widget.js" data-key="wc_…" async></script>
 * Adds a chat bubble that opens the hosted chat in an iframe. No cookies,
 * no access to the host page beyond its origin (sent for the allowlist).
 */
export const dynamic = "force-static";

const SCRIPT = `(() => {
  var s = document.currentScript; if (!s) return;
  var key = s.getAttribute("data-key"); if (!key || !/^wc_[A-Za-z0-9_-]{20,40}$/.test(key)) return;
  var base = new URL(s.src).origin;
  var color = s.getAttribute("data-color") || "#2563eb";
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) color = "#2563eb";
  var open = false, frame;
  var btn = document.createElement("button");
  btn.setAttribute("aria-label", "Abrir chat");
  btn.style.cssText = "position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;z-index:2147483646;box-shadow:0 8px 24px rgba(0,0,0,.2);background:" + color + ";color:#fff;font:600 22px/1 system-ui";
  btn.textContent = "💬";
  btn.onclick = function () {
    open = !open;
    if (!frame) {
      frame = document.createElement("iframe");
      frame.title = "Chat";
      frame.src = base + "/chat/" + encodeURIComponent(key) + "?origin=" + encodeURIComponent(location.origin);
      frame.style.cssText = "position:fixed;right:20px;bottom:88px;width:min(380px,calc(100vw - 40px));height:min(600px,calc(100vh - 120px));border:0;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.25);z-index:2147483647;background:#fff";
      document.body.appendChild(frame);
    }
    frame.style.display = open ? "block" : "none";
    btn.textContent = open ? "✕" : "💬";
    btn.setAttribute("aria-label", open ? "Cerrar chat" : "Abrir chat");
  };
  document.body.appendChild(btn);
})();`;

export function GET() {
  return new Response(SCRIPT, {
    headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" },
  });
}
