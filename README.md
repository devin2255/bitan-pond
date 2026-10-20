# 鱼戏莲叶间

会跟着天气和时间变化的 Windows 桌面池塘。锦鲤在荷叶间游动，晴雨风雪、日出月落都会反映在水面上。

## 可以做什么

- 按所在城市或当前位置，用 [Open-Meteo](https://open-meteo.com/) 显示今天和未来两天的天气。定位只用于查天气，精度大约 10 公里，选择保存在这台电脑上。
- 单击水面投喂。光标靠近时锦鲤会散开。右键打开菜单。
- 画一条自己的锦鲤，放进池塘后会一起游动、避让和吃食。
- 按这次打开后吃到的鱼粮看排行榜。重新打开软件会重新计数。
- 铺到桌面图标下面，当桌面壁纸使用。托盘图标或 F11 可以恢复窗口。
- 右上角可以切换天气、时段和月相，方便看清晨、正午、傍晚、深夜，以及蛾眉月、上弦月、满月、下弦月和残月。

## 操作

| 操作 | 结果 |
| --- | --- |
| 单击水面 | 投喂 |
| 光标靠近 | 锦鲤散开 |
| 右键 | 打开菜单 |
| F11 | 铺到桌面 / 恢复窗口 |
| 托盘图标 | 恢复窗口，或退出 |

月亮只在晴天的夜里出现。不同月相升起和落下的时间不一样：蛾眉月在天刚黑时，上弦月在上半夜，下弦月在下半夜，满月整夜都在。

## 本地运行

需要 Node.js。

```bash
npm install
npm start
```

## 打包

生成 Windows 便携版 `dist/鱼戏莲叶间.exe`：

```bash
npm run dist
```

如果下载 Electron 很慢，可以先指定镜像再打包：

```powershell
$env:ELECTRON_MIRROR="https://cdn.npmmirror.com/binaries/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://cdn.npmmirror.com/binaries/electron-builder-binaries/"
$env:CSC_IDENTITY_AUTO_DISCOVERY="false"
npm run dist
```

便携版每次启动会在系统临时目录解压。请留给 C 盘大约 1 GB 空闲空间。正常退出后会清掉这次的临时文件。
