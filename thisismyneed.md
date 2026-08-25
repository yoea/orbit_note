# 私人日记 PWA 开发任务

你现在是一名资深全栈工程师、安全工程师和 iOS Web/PWA 开发工程师。

请从零开发一个**只供单一用户本人使用的私人日记 Web App**。

目标是：

> 我每天通过 iPhone Safari 或安装到 iPhone 主屏幕的 PWA 打开，通过 Face ID / Passkey 快速进入，输入几句话日记，保存后自动记录日期、时间和当前定位。支持草稿恢复、历史日记查看、编辑和删除。所有日记正文必须在客户端加密后再上传服务器，服务器数据库不能保存日记明文。

这个项目部署在一台 ECS 上，已经拥有域名和 HTTPS SSL 证书。

------

# 一、总体技术栈

请优先使用：

- Next.js
- TypeScript
- React
- Tailwind CSS
- PostgreSQL
- Prisma 或 Drizzle ORM（二选一，选择你认为更适合本项目的）
- WebAuthn / Passkey
- Web Crypto API
- AES-256-GCM
- WebAuthn PRF
- IndexedDB
- PWA / Web App Manifest
- Service Worker

不要引入没有必要的大型依赖。

目标不是做一个大型商业系统，而是做一个：

> 极简、快速、稳定、安全、移动端体验优秀的个人日记 App。

------

# 二、用户模型

这个系统只有一个合法用户。

不要设计：

- 用户注册系统
- 用户名密码
- 邮箱登录
- 短信验证码
- 找回密码
- 多用户后台

唯一的身份认证方式：

> Passkey / WebAuthn

第一次访问时，如果系统尚未初始化：

显示：

“创建你的私人日记”

点击：

“使用 Face ID 创建通行密钥”

调用 WebAuthn 创建 Passkey。

以后访问：

“使用 Face ID 解锁”

通过 WebAuthn authentication 完成登录。

不要自己调用 Face ID API。

Passkey 使用 iPhone 系统提供的认证能力。

------

# 三、Passkey 技术要求

必须使用标准 WebAuthn。

需要：

- credential creation
- credential authentication
- server challenge
- server-side assertion verification
- credential ID 存储
- public key 存储
- sign counter / authenticator data 正确验证
- RP ID 必须与实际正式域名匹配

请使用成熟的 WebAuthn 库，不要手工实现 WebAuthn 协议。

可以根据当前 Next.js 生态选择：

@simplewebauthn/server
@simplewebauthn/browser

或者功能等价的成熟方案。

服务器必须验证 WebAuthn assertion，绝不能仅仅相信客户端传来的“登录成功”。

------

# 四、系统初始化

由于只有一个合法用户：

数据库第一次运行时：

如果不存在任何 credential：

允许完成一次初始化。

初始化流程：

1. 用户打开网站
2. 点击“创建私人日记”
3. WebAuthn 注册 Passkey
4. 服务端保存 credential
5. 初始化加密系统
6. 登录成功
7. 进入日记首页

初始化完成后：

如果数据库已经存在合法 credential：

禁止任何其他人重新注册。

只允许已经存在的 credential 登录。

------

# 五、核心要求：日记正文必须端到端加密

这是整个项目最重要的安全要求。

服务器绝对不能看到日记正文明文。

正确的数据流：

用户输入明文
↓
浏览器端加密
↓
得到 ciphertext
↓
通过 HTTPS 上传
↓
服务器保存 ciphertext
↓
读取时服务器返回 ciphertext
↓
浏览器端解密
↓
显示明文

禁止：

用户输入
↓
POST 明文
↓
服务器加密

这不符合本项目的目标。

------

# 六、加密设计

优先利用 WebAuthn PRF。

Safari / WebKit 已经支持 WebAuthn PRF，可以从 Passkey 获取 credential-bound secret。

推荐设计：

