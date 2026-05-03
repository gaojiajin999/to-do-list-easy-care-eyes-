# Todo Reminder

一个支持邮箱登录、多端同步的待办提醒应用。前端使用 React + Vite，登录、数据库和实时同步使用 Supabase。

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

- Authentication 中开启邮箱登录。
- URL Configuration 的 Site URL 本地可填 `http://localhost:5173`，部署后改成 Vercel 公网地址。
- Additional Redirect URLs 同时加入本地地址和 Vercel 地址。
- Database 的 Replication/Reatime 需要包含 `public.tasks`。`supabase/schema.sql` 已包含相关 SQL。

## 部署到 Vercel

1. 将仓库推送到 GitHub。
2. 在 Vercel 导入该 GitHub 仓库。
3. 在 Vercel Project Settings 的 Environment Variables 中添加：

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

4. 部署完成后，把 Vercel 域名填回 Supabase Auth 的 Site URL 和 Redirect URLs。

## 常用命令

```bash
npm run lint
npm run build
npm run dev
```
