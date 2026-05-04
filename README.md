# Todo Reminder

一个支持公网访问、多端同步的待办提醒应用。前端使用 React + Vite，数据存储和实时同步使用 Supabase。

现在的同步方式是“共享房间码”：电脑和 iPhone 输入同一个房间码，就会进入同一份待办列表。应用不再使用邮箱 magic link，因此不会触发 Supabase 邮件发送频率限制。

## 本地运行

1. 安装依赖：

```bash
npm install
```

2. 创建本地环境变量：

```bash
copy .env.example .env.local
```

3. 在 `.env.local` 中填入 Supabase 项目的：

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

4. 在 Supabase SQL Editor 中执行 `supabase/schema.sql`。

5. 启动开发服务器：

```bash
npm run dev
```

## Supabase 配置

- 在 SQL Editor 中执行 `supabase/schema.sql`。
- `tasks` 表使用 `room_id` 区分不同房间。
- 前端会把房间码通过 SHA-256 转换为 `room_id`，不会把原始房间码写入数据库。
- 这是共享房间方案：知道同一个房间码的人都可以访问同一份待办，请使用不容易猜到的房间码。

## 部署到 Vercel

1. 将仓库推送到 GitHub。
2. 在 Vercel 导入该 GitHub 仓库。
3. 在 Vercel Project Settings 的 Environment Variables 中添加：

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

4. 部署完成后，打开 Vercel 公网地址，在电脑和 iPhone 输入同一个房间码。

## 常用命令

```bash
npm run lint
npm run build
npm run dev
```