1. 首次初始化时浏览器生成随机 256-bit Data Encryption Key，称为 DEK。
2. 日记正文全部使用 DEK 进行 AES-256-GCM 加密。
3. 使用 WebAuthn PRF 产生 Key Encryption Key，称为 KEK。
4. 使用 KEK 加密 DEK。
5. 服务器保存：
   - encrypted DEK
   - encryption metadata
   - ciphertext
   - IV
6. 登录后：
   - WebAuthn authentication
   - PRF 派生 KEK
   - 解密 DEK
   - DEK 留在浏览器内存中
   - 用 DEK 解密所有日记。

不要把 DEK 明文上传服务器。

不要把 KEK 上传服务器。

不要把 PRF 输出上传服务器。

不要把 Recovery Key 明文上传服务器。

------

# 七、Recovery Key

必须设计恢复机制。

因为如果唯一 Passkey 丢失，E2EE 数据可能永久无法解密。

初始化时生成高熵随机 Recovery Key。

推荐至少 256 bit 随机熵。

显示给用户：

“这是你的日记恢复密钥。它只显示一次，请保存到安全的密码管理器中。”

提供：

“复制恢复密钥”

功能。

不要默认把 Recovery Key 保存到服务器。

Recovery Key 用于保护 DEK。

最终：

DEK
├── 使用 Passkey PRF 派生的 KEK 加密
└── 使用 Recovery Key 派生的 KEK 加密

从而支持：

正常情况：

Face ID → Passkey → PRF → KEK → DEK

灾难恢复：

Recovery Key → KEK → DEK

需要在代码注释中明确解释这个密钥层级。

------

# 八、密钥派生

Recovery Key 不要直接作为 AES key。

使用：

HKDF-SHA-256

派生加密密钥。

例如：

Recovery Key
↓
HKDF-SHA-256
↓
Recovery KEK

Passkey PRF 输出
↓
HKDF-SHA-256
↓
Passkey KEK

然后：

KEK
↓
AES-256-GCM
↓
encrypted DEK

------

# 九、AES-256-GCM

日记正文使用：

AES-256-GCM

每一篇日记使用唯一随机 IV。

不要重复使用相同 IV。

推荐：

crypto.getRandomValues()

生成 96-bit IV。

数据库保存：

ciphertext
iv

必要时保存：

encryption_version

例如：

1

方便未来升级加密方案。

------

# 十、数据库模型

建议至少：

## credentials

字段：

- id
- credential_id
- public_key
- counter
- transports
- created_at
- last_used_at

## encryption_keys

字段：

- id
- encrypted_dek_by_passkey
- encrypted_dek_by_recovery
- passkey_salt
- recovery_salt
- encryption_version
- created_at
- updated_at

## diary_entries

字段：

- id
- ciphertext
- iv
- encryption_version
- created_at
- updated_at
- latitude
- longitude
- location_accuracy
- timezone

## drafts

字段：

- id
- ciphertext
- iv
- encryption_version
- updated_at

因为只有一个用户，不需要 user_id 外键。

------

# 十一、时间

保存：

created_at
updated_at

服务器统一使用 UTC。

同时记录：

timezone

前端显示时转换为用户当前或写作时的时区。

不要把服务器本地时区作为业务逻辑。

页面显示：

2026年8月25日 22:36

而数据库可以保存：

2026-08-25T14:36:00Z

------

# 十二、定位

保存日记时请求：

navigator.geolocation

获取：

latitude
longitude
accuracy

记录写作时的位置。

第一次请求定位权限时：

向用户说明：

“保存日记时记录当前位置，仅用于记录你当时在哪里。”

如果用户拒绝定位：

日记仍然可以保存。

不要阻止用户写日记。

不要调用第三方地图 API 上传用户位置。

第一版不需要逆地理编码。

页面可以显示：

“记录了当前位置”

点击以后可以显示坐标。

定位属于敏感 metadata。

代码中明确说明：

