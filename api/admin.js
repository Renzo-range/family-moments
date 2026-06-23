import crypto from "node:crypto";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed" });
  }

  const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
  const adminKey = String(body.adminKey || "");

  if (process.env.FAMILY_ADMIN_KEY && timingSafeEqual(adminKey, process.env.FAMILY_ADMIN_KEY)) {
    return response.status(200).json({ ok: true });
  }

  return response.status(403).json({ error: "管理员口令不正确" });
}

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
