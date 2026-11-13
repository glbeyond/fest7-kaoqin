# FEST7 考勤工资结算（静态前端）

这是给 GitHub Pages（或其他静态托管）用的前端。页面通过 `POST text/plain` 调用 Apps Script JSON API，不携带 Google Cookie，因此手机上登录了多个 Google 账号时也能打开，不会再出现「抱歉，目前无法打开该文件」。

## 使用

1. 在 Apps Script 中更新并重新部署 `Code.gs`（需包含 `doPost`），执行身份=我，谁可以访问=任何人。
2. 确认 `config.js` 里的 `API_URL` 指向该网页应用 `/exec` 地址。
3. 把本目录全部文件推送到 GitHub 仓库，在仓库设置里打开 Pages（例如主分支的 `/` 或 `/docs`）。仓库若发布在 `https://用户名.github.io/仓库名/` 这类子路径下也可直接使用，因为资源链接都是相对路径。
4. 员工打开 `index.html`，管理员打开 `admin.html`。

请勿把后台密码写进本仓库。初始密码为 `admin`，登录后请立即修改。

## 安装到手机桌面（PWA）

本目录已作为可安装的网页应用：员工页与管理后台各有一份 manifest。在 Android Chrome 中可通过「安装到桌面」提示添加；在 iOS Safari 中通过分享按钮选择「添加到主屏幕」。

图标由仓库根目录的 `make-icons.sh` 根据 `logo.png`（或你提供的源图）生成。更换 Logo 后在本目录执行：

```bash
./make-icons.sh /path/to/new-logo.png
```

源图会被复制为 `logo.png`，并重新输出 `icon-*.png`、`admin-icon-*.png`、`apple-touch-icon.png`、`favicon-32.png`。