日记正文是 E2EE，但当前方案的 latitude / longitude / timestamp 属于服务器可见 metadata。

------

# 十三、主界面

首页必须极简。

移动端优先。

iPhone 页面建议：

顶部：

“我的日记”

右上角：

设置

中间：

一个非常大的 textarea。

placeholder：

“写下此刻……”

底部：

当前状态：

“已保存”

或者：

“正在保存…”

主按钮：

“保存”

------

# 十四、编辑器

必须：

- 支持换行
- 支持 iOS 原生 Emoji
- 支持中文输入法
- 支持长文本
- 自动增长高度
- 不使用 contenteditable
- 优先使用 textarea
- 不改变用户输入内容
- 不自动修改 Emoji
- 不自动修改中文标点

支持：

😀 ❤️ 🥹 😭 🫠 😂

等原生 Unicode Emoji。

------

# 十五、自动草稿

这是重要功能。

用户开始输入以后：

自动保存草稿。

推荐 debounce：

500~1000ms。

草稿保存流程：

textarea
↓
debounce
↓
客户端加密
↓
IndexedDB
↓
服务器加密草稿同步

必须先在浏览器端加密，再上传。

服务器永远只能看到：

ciphertext

------

# 十六、离线草稿

即使网络断开：

用户仍然应该可以继续输入。

本地 IndexedDB 保存：

- 草稿
- 必要的加密 metadata

恢复网络后自动同步。

如果：

服务器草稿
VS
本地草稿

发生冲突：

保留更新时间较新的版本，并在界面显示明确状态。

不要静默覆盖用户内容。

------

# 十七、打开页面恢复草稿

如果存在未保存草稿：

显示：

“发现上次未完成的日记”

按钮：

“恢复草稿”

“放弃草稿”

不要直接覆盖当前输入。

------

# 十八、保存日记

点击保存：

1. 获取当前位置（如果权限允许）
2. 获取当前时间
3. 客户端加密正文
4. POST 密文
5. 服务端保存
6. 删除草稿
7. 显示：

“已保存 · 22:36”

保存完成后可以：

清空编辑框

然后继续写下一篇。

------

# 十九、历史日记

增加：

“历史”

列表。

按照日期倒序。

例如：

2026-08-25

22:36
今天晚上……

18:12
下午……

2026-08-24

00:13
……

服务器返回密文。

只有浏览器完成解密后才显示正文。

服务器 API 不允许返回任何明文正文。

------

# 二十、历史日记编辑

点击历史记录：

进入详情页。

显示：

日期
时间
地点

正文。

按钮：

“编辑”

进入编辑状态。

保存以后：

重新客户端加密

覆盖原 ciphertext。

updated_at 更新。

------

# 二十一、删除

删除按钮：

“删除日记”

必须二次确认。

例如：

“确定删除这篇日记吗？删除后无法恢复。”

确认：

DELETE API

服务器真正删除记录。

同时清除本地相关缓存。

------

# 二十二、本地缓存

使用 IndexedDB。

不要把日记正文明文放进：

localStorage

sessionStorage

URL

Cookie

Redux persistence

任何服务器可读取位置。

如果必须临时缓存正文：

仅允许在 JavaScript 内存中存在。

数据库本地缓存也必须尽量保持加密状态。

------

# 二十三、PWA

必须制作 Web App Manifest。

包含：

- name
- short_name
- start_url
- display: standalone
- theme_color
- background_color
- icons

同时兼容 iOS：

apple-touch-icon

apple-mobile-web-app-title

必要的 iOS Web App meta 标签。

目标：

用户从 Safari：

分享
→ 添加到主屏幕
→ 点击图标

打开后应该像 App 一样，没有普通 Safari 地址栏。

在 iOS 26 上，系统已经支持网站作为 Home Screen Web App 打开，因此要针对 iPhone 体验进行优化。

------

# 二十四、Service Worker

实现基础 Service Worker。

至少缓存：

- 静态 JS
- CSS
- 图标
- manifest

