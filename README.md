# 飞翔之家大小事

这是一个面向 Vercel 部署的家庭动态小站，可以发布文字、选择记录日期、记录北京时间发布到分钟、填写发布人昵称、上传图片和视频。

## 技术结构

- 前端：Vite 静态站点
- 媒体上传：Vercel Blob 客户端直传，适合图片和较大的视频
- 记录：每条记录独立保存到 Vercel Blob 的 `family-moments/posts/*.json`，并兼容旧的 `family-moments/posts.json`
- API：
  - `GET /api/posts` 读取记录
  - `POST /api/posts` 新增记录
  - `POST /api/upload` 生成 Blob 上传 token

## Vercel 部署前准备

1. 在 Vercel Dashboard 新建或导入这个项目。
2. 给项目添加 Vercel Blob Store。
3. 确认项目环境变量里有 `BLOB_READ_WRITE_TOKEN`。
4. 部署。

## 用 Vercel CLI 部署

```bash
npm install
npm i -g vercel
vercel login
vercel link
vercel --prod
```

## 本地开发

```bash
npm install
npm run dev
```

本地调试上传功能需要 `.env.local` 里有 `BLOB_READ_WRITE_TOKEN`。

## 环境变量

```text
BLOB_READ_WRITE_TOKEN=Vercel Blob 自动提供
```
