import { del, head, list, put } from "@vercel/blob";
import crypto from "node:crypto";

const legacyPostsPath = "family-moments/posts.json";
const postPrefix = "family-moments/posts/";

export default async function handler(request, response) {
  try {
    if (request.method === "GET") {
      response.setHeader("Cache-Control", "no-store");
      return response.status(200).json(await readPosts());
    }

    if (request.method === "POST") {
      const input = parseBody(request.body);
      const editToken = crypto.randomBytes(24).toString("base64url");
      const post = normalizePost(input, editToken);
      if (!post.title && !post.body && post.media.length === 0) {
        return response.status(400).json({ error: "Add text, photos, or videos first" });
      }

      await savePost(post);
      return response.status(201).json({ ...publicPost(post), editToken });
    }

    if (request.method === "PUT") {
      const input = parseBody(request.body);
      const found = await findPost(input.id);
      if (!found) return response.status(404).json({ error: "Post not found" });
      if (!canManage(found.post, input)) return response.status(403).json({ error: "No permission" });

      const updated = normalizeUpdatedPost(found.post, input);
      await saveLocatedPost(found, updated);
      return response.status(200).json(publicPost(updated));
    }

    if (request.method === "DELETE") {
      const input = parseBody(request.body);
      const found = await findPost(input.id);
      if (!found) return response.status(404).json({ error: "Post not found" });
      if (!canManage(found.post, input)) return response.status(403).json({ error: "No permission" });

      await deleteLocatedPost(found);
      return response.status(200).json({ ok: true });
    }

    response.setHeader("Allow", "GET, POST, PUT, DELETE");
    return response.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return response.status(500).json({ error: error.message || "Something went wrong" });
  }
}

function parseBody(body) {
  return typeof body === "string" ? JSON.parse(body || "{}") : body || {};
}

async function readPosts() {
  const byId = new Map();

  for (const post of await readIndividualPosts()) byId.set(post.id, post);
  for (const post of await readLegacyPosts()) {
    if (!byId.has(post.id)) byId.set(post.id, normalizeStoredPost(post));
  }

  return [...byId.values()]
    .map(publicPost)
    .sort((left, right) => {
      const leftKey = `${left.entryDate || ""} ${left.createdAt || ""}`;
      const rightKey = `${right.entryDate || ""} ${right.createdAt || ""}`;
      return rightKey.localeCompare(leftKey);
    });
}

async function readIndividualPosts() {
  const posts = [];
  for (const found of await listIndividualPosts()) posts.push(found.post);
  return posts;
}

async function listIndividualPosts() {
  const posts = [];
  let cursor;

  do {
    const page = await list({ prefix: postPrefix, cursor, limit: 1000 });
    cursor = page.cursor;

    for (const blob of page.blobs) {
      if (!blob.pathname.endsWith(".json")) continue;
      try {
        const result = await fetch(`${blob.url}?t=${Date.now()}`, { cache: "no-store" });
        if (!result.ok) continue;
        posts.push({ kind: "individual", pathname: blob.pathname, post: normalizeStoredPost(await result.json()) });
      } catch {}
    }
  } while (cursor);

  return posts;
}

async function readLegacyPosts() {
  try {
    const blob = await head(legacyPostsPath);
    const result = await fetch(`${blob.url}?t=${Date.now()}`, { cache: "no-store" });
    if (!result.ok) return [];
    const posts = await result.json();
    return Array.isArray(posts) ? posts : [];
  } catch {
    return [];
  }
}

async function findPost(id) {
  const postId = String(id || "");
  if (!postId) return null;

  for (const found of await listIndividualPosts()) {
    if (found.post.id === postId) return found;
  }

  const legacyPosts = (await readLegacyPosts()).map(normalizeStoredPost);
  const index = legacyPosts.findIndex(post => post.id === postId);
  if (index === -1) return null;
  return { kind: "legacy", index, legacyPosts, post: legacyPosts[index] };
}

async function savePost(post) {
  const pathname = `${postPrefix}${post.entryDate}-${post.createdAt}-${post.id}.json`;
  await put(pathname, JSON.stringify(post, null, 2), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json"
  });
}

async function saveLocatedPost(found, post) {
  if (found.kind === "individual") {
    await put(found.pathname, JSON.stringify(post, null, 2), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json"
    });
    return;
  }

  const posts = [...found.legacyPosts];
  posts[found.index] = post;
  await put(legacyPostsPath, JSON.stringify(posts.map(publicPost), null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json"
  });
}

async function deleteLocatedPost(found) {
  if (found.kind === "individual") {
    await del(found.pathname);
    return;
  }

  const posts = found.legacyPosts.filter((_, index) => index !== found.index);
  await put(legacyPostsPath, JSON.stringify(posts.map(publicPost), null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json"
  });
}

function normalizePost(input, editToken) {
  const entryDate = normalizeEntryDate(input.entryDate);

  return {
    id: crypto.randomUUID(),
    title: String(input.title || "").trim().slice(0, 120),
    body: String(input.body || "").trim().slice(0, 4000),
    author: normalizeAuthor(input.author),
    entryDate,
    createdAt: new Date().toISOString(),
    editTokenHash: hashToken(editToken),
    media: Array.isArray(input.media) ? input.media.map(normalizeMedia).filter(Boolean) : []
  };
}

function normalizeUpdatedPost(existing, input) {
  return {
    ...existing,
    title: String(input.title ?? existing.title ?? "").trim().slice(0, 120),
    body: String(input.body ?? existing.body ?? "").trim().slice(0, 4000),
    author: normalizeAuthor(input.author ?? existing.author),
    entryDate: normalizeEntryDate(input.entryDate || existing.entryDate),
    updatedAt: new Date().toISOString()
  };
}

function normalizeStoredPost(input) {
  const createdAt = typeof input.createdAt === "string" ? input.createdAt : new Date().toISOString();

  return {
    id: String(input.id || crypto.randomUUID()),
    title: String(input.title || "").slice(0, 120),
    body: String(input.body || "").slice(0, 4000),
    author: normalizeAuthor(input.author),
    entryDate: normalizeEntryDate(input.entryDate || createdAt.slice(0, 10)),
    createdAt,
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : undefined,
    editTokenHash: typeof input.editTokenHash === "string" ? input.editTokenHash : undefined,
    media: Array.isArray(input.media) ? input.media.map(normalizeMedia).filter(Boolean) : []
  };
}

function publicPost(post) {
  return {
    id: post.id,
    title: post.title,
    body: post.body,
    author: post.author,
    entryDate: post.entryDate,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    media: post.media
  };
}

function canManage(post, input) {
  const adminKey = String(input.adminKey || "");
  if (process.env.FAMILY_ADMIN_KEY && timingSafeEqual(adminKey, process.env.FAMILY_ADMIN_KEY)) return true;

  const token = String(input.editToken || "");
  return Boolean(post.editTokenHash && token && timingSafeEqual(hashToken(token), post.editTokenHash));
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeEntryDate(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date().toISOString().slice(0, 10);
}

function normalizeAuthor(value) {
  const author = String(value || "").trim().slice(0, 40);
  return author || "家人";
}

function normalizeMedia(item) {
  const type = item?.type === "video" ? "video" : item?.type === "image" ? "image" : "";
  const url = typeof item?.url === "string" && item.url.startsWith("https://") ? item.url : "";
  if (!type || !url) return null;

  return {
    url,
    type,
    name: String(item.name || "").slice(0, 180),
    size: Number(item.size || 0),
    pathname: String(item.pathname || "").slice(0, 400)
  };
}