但不要将服务器上的日记密文随意缓存到 Cache Storage。

日记数据使用 IndexedDB 管理。

Service Worker 只负责静态资源和必要的离线能力。

------

# 二十五、iPhone UI

这是一个“移动端第一”的项目。

不要先设计桌面端然后缩小到手机。

必须针对：

iPhone Safari

iOS 26

设计。

要求：

- Safe Area
- env(safe-area-inset-top)
- env(safe-area-inset-bottom)
- 大号触摸区域
- 防止键盘遮挡输入框
- 输入框自动聚焦
- 适配 Dynamic Island
- 适配浅色 / 深色模式
- 支持 iOS 原生中文输入法
- 防止双击缩放
- 不出现横向滚动

整体 UI 尽量接近：

Apple Notes

Day One

Bear

这种非常干净的移动端体验。

不要做复杂 Dashboard。

------

# 二十六、登录状态

登录成功后：

浏览器内存中保持解锁状态。

不要把解密后的 DEK 永久保存到 localStorage。

页面刷新后：

重新要求 Passkey。

可以考虑短时间 session。

服务器 session cookie：

- HttpOnly
- Secure
- SameSite=Lax 或 Strict
- 不保存加密密钥

------

# 二十七、API 安全

所有 API：

必须验证 authentication/session。

除公开初始化相关 endpoint 外：

任何日记 API 没有认证就返回 401。

必须：

- CSRF 防护
- CORS 限制
- rate limiting
- 输入长度限制
- JSON schema validation
- SQL injection 防护
- XSS 防护
- Content Security Policy

不能相信客户端传来的：

created_at

updated_at

location

id

等字段。

------

# 二十八、XSS

因为这是私人日记。

不要把用户日记正文直接使用：

dangerouslySetInnerHTML

渲染。

普通文本直接：

textContent

或 React 默认文本渲染。

换行使用 CSS：

white-space: pre-wrap

不要因为“支持换行”而引入 Markdown renderer。

第一版不需要 Markdown。

------

# 二十九、服务器日志

这是非常重要的一点。

服务器日志中：

禁止输出：

- diary plaintext
- draft plaintext
- encryption keys
- recovery key
- PRF output

API debug log 也不能输出 request body 中的日记内容。

生产环境关闭 verbose logging。

------

# 三十、数据库备份

PostgreSQL 可以定期备份。

但是备份里面仍然只有：

日记密文。

所以即使：

- 数据库泄漏
- ECS 被入侵
- 数据库备份泄漏

攻击者也不能直接看到日记正文。

但要注意：

如果攻击者控制了生产服务器并能够修改前端 JavaScript，那么未来理论上可能诱导用户把明文传给攻击者。

因此：

生产环境必须：

- CSP
- HTTPS
- 尽量减少第三方 JS
- 不引入 Google Analytics 等第三方追踪脚本
- 不引用第三方 CDN JS
- 所有 JS 尽量自托管
- 定期更新依赖

请在 README 中解释：

“E2EE 能防止数据库泄露，但无法完全抵御已经被攻陷的客户端/前端代码。”

这是重要的安全边界。

------

# 三十一、不允许加入的功能

第一版禁止加入：

- AI 分析日记
- 情绪分析
- 第三方统计
- Google Analytics
- 广告
- 社交功能
- 分享
- 多用户
- 评论
- Markdown
- 图片上传
- 视频上传
- 富文本编辑器

先把：

“写 → 保存 → 加密 → 恢复 → 查看”

这条主链路做稳定。

------

# 三十二、页面结构

建议：

/ 首页
/login 登录
/history 历史
/entry/[id] 日记详情
/settings 设置
/setup 第一次初始化

------

# 三十三、设置页面

设置中至少显示：

“Passkey”

状态：

已启用

按钮：

“注册新的 Passkey”

这样未来可以支持多个 Passkey。

还可以：

“导出恢复密钥”

