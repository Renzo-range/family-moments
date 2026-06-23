import { upload } from "@vercel/blob/client";
import "./styles.css";

const form = document.querySelector("#postForm");
const timeline = document.querySelector("#timeline");
const statusEl = document.querySelector("#status");
const postCount = document.querySelector("#postCount");
const fileInput = document.querySelector("#media");
const fileSummary = document.querySelector("#fileSummary");
const previewGrid = document.querySelector("#previewGrid");
const submitButton = document.querySelector("#submitButton");
const entryDateInput = document.querySelector("#entryDate");
const authorInput = document.querySelector("#author");
const searchDateInput = document.querySelector("#searchDate");
const clearDateSearchButton = document.querySelector("#clearDateSearch");
const filters = [...document.querySelectorAll(".filter")];

let posts = [];
let activeFilter = "all";
let adminMode = false;
let statusTapCount = 0;
let statusTapTimer = null;

entryDateInput.value = todayValue();
authorInput.value = localStorage.getItem("familyAuthorName") || "";
initialize();

async function initialize() {
  await validateSavedAdminKey();
  await loadPosts();
}

fileInput.addEventListener("change", () => {
  previewGrid.innerHTML = "";
  const files = [...fileInput.files];
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  fileSummary.textContent = files.length ? `${files.length} 个文件已选择，共 ${formatBytes(totalSize)}` : "未选择文件";

  for (const file of files) {
    const tile = document.createElement("div");
    tile.className = "preview-tile";
    const url = URL.createObjectURL(file);
    if (file.type.startsWith("video/")) {
      tile.innerHTML = `<video controls muted src="${url}"></video>`;
    } else {
      tile.innerHTML = `<img alt="${escapeHtml(file.name)}" src="${url}" />`;
    }
    previewGrid.append(tile);
  }
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  submitButton.disabled = true;
  submitButton.textContent = "发布中";
  setStatus("正在准备上传");

  try {
    const title = document.querySelector("#title").value.trim();
    const body = document.querySelector("#body").value.trim();
    const entryDate = entryDateInput.value;
    const author = authorInput.value.trim();
    localStorage.setItem("familyAuthorName", author);
    const media = await uploadMedia([...fileInput.files]);

    setStatus("正在保存记录");
    const response = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body, media, entryDate, author })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "发布失败");

    if (payload.editToken) savePostToken(payload.id, payload.editToken);
    posts.unshift(stripEditToken(payload));
    sortPosts();
    form.reset();
    entryDateInput.value = todayValue();
    authorInput.value = author;
    previewGrid.innerHTML = "";
    fileSummary.textContent = "未选择文件";
    render();
    setStatus(adminMode ? "管理员模式" : "已保存");
  } catch (error) {
    setStatus(error.message);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "发布";
  }
});

timeline.addEventListener("click", async event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const post = posts.find(item => item.id === button.dataset.id);
  if (!post) return;

  if (button.dataset.action === "edit") await editPost(post);
  if (button.dataset.action === "delete") await deletePost(post);
});

statusEl.addEventListener("click", async () => {
  statusTapCount += 1;
  clearTimeout(statusTapTimer);
  statusTapTimer = setTimeout(() => {
    statusTapCount = 0;
  }, 2200);

  if (statusTapCount >= 5) {
    statusTapCount = 0;
    const current = localStorage.getItem("familyAdminKey") || "";
    const next = prompt("管理员口令", current);
    if (next === null) return;
    await setAdminKey(next.trim());
  }
});

filters.forEach(button => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    filters.forEach(item => item.classList.toggle("active", item === button));
    render();
  });
});

searchDateInput.addEventListener("change", render);

clearDateSearchButton.addEventListener("click", () => {
  searchDateInput.value = "";
  render();
});

