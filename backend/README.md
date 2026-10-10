# SpeakLoop 后端

这是 SpeakLoop 当前网页原型配套的 FastAPI + MySQL API。接口结构借鉴了 [FastAPI 官方全栈模板](https://github.com/fastapi/full-stack-fastapi-template) 的分层路由、SQLModel、JWT、密码哈希和 Alembic 迁移方式；保留现有静态 HTML/CSS/JS 页面，不引入模板中的 React 前端。

## 已覆盖的页面功能

- 注册、登录、退出、修改密码；密码使用 Argon2 哈希，数据库不保存明文密码。
- 个人资料：昵称、性别、地区、学习语言和头像上传。
- 个性化设置：字体大小 12–20 px。
- 账号安全：本地开发环境可用调试验证码验证换绑手机号；没有配置真实短信服务，生产环境会拒绝发送验证码。
- 练习场景目录：和首页的初级/中级/高级九个场景对应。
- 最近 30 条练习记录、未完成练习续练和练习收藏快照。
- Azure Speech 发音评测：英语、日语、普通话；提供 0–5 发音分、准确度、流利度、完整度、韵律和词/音素细分。
- FastAPI 自动接口文档：`/docs`。

浏览器负责实时字幕和跟读进度，松开录音后把音频转换为 16 kHz 单声道 PCM WAV 并上传到 FastAPI。后端经 Azure Speech Pronunciation Assessment 获取真实评分和词/音素细节，再保存转写与分数；原始音频只在本次请求处理中暂存，不写入磁盘或 MySQL。单次录音上限 30 秒。语音合成和 AI 对话尚未接入。

### 配置真实评分服务

在 Azure 创建 Speech 资源后，将密钥和资源所在区域写入 `backend/.env`（不要提交该文件）：

```dotenv
AZURE_SPEECH_KEY=你的Speech资源密钥
AZURE_SPEECH_REGION=资源所在区域
```

然后安装新增依赖并重启后端。评分接口没有配置密钥时会明确返回“真实语音评分尚未配置”，不会回退成估算分。每次评分会把本次录音发送到 Azure Speech；前端会告知用户这一点。

## Windows 本地启动

需要 Python 3.11 或更新版本，以及 Docker Desktop（或已安装的 MySQL 8.4）。在 VS Code 打开 `speakloop-vscode` 项目文件夹，再在终端运行：

```powershell
cd backend
Copy-Item .env.example .env
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
docker compose up -d --wait mysql
alembic upgrade head
uvicorn app.main:app --reload
```

浏览器打开 `http://127.0.0.1:8000/`，页面和 API 由同一 FastAPI 服务提供，避免本地文件 `file://` 请求 API 时的跨域问题。API 文档在 `http://127.0.0.1:8000/docs`。

`.env.example` 仅供本机开发。部署时必须关闭 `DEBUG`、设置随机 `SECRET_KEY`、修改 MySQL 密码，并配置真实短信与邮件服务；不要把 `.env` 提交到 Git。

## API 路由

基础路径：`/api/v1`

| 路由 | 用途 |
|---|---|
| `POST /auth/register`、`POST /auth/login`、`POST /auth/logout` | 创建账号、登录、退出 |
| `GET /auth/me`、`PATCH /users/me` | 读取和保存个人资料 |
| `PATCH /users/me/preferences` | 保存字体大小 |
| `POST /users/me/avatar` | 上传头像（JPG、PNG、WebP，最大 2 MB） |
| `POST /auth/change-password` | 验证当前密码并更新密码 |
| `POST /auth/phone/request-code`、`POST /auth/phone/confirm` | 调试验证码换绑流程 |
| `GET /scenarios?language=en&level=beginner` | 查询练习场景目录 |
| `POST/GET/PATCH /practice-sessions` | 创建、查询、更新练习记录；列表最多返回 30 条 |
| `GET/POST/DELETE /favorites` | 查询、保存和取消收藏快照 |
| `POST /speech/assessments` | 上传本次录音并获取真实发音评分（需要 Azure Speech 配置） |
| `GET /speech/assessments?limit=20` | 读取当前账号最近的评分结果，最多 30 条 |
| `GET /dashboard/summary` | 最近练习汇总 |

评分请求使用 `multipart/form-data` 字段：`audio`（WAV、16 kHz、单声道、16-bit PCM）、`reference_text`、`language`（`en`/`ja`/`zh`）和可选 `session_id`。请求需要登录令牌。

请求体和返回字段可以直接在 `/docs` 查看。所有用户数据路由都按当前登录用户隔离。

## 数据与目录

MySQL 使用 `utf8mb4`，数据库变更通过 Alembic 管理。头像文件写入 `backend/media/avatars/`，数据库只保存相对 URL；上传目录已加入 `.gitignore`。当前练习场景元数据由 `app/catalog.py` 提供，后续需要内容管理后台时再迁移到数据库表。
