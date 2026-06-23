import { handleUpload } from "@vercel/blob/client";

const allowedTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime"
]);

const maxUploadBytes = 500 * 1024 * 1024;

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        const payload = safeJson(clientPayload);
        if (!allowedTypes.has(payload.type)) {
          throw new Error("Only images and videos are allowed");
        }

        if (Number(payload.size || 0) > maxUploadBytes) {
          throw new Error("单个文件不能超过 500 MB");
        }

        return {
          allowedContentTypes: [...allowedTypes],
          addRandomSuffix: false,
          tokenPayload: JSON.stringify({
            kind: payload.kind,
            name: payload.name,
            size: payload.size,
            type: payload.type
          })
        };
      },
      onUploadCompleted: async () => {}
    });

    return response.status(200).json(jsonResponse);
  } catch (error) {
    return response.status(400).json({ error: error.message || "Upload failed" });
  }
}

function safeJson(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}
