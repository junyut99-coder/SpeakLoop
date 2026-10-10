# 声桥 SpeakLoop 演示项目

这是根据当前注册页和口语练习演示整理的项目。前端使用原生 HTML、CSS、JavaScript；后端使用 FastAPI + MySQL。

## 在 VS Code 中打开

1. 在 VS Code 选择“文件 → 打开文件夹”。
2. 选择 `speakloop-vscode` 文件夹。
3. 前端静态预览可直接打开 `index.html`。连接后端进行真实注册和保存时，请按 [`backend/README.md`](backend/README.md) 启动 FastAPI，再打开 `http://127.0.0.1:8000/`。
4. 仅预览不调用后端时，可使用 VS Code 的 Live Server 扩展；也可以在项目目录运行：

   ```powershell
   python -m http.server 5500
   ```

   然后访问 `http://localhost:5500`。

## 目录结构

```text
speakloop-vscode/
├── index.html             # 注册页
├── practice.html          # 学习首页、口语练习、收藏、记录和设置演示
├── assets/
│   ├── css/
│   │   ├── index.css
│   │   └── practice.css
│   └── js/
│       ├── index.js
│       ├── api.js
│       ├── practice.js
│       └── practice-api.js
├── backend/
│   ├── app/                # FastAPI 路由、数据模型和认证
│   ├── alembic/            # MySQL 数据迁移
│   ├── docker-compose.yml  # 本地 MySQL 8.4
│   └── README.md           # 后端启动和接口说明
└── README.md
```

## 当前实现范围

- 注册、语言选择、练习场景切换、收藏/取消收藏、历史记录、设置等沿用当前演示中的交互。
- 语音练习接入英语、日语和普通话的真实发音评测：按住录音、实时字幕/进度、录音回听、0–5 一位小数发音分以及准确度、流利度、完整度、韵律、词和音素细分。
- 通过 FastAPI 页面入口注册的账号、资料、收藏和练习记录会写入 MySQL；练习记录、今日时长和周目标按服务端数据展示。
- 直接以 `file://` 或 Live Server 打开页面时，API 地址不可用；请使用 FastAPI 提供的 `http://127.0.0.1:8000/`。
- Chrome/Edge 浏览器负责实时字幕和进度；录音停止后会经 SpeakLoop 后端发送给 Azure Speech 评分。后端保存转写和评分明细，不保存原始录音；每次最多 30 秒。
- 真实评分需要在 `backend/.env` 设置 Azure Speech 资源的 `AZURE_SPEECH_KEY` 和 `AZURE_SPEECH_REGION`，并执行 Alembic 数据库迁移。尚未配置服务时，界面会明确显示评分不可用，不生成估算分。语音合成和 AI 对话尚未接入。

## 后续接入建议

短信验证码和密码找回邮件服务尚未配置。正式部署前应按后端说明设置密钥、数据库口令与外部服务凭据。