“重新生成恢复密钥”

“退出登录”

“删除所有数据”

“关于”

------

# 三十四、多个 Passkey

架构上需要支持多个 credential。

虽然现在只有一个用户。

原因：

未来可能：

- iPhone
- Mac
- iPad

都需要登录。

因此数据库不要假设只有一个 credential。

但：

只要第一个 credential 注册完成：

就禁止陌生用户再次初始化。

------

# 三十五、多个 Passkey 和 E2EE 的兼容

如果增加第二个 Passkey：

新的 Passkey 需要通过 PRF 派生新的 KEK。

然后：

新的 KEK 加密同一个 DEK。

数据库可以保存：

multiple encrypted DEK wrappers

例如：

key_wrappers：

- credential A → encrypted DEK
- credential B → encrypted DEK

这样：

Passkey A
或
Passkey B

都可以解锁同一个 DEK。

请让密钥管理模块从一开始就按照这种结构设计。

------

# 三十六、测试

必须测试：

### WebAuthn

- 首次注册
- 登录
- 错误 credential
- 未认证访问 API
- 登录退出
- 多 credential

### E2EE

- 加密
- 解密
- 刷新页面
- 登出
- 删除浏览器缓存
- 恢复 key
- 错误 key
- 篡改 ciphertext
- 篡改 IV

AES-GCM 被篡改以后必须解密失败。

### Diary

- 新建
- 编辑
- 删除
- 多行
- Emoji
- 中文
- 长文本
- 空白内容
- 网络断开
- 网络恢复

### Draft

- 自动保存
- 刷新后恢复
- 浏览器关闭恢复
- 离线恢复
- 冲突处理

### Geolocation

- 允许
- 拒绝
- 无法获取
- 精度较低
- HTTPS

### PWA

- 添加主屏幕
- 独立启动
- 图标
- 深色模式
- iPhone Safe Area
- 键盘
- 横竖屏

------

# 三十七、安全自检

开发完成后，请自己进行一次安全审查。

重点回答：

1. 数据库是否存在任何日记明文？
2. API 是否存在任何明文返回？
3. 日记是否在客户端加密后才上传？
4. DEK 是否可能进入服务器？
5. PRF 输出是否可能进入服务器日志？
6. Recovery Key 是否可能进入服务器？
7. localStorage 是否保存明文日记？
8. Cookie 是否保存敏感密钥？
9. 是否存在 XSS？
10. 未登录能否调用 diary API？
11. 是否存在 IDOR？
12. 删除 API 是否需要认证？
13. 服务器日志是否泄露 request body？
14. 第三方脚本是否能够读取日记？
15. 数据库泄露后攻击者是否能直接看到正文？

必须全部检查。

------

# 三十八、开发顺序

请不要一次性把所有内容糊在一起。

按照以下顺序实施：

Phase 1
项目基础架构

Phase 2
数据库

Phase 3
WebAuthn / Passkey

Phase 4
E2EE Crypto 模块

Phase 5
Diary CRUD API

Phase 6
日记首页

Phase 7
历史记录

Phase 8
Draft / IndexedDB

Phase 9
Geolocation

Phase 10
PWA

Phase 11
安全加固

Phase 12
测试

Phase 13
生产部署

------

# 三十九、代码质量

要求：

- TypeScript strict
- 不使用 any，除非有明确理由
- 环境变量统一通过 env 管理
- secrets 不提交 git
- .env.example
- README
- 数据库 migration
- production build 必须通过
- lint 必须通过
- typecheck 必须通过

代码结构清晰。

尤其把：

auth
crypto
database
diary
draft
location

分别模块化。

------

# 四十、部署

项目最终部署到：

ECS

已有：

域名

SSL

请提供：

生产环境部署说明。

包括：

- Node.js 版本
- PostgreSQL
- npm/pnpm
- environment variables
- migration
- build
- start
- PM2 或 systemd
- Nginx
- HTTPS
- WebSocket（如果不需要则不要配置）
- backup

