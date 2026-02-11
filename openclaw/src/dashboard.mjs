/**
 * Proxy on port 3201 → OpenClaw on 3100 (for Cloudflare tunnel / piclaw.supasoft.xyz).
 * All requests forwarded to http://127.0.0.1:3100 so /dashboard and API work.
 */
import http from "http";
import { createLogger, format, transports } from "winston";

const TARGET_PORT = parseInt(process.env.OPENCLAW_PORT || "3100", 10);
const PORT = parseInt(process.env.DASHBOARD_PORT || "3201", 10);

const logger = createLogger({
  level: "info",
  format: format.combine(format.timestamp(), format.simple()),
  transports: [new transports.Console()],
});

const server = http.createServer((clientReq, clientRes) => {
  const opts = {
    hostname: "127.0.0.1",
    port: TARGET_PORT,
    path: clientReq.url,
    method: clientReq.method,
    headers: { ...clientReq.headers, host: `127.0.0.1:${TARGET_PORT}` },
  };
  const proxy = http.request(opts, (targetRes) => {
    clientRes.writeHead(targetRes.statusCode, targetRes.headers);
    targetRes.pipe(clientRes, { end: true });
  });
  proxy.on("error", (err) => {
    logger.warn("Proxy error: " + err.message);
    clientRes.writeHead(502, { "Content-Type": "text/plain" });
    clientRes.end("Bad Gateway: OpenClaw on " + TARGET_PORT + " unreachable");
  });
  clientReq.pipe(proxy, { end: true });
});

server.listen(PORT, "0.0.0.0", () => {
  logger.info("Dashboard proxy :" + PORT + " → 127.0.0.1:" + TARGET_PORT);
});
