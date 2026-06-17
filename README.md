# 台灣暗棋 PWA v7

手機橫向優先版。新增：

- AI 每步延遲設定，可在「遊戲設定」調整 0.2～2.5 秒。
- AI 行動前會標示來源與目標，再依設定秒數執行。
- 翻棋、移動、吃子、吃暗棋失敗都有簡單動畫。
- 保留 v6 的連吃規則與不偷看暗棋 AI。

## 本機測試

在此資料夾執行：

```bash
python -m http.server 8000
```

或 Windows：

```powershell
py -m http.server 8000
```

瀏覽器開啟：

```text
http://localhost:8000/
```

## GitHub Pages

把本資料夾內全部檔案放到 GitHub repository 根目錄，Pages 設定為 `main / root`。
