mobile-r16 safe viewport and board fit repair


## v17 固定橫向舞台

此版把遊戲改成固定 932×430 橫向舞台。啟動時只依當下視窗做一次定位與縮放，不監聽 resize / orientationchange / DeviceOrientation，也不因手機轉動切換內部排版。