async function uploadMedia(files) {
  const items = [];

  for (const [index, file] of files.entries()) {
    const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "";
    if (!kind) continue;

    setStatus(`正在上传 ${index + 1}/${files.length}: ${file.name} (${formatBytes(file.size)})`);
    const extension = extensionFor(file.name);
    const pathname = `family-moments/media/${Date.now()}-${crypto.randomUUID()}${extension}`;
    const blob = await withUploadTimeout(upload(pathname, file, {
      access: "public",
      handleUploadUrl: "/api/upload",
      multipart: file.size > 8 * 1024 * 1024,
      clientPayload: JSON.stringify({ kind, name: file.name, size: file.size, type: file.type }),
      onUploadProgress: event => {
        if (!event?.loaded || !event?.total) return;
        const percent = Math.round((event.loaded / event.total) * 100);
        setStatus(`正在上传 ${index + 1}/${files.length}: ${percent}%`);
      }
    }), 180000);

    items.push({
      url: blob.url,
      type: kind,
      name: file.name,
      size: file.size,
      pathname: blob.pathname
    });
  }

  return items;
}

async function loadPosts() {
  setStatus("加载中");
  try {
    const response = await fetch("/api/posts", { cache: "no-store" });
    posts = await response.json();
    sortPosts();
    setStatus(adminMode ? "管理员模式" : "已连接");
    render();
  } catch {
    setStatus("连接失败");
  }
}

function render() {
  const visiblePosts = posts.filter(post => {
    const matchesType = activeFilter === "all" || post.media.some(item => item.type === activeFilter);
    const matchesDate = !searchDateInput.value || post.entryDate === searchDateInput.value;
    return matchesType && matchesDate;
  });

  postCount.textContent = String(posts.length);
  timeline.innerHTML = "";

  if (!visiblePosts.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = searchDateInput.value ? "这一天还没有记录。" : activeFilter === "all" ? "还没有记录。" : "这个分类下还没有内容。";
    timeline.append(empty);
    return;
  }

  for (const post of visiblePosts) {
    const article = document.createElement("article");
    article.className = "post";
    article.innerHTML = `
      ${renderMedia(post.media)}
      <div class="post-body">
        <div class="post-head">
          <div class="meta">${formatMeta(post)}</div>
          ${renderActions(post)}
        </div>
        ${post.title ? `<h2>${escapeHtml(post.title)}</h2>` : ""}
        ${post.body ? `<p>${escapeHtml(post.body)}</p>` : ""}
      </div>
    `;
    timeline.append(article);
  }
}

function renderActions(post) {
  if (!canManagePost(post)) return "";

  return `
    <div class="post-actions">
      <button type="button" class="action-button" data-action="edit" data-id="${post.id}">编辑</button>
      <button type="button" class="action-button danger" data-action="delete" data-id="${post.id}">删除</button>
    </div>
  `;
}

function renderMedia(media) {
  if (!media.length) return "";
  return `
    <div class="media-grid">
      ${media.map(item => {
        if (item.type === "video") {
          return `<div class="media-tile"><video controls preload="metadata" src="${item.url}"></video></div>`;
        }
        return `<div class="media-tile"><img loading="lazy" alt="${escapeHtml(item.name)}" src="${item.url}" /></div>`;
      }).join("")}
    </div>
  `;
}

async function editPost(post) {
  const title = prompt("标题", post.title || "");
  if (title === null) return;
  const body = prompt("正文", post.body || "");
  if (body === null) return;
  const entryDate = prompt("记录日期（YYYY-MM-DD）", post.entryDate || todayValue());
  if (entryDate === null) return;
  const author = prompt("发布人昵称", post.author || localStorage.getItem("familyAuthorName") || "");
  if (author === null) return;

  setStatus("正在保存");
  try {
    const updated = await managePost("PUT", { id: post.id, title, body, entryDate, author });
    posts = posts.map(item => (item.id === updated.id ? updated : item));
    sortPosts();
    render();
    setStatus(adminMode ? "管理员模式" : "已保存");
  } catch (error) {
    setStatus(error.message);
  }
}