推荐：

Internet
↓
Nginx
↓
Next.js
↓
PostgreSQL

------

# 四十一、环境变量

至少设计：

DATABASE_URL

WEBAUTHN_RP_ID

WEBAUTHN_RP_NAME

WEBAUTHN_ORIGIN

SESSION_SECRET

RECOVERY_KEY_VERSION

以及必要的其他变量。

不要把：

Passkey private key

Encryption key

Recovery key

写入环境变量。

------

# 四十二、最终体验

最终真实使用应该是：

第一次：

Safari
↓
打开网址
↓
创建 Passkey
↓
Face ID
↓
进入日记

以后：

点击 iPhone 桌面图标
↓
Web App 打开
↓
Face ID
↓
进入首页
↓
光标在输入框
↓
输入：

“今天晚上突然想写点东西……”

↓
自动保存草稿
↓
点击保存
↓
获取当前位置
↓
客户端 AES-256-GCM 加密
↓
上传 ciphertext
↓
服务器保存
↓
显示：

“已保存 · 22:36”

历史：

2026年8月25日
22:36

“今天晚上突然想写点东西……”

编辑 / 删除

整个流程应该非常轻。

------

# 四十三、重要开发原则

这是一个个人私人日记，不是企业 OA。

所以：

第一优先级：

安全

第二优先级：

稳定

第三优先级：

极简

第四优先级：

开发成本

不要为了“架构漂亮”引入微服务。

不要为了“未来可能有一万人使用”提前设计复杂系统。

这个系统即使未来只有一个用户，也应该拥有很好的安全边界。

------

# 四十四、开始工作前

先扫描当前项目目录。

判断是否已经存在：

Next.js
package.json
数据库
Docker
Nginx
部署文件

不要覆盖已有项目。

先告诉我你发现了什么。

然后给出：

1. 当前项目结构
2. 推荐架构
3. 需要新增的文件
4. 需要安装的依赖
5. 数据库 schema
6. 加密方案
7. WebAuthn 方案

然后开始实际编码。

不要只给方案。

请直接完成代码。

每完成一个 Phase 后：

运行：

npm run lint
npm run typecheck
npm run build

解决所有错误。

最终给出：

- 完整项目
- 数据库 migration
- .env.example
- README
- 部署说明
- 安全说明
- 测试说明

并特别告诉我：

“第一次初始化 Passkey 的操作方法”

“如何把网站添加到 iPhone 主屏幕”

“Recovery Key 应该如何保存”

“如果换 iPhone 应该如何恢复”

# 最终验收标准

只有同时满足以下条件，才算完成：

✅ iPhone Safari 可正常使用
✅ Passkey + Face ID 登录
✅ 不需要密码
✅ 日记支持换行
✅ 支持中文
✅ 支持 iOS 原生 Emoji
✅ 可以保存日记
✅ 自动保存草稿
✅ 下次打开能恢复草稿
✅ 自动记录时间
✅ 自动记录当前位置
✅ 可以查看历史
✅ 可以编辑
✅ 可以删除
✅ PWA 可添加到 iPhone 主屏幕
✅ 独立 Web App 打开
✅ 日记正文客户端加密
✅ 数据库没有日记明文
✅ Recovery Key 可恢复
✅ 不会把加密密钥上传服务器
✅ 未登录不能读取日记
✅ 生产环境 HTTPS
✅ 无第三方统计脚本
✅ npm build 成功
✅ lint 成功
✅ typecheck 成功

如果实现过程中发现某项浏览器 API 在当前 iOS/Safari 版本存在兼容性问题：

不要假装支持。

请明确告诉我：

- 当前能力
- 兼容性问题
- 推荐 fallback
- 对 E2EE 安全性的影响

优先保证 iPhone + Safari + iOS 26 的真实可用性。

开发阶段需要支持windows 11 edge浏览器调试。