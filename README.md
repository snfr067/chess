# 台灣暗棋 PWA 小遊戲

這是一個純靜態 PWA 版本暗棋小遊戲，可部署到 GitHub Pages。

## 檔案

- `index.html`：首頁、設定頁、遊戲頁
- `style.css`：手機優先的暗棋介面
- `app.js`：暗棋規則、AI 搜尋、頁面切換
- `manifest.webmanifest`：PWA 安裝資訊
- `service-worker.js`：離線快取
- `icon.svg`、`apple-touch-icon.svg`：圖示

## 本機測試

不要直接用雙擊 `index.html` 測 Service Worker，請用本機伺服器。

Python 方式：

```bash
python -m http.server 8000
```

然後開：

```text
http://localhost:8000
```

## GitHub Pages 部署

1. 到 GitHub 新增一個 public repository，例如 `dark-chess-pwa`
2. 把這個資料夾裡的所有檔案上傳到 repository 根目錄
3. 進入 repository 的 `Settings`
4. 左側選 `Pages`
5. `Source` 選 `Deploy from a branch`
6. `Branch` 選 `main`
7. 資料夾選 `/(root)`
8. 按 `Save`
9. 等 GitHub Pages 完成部署
10. 開啟網址：`https://您的帳號.github.io/dark-chess-pwa/`

## iPhone 加入主畫面

1. 用 Safari 開啟 GitHub Pages 網址
2. 點分享
3. 選「加入主畫面」
4. 名稱可改成「台灣暗棋」
5. 按新增

第一次開啟需要網路；完成載入後，Service Worker 會快取檔案，之後可在無網路時從主畫面開啟。