async function deletePost(post) {
  if (!confirm(`删除“${post.title || "这条记录"}”？`)) return;

  setStatus("正在删除");
  try {
    await managePost("DELETE", { id: post.id });
    posts = posts.filter(item => item.id !== post.id);
    removePostToken(post.id);
    render();
    setStatus(adminMode ? "管理员模式" : "已删除");
  } catch (error) {
    setStatus(error.message);
  }
}

async function managePost(method, payload) {
  const response = await fetch("/api/posts", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload,
      editToken: getPostToken(payload.id),
      adminKey: adminMode ? localStorage.getItem("familyAdminKey") || "" : ""
    })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "操作失败");
  return result;
}

async function validateSavedAdminKey() {
  const key = localStorage.getItem("familyAdminKey") || "";
  if (!key) return;

  try {
    adminMode = await verifyAdminKey(key);
    if (!adminMode) localStorage.removeItem("familyAdminKey");
  } catch {
    adminMode = false;
  }
}

async function setAdminKey(key) {
  if (!key) {
    adminMode = false;
    localStorage.removeItem("familyAdminKey");
    setStatus("已退出管理员模式");
    render();
    return;
  }

  setStatus("正在验证管理员口令");
  try {
    adminMode = await verifyAdminKey(key);
    if (!adminMode) {
      localStorage.removeItem("familyAdminKey");
      setStatus("管理员口令不正确");
      render();
      return;
    }

    localStorage.setItem("familyAdminKey", key);
    setStatus("管理员模式");
    render();
  } catch (error) {
    adminMode = false;
    localStorage.removeItem("familyAdminKey");
    setStatus(error.message || "验证失败");
    render();
  }
}

async function verifyAdminKey(key) {
  const response = await fetch("/api/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adminKey: key })
  });

  if (response.status === 403) return false;
  if (!response.ok) throw new Error("管理员验证失败");
  return true;
}

function canManagePost(post) {
  return Boolean(getPostToken(post.id) || adminMode);
}

function getTokens() {
  try {
    return JSON.parse(localStorage.getItem("familyPostEditTokens") || "{}");
  } catch {
    return {};
  }
}

function savePostToken(id, token) {
  const tokens = getTokens();
  tokens[id] = token;
  localStorage.setItem("familyPostEditTokens", JSON.stringify(tokens));
}

function getPostToken(id) {
  return getTokens()[id] || "";
}

function removePostToken(id) {
  const tokens = getTokens();
  delete tokens[id];
  localStorage.setItem("familyPostEditTokens", JSON.stringify(tokens));
}

function stripEditToken(post) {
  const { editToken, ...publicPost } = post;
  return publicPost;
}

function sortPosts() {
  posts.sort((left, right) => {
    const leftKey = `${left.entryDate || ""} ${left.createdAt || ""}`;
    const rightKey = `${right.entryDate || ""} ${right.createdAt || ""}`;
    return rightKey.localeCompare(leftKey);
  });
}

function withUploadTimeout(promise, ms) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("上传超时，请换个网络或压缩视频后再试")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function extensionFor(name) {
  const match = name.toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? match[0] : "";
}

function formatDisplayDate(post) {
  const value = post.entryDate || String(post.createdAt || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";

  const [year, month, day] = value.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function formatMeta(post) {
  const parts = [formatDisplayDate(post)];
  const publishTime = formatPublishTime(post);
  if (publishTime) parts.push(`发布于 ${publishTime}`);
  parts.push(escapeHtml(post.author || "家人"));
  return parts.filter(Boolean).join(" · ");
}

function formatPublishTime(post) {
  if (!post.createdAt || isSyntheticNoon(post.createdAt)) return "";

  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(post.createdAt));
}

function isSyntheticNoon(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T12:00:00\.000Z$/.test(value);
}

function formatBytes(value) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function todayValue() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function setStatus(text) {
  statusEl.textContent = text;
}
