// 守卫：线上绝不在服务器上跑 npm 安装类命令（2026-10-29，用户明确要求钉死）
//
// 事故背景（见 .workbuddy/memory/RUNBOOK-DEPLOY.md「★ 铁律：线上绝不装依赖、绝不 build」）：
//   服务器 1.8G 内存 + 磁盘带 BPS 限速。`npm ci` 会**瞬间吃满磁盘 IO**，后果不是「慢」，
//   而是**站点与 SSH 同时不可达**（SSH 连 banner 交换都超时）⇒ 只能硬重启，且多半留下
//   半个 node_modules ⇒ 应用彻底起不来。2026-09-29 真实踩过一次。
//
// 为什么必须写成测试而不是只写文档：这条规则的**破坏方式**是"某个脚本被改回旧做法"
//   （旧 update.sh 就带一段"lockfile 变化就在服务器 npm ci"）。脚本改动 lint 和 tsc
//   都看不见，只有源码断言能拦。
//
// ★ 剥注释是**必需**的：deploy.sh / update.sh 的注释里正是那次事故的描述（"服务器跑
//   npm ci --omit=dev 把 IO 打满…"）。不剥的话这些用例会因为它们要禁止的东西而恒红。
//
// 非空转验证：Temp/nonvacuous_deploy_safety.py
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot } from './class-attrs'

const DEPLOY = 'scripts/deploy.sh'
const UPDATE = 'scripts/update.sh'
const START = 'scripts/start.sh'

function code(rel: string): string {
  return readFileSync(join(projectRoot, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*#.*$/gm, '') // shell 注释（事故描述就在里面，必须剥掉）
}

/**
 * 安装类命令的**动词部分**。
 * ★ 必须在 npm/npx 与动词之间留 60 字符的余量：真实写法常常夹着 flags 或包名 ——
 *   `npx --yes npm@11 ci`、`npm ci --no-audit`、`npm install --omit=dev`。
 *   写成 `\b(?:npm|npx)\s+(?:ci|install)\b`（紧邻）会**漏掉 npx 那一条**，而 npx 恰恰是
 *   最容易伪装成「只是跑个小命令」的入口（它还会先下载包，一样打满 IO）。
 * 动词只列这四种：`run` / `start` / `exec` 不在其列（它们不装依赖，不会打满 IO）。
 */
const INSTALL_VERB = String.raw`\b(?:npm|npx)\b[\s\S]{0,60}?\b(?:ci|install|update|add)\b`
/** 远程执行：`ssh <host> "... npm ci"`，ssh 与命令之间同样留余量（ssh 还带 -p/-i/-o 等参数） */
const REMOTE_INSTALL = new RegExp(String.raw`ssh[\s\S]{0,140}?` + INSTALL_VERB, 'i')
/** 任意安装类命令（用在**本身就在服务器上跑**的脚本里：连本地装都不许） */
const ANY_INSTALL = new RegExp(INSTALL_VERB, 'i')

describe('DNR · 线上绝不装依赖', () => {
  it('DNR0 解析自检：三个脚本都读到了预期锚（防断言空转）', () => {
    expect(code(DEPLOY), 'deploy.sh 里找不到 npm ci').toContain('npm ci')
    expect(code(DEPLOY), 'deploy.sh 里找不到 cd "$BUILD_DIR"').toContain('cd "$BUILD_DIR"')
    // update.sh 是**在服务器上执行**的解包脚本：它不该有任何 npm 安装命令，但必须有重启动作。
    // 锚点取 `PM2_BIN=` 而不是 `pm2 restart` —— 它走变量间接调用，字面量在别处拼出来
    expect(code(UPDATE), 'update.sh 里找不到 PM2_BIN（服务器重启入口）').toContain('PM2_BIN=/usr/bin/pm2')
  })

  it('DNR1 deploy.sh 的 npm ci 在本机构建目录里（不是服务器）', () => {
    const src = code(DEPLOY)
    const cdAt = src.indexOf('cd "$BUILD_DIR"')
    const ciAt = src.indexOf('npm ci')
    expect(cdAt, '找不到 cd "$BUILD_DIR"').toBeGreaterThanOrEqual(0)
    expect(ciAt, '找不到 npm ci').toBeGreaterThanOrEqual(0)
    // 顺序即语义：先切进本地构建目录，再装依赖 ⇒ 装的不是服务器上的东西
    expect(ciAt, 'npm ci 没在 cd "$BUILD_DIR" 之后 ⇒ 可能跑在服务器或项目根之外').toBeGreaterThan(cdAt)
  })

  it('DNR2 deploy.sh 不得把 npm 安装类命令交给 ssh 执行', () => {
    const m = code(DEPLOY).match(REMOTE_INSTALL)
    expect(m, `deploy.sh 里有经 ssh 执行的 npm 安装命令：${m?.[0]}`).toBeNull()
  })

  it('DNR3 update.sh（在服务器执行）不得含任何 npm 安装类命令', () => {
    const m = code(UPDATE).match(ANY_INSTALL)
    expect(m, `update.sh 里有 npm 安装命令：${m?.[0]}`).toBeNull()
  })

  it('DNR4 start.sh（在服务器执行）不得含任何 npm 安装类命令', () => {
    const m = code(START).match(ANY_INSTALL)
    expect(m, `start.sh 里有 npm 安装命令：${m?.[0]}`).toBeNull()
  })
})
