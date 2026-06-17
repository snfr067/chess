# 台灣暗棋 PWA 手機版

這是一個純靜態的台灣暗棋 PWA 小遊戲，可部署到 GitHub Pages。

## 內容

- 首頁：遊戲開始、遊戲設定
- 設定頁：AI 難度調整
- 遊戲頁：4 × 8 暗棋棋盤、玩家對 AI
- 介面：手機優先，支援直向與橫向；橫向時棋盤在左、狀態與操作在右
- 離線：使用 Service Worker 快取 App Shell

## 部署到 GitHub Pages

1. 建立 public repository。
2. 把本資料夾內所有檔案上傳到 repository 根目錄。
3. 到 Settings → Pages。
4. Source 選 Deploy from a branch。
5. Branch 選 main，Folder 選 /(root)。
6. 儲存後開啟 GitHub Pages 網址。

## iPhone 使用

1. 用 Safari 開啟 GitHub Pages 網址。
2. 確認首頁完整載入。
3. 分享 → 加入主畫面。
4. 從主畫面開啟。
5. 首次快取完成後，可在無網路時開啟已快取版本。

## 注意

若 iOS 清除 Safari 網站資料、系統回收網站資料、或主畫面 Web App 被移除，就需要重新連網載入一次。
