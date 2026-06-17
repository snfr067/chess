# 台灣暗棋 PWA 手機版 v4

這一版針對手機橫向與直向重新整理版面。

## 重點

- GitHub Pages 靜態部署即可使用。
- 手機橫向：棋盤在左，資訊與操作在右。
- 手機直向：自動上下堆疊。
- 修正上一版棋盤與右側資訊區互相擠壓、覆蓋的問題。
- 修正缺少 board-wrap 導致橫向 grid 版面沒有正確套用的問題。
- 版本：mobile-r4-20260617-phone-fit。

## 部署

1. 建立 GitHub public repository。
2. 將本資料夾內所有檔案上傳到 repository 根目錄。
3. 到 Settings → Pages。
4. Source 選 Deploy from a branch。
5. Branch 選 main，Folder 選 /(root)。
6. 開啟 GitHub Pages 網址。

## 更新舊版

若手機仍顯示舊版，請確認網址列或畫面右下角版本顯示為：

mobile-r4-20260617-phone-fit

若仍是舊版，請用新網址參數開啟：

?fresh=mobile-r4
