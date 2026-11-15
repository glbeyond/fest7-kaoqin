# FEST7 考勤工资结算（静态前端）

这是给 GitHub Pages（或其他静态托管）用的前端。页面通过 `POST text/plain` 调用 Apps Script JSON API，不携带 Google Cookie，因此手机上登录了多个 Google 账号时也能打开，不会再出现「抱歉，目前无法打开该文件」。

## 使用

1. 在 Apps Script 中更新并重新部署 `Code.gs`（需包含 `doPost`），执行身份=我，谁可以访问=任何人。
2. 确认 `config.js` 里的 `API_URL` 指向该网页应用 `/exec` 地址。
3. 把本目录全部文件推送到 GitHub 仓库，在仓库设置里打开 Pages（例如主分支的 `/` 或 `/docs`）。仓库若发布在 `https://用户名.github.io/仓库名/` 这类子路径下也可直接使用，因为资源链接都是相对路径。
4. 员工打开 `index.html`，管理员打开 `admin.html`。

请勿把后台密码写进本仓库。首次部署后请在后台「数据与密码」页立即设置自己的密码。

## 安装到手机桌面（PWA）

本目录已作为可安装的网页应用：员工页与管理后台各有一份 manifest。在 Android Chrome 中可通过「安装到桌面」提示添加；在 iOS Safari 中通过分享按钮选择「添加到主屏幕」。

桌面名称：员工端「月结助手」（玫红底 F7 图标），后台「月结后台」（深墨底 F7 图标），主屏幕上一眼可分。

图标是「F7」斜体字标（路径化，不依赖字体），由工作目录 `icon-src/` 里的生成器产出，生成器不随网站部署。重新生成：

```bash
./make-icons.sh
```

会输出 `icon-192/512.png`、`icon-maskable-512.png`、`apple-touch-icon.png`、`favicon-32.png`、`favicon.svg`，以及对应的 `admin-*` 版本。改动任何静态文件后，请同时升级 `sw.js` 的 `CACHE_VER` 和 HTML 中的 `?v=` 版本号。

## 界面（v2 · FEST7 Ledger）

- 纯 HTML/CSS/JS，无框架。样式：`tokens.css`（设计变量 + 自带 Inter 数字字体 `fonts/inter-latin.woff2`）+ `app.css`（组件与页面）。
- 图标：`icons.js` 内联 Lucide（ISC 许可）SVG sprite，须在 `utils.js` 之前加载。
- 管理后台：总览 / 月度结算 / 审批 / 员工与基本工资 / 数据与密码。审批、驳回、删除有 5 秒撤销；关闭页面或切到后台时会立即发送未提交的操作。
- 员工页：首页选类型 → 分步表单 → 提交前核对 → 回执；后台入口在页脚「管理员入口」。
