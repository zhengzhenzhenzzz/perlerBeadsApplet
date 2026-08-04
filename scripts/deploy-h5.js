/**
 * H5 生产部署脚本：构建 -> 上传 -> 原子切换 -> 校验
 *
 * 用法：
 *   node scripts/deploy-h5.js                 完整部署
 *   node scripts/deploy-h5.js --skip-build    复用现有 dist（不重新构建）
 *   node scripts/deploy-h5.js --dry-run       只做预检和构建，不改动服务器
 *   node scripts/deploy-h5.js --yes           跳过发布前确认
 *   node scripts/deploy-h5.js --rollback      回滚到服务器上最近一次备份
 *   node scripts/deploy-h5.js --list-backups  查看服务器上的备份
 *   node scripts/deploy-h5.js --print-config  查看当前配置（敏感值脱敏）
 *
 * 配置：
 *   服务器地址、域名、路径等均不写入源码，从 .env.deploy 读取（该文件已被 git 忽略）。
 *   首次使用：cp .env.deploy.example .env.deploy 并填写实际值。
 *   也可用同名环境变量覆盖，便于 CI 注入 secrets。
 *
 * 设计要点：
 * - 产物先传到临时目录校验通过后再 mv 替换，避免半更新状态被用户访问到
 * - 每次替换前打包备份旧 webroot，失败可用 --rollback 快速回退
 * - 全量替换而非增量覆盖，防止历史构建残留文件与新产物样式冲突
 */
const { spawnSync } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const https = require('https')
const os = require('os')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const ENV_FILE = path.join(ROOT, '.env.deploy')
const ARGV = process.argv.slice(2)
const has = (flag) => ARGV.includes(flag)

// ---- 输出 ----
const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', b: '\x1b[36m', d: '\x1b[2m', x: '\x1b[0m' }
let step = 0
const head = (m) => console.log(`\n${C.b}[${++step}] ${m}${C.x}`)
const ok = (m) => console.log(`  ${C.g}✓${C.x} ${m}`)
const warn = (m) => console.log(`  ${C.y}!${C.x} ${m}`)
const info = (m) => console.log(`  ${C.d}${m}${C.x}`)
const die = (m) => { console.error(`\n${C.r}✗ ${m}${C.x}\n`); process.exit(1) }

// ---- 配置加载 ----
/** 解析 .env 格式：KEY=VALUE，支持 # 注释、引号包裹与行尾空白 */
function parseEnvFile (file) {
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    // 去掉成对引号，保留值内部的空格
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (key) out[key] = val
  }
  return out
}

// 真实环境变量优先于文件，便于 CI 用 secrets 覆盖而无需落盘
const FILE_ENV = parseEnvFile(ENV_FILE)
const readEnv = (key) => {
  const v = process.env[key] !== undefined && process.env[key] !== '' ? process.env[key] : FILE_ENV[key]
  return typeof v === 'string' ? v.trim() : v
}

/** 必填项缺失时一次性列出全部问题，而不是逐个报错 */
function loadConfig () {
  const REQUIRED = {
    DEPLOY_HOST: '服务器地址（IP 或主机名）',
    DEPLOY_USER: 'SSH 登录用户名',
    DEPLOY_WEBROOT: '服务器上的站点根目录，如 /var/www/yoursite',
    DEPLOY_DOMAIN: '站点域名，用于线上验证'
  }
  const missing = Object.entries(REQUIRED).filter(([k]) => !readEnv(k))
  if (missing.length) {
    console.error(`\n${C.r}✗ 部署配置缺失${C.x}`)
    missing.forEach(([k, desc]) => console.error(`  ${C.r}·${C.x} ${k} —— ${desc}`))
    console.error(`\n${C.y}请在 ${path.relative(ROOT, ENV_FILE)} 中配置，或通过环境变量传入。${C.x}`)
    if (!fs.existsSync(ENV_FILE)) {
      console.error(`${C.d}该文件不存在，可从模板创建：${C.x}`)
      console.error(`${C.d}  cp .env.deploy.example .env.deploy${C.x}`)
    }
    console.error('')
    process.exit(1)
  }

  // SSH 私钥：未指定时交给 ssh 用默认身份（~/.ssh/id_* 或 agent）
  const rawKey = readEnv('DEPLOY_SSH_KEY')
  let key = null
  if (rawKey) {
    // 支持 ~ 开头的路径，直接传给 ssh 不会被展开
    key = rawKey.startsWith('~') ? path.join(os.homedir(), rawKey.slice(1)) : path.resolve(ROOT, rawKey)
    // 只回显文件名：这里脱敏尚未就绪，避免完整路径进入 CI 日志
    if (!fs.existsSync(key)) die(`DEPLOY_SSH_KEY 指向的私钥不存在：…/${path.basename(key)}`)
  }

  const port = readEnv('DEPLOY_PORT') || '22'
  if (!/^\d+$/.test(port)) die(`DEPLOY_PORT 必须是数字，当前为 "${port}"`)

  const keep = readEnv('DEPLOY_KEEP_BACKUPS') || '5'
  if (!/^\d+$/.test(keep) || Number(keep) < 1) die(`DEPLOY_KEEP_BACKUPS 必须是不小于 1 的整数，当前为 "${keep}"`)

  const webroot = readEnv('DEPLOY_WEBROOT')
  if (!webroot.startsWith('/') || webroot === '/') die(`DEPLOY_WEBROOT 必须是绝对路径且不能为根目录，当前为 "${webroot}"`)

  return {
    host: readEnv('DEPLOY_HOST'),
    user: readEnv('DEPLOY_USER'),
    key,
    port,
    webroot: webroot.replace(/\/+$/, ''),
    domain: readEnv('DEPLOY_DOMAIN').replace(/^https?:\/\//, '').replace(/\/+$/, ''),
    // 备份目录与站点名解耦，默认放在登录用户家目录下
    backupDir: readEnv('DEPLOY_BACKUP_DIR') || '~/deploy_backups',
    // 备份文件名前缀，避免暴露站点标识；默认取 webroot 末段
    backupPrefix: readEnv('DEPLOY_BACKUP_PREFIX') || path.posix.basename(webroot),
    // SPA 深链接探测路径，用于验证 try_files 回退
    spaProbe: readEnv('DEPLOY_SPA_PROBE') || '/pages/editor/index',
    keepBackups: Number(keep)
  }
}

const CFG = loadConfig()
const REMOTE = `${CFG.user}@${CFG.host}`
const SITE = `https://${CFG.domain}`

/** 日志脱敏：把配置里的敏感值替换为占位符，避免 CI 日志泄露 */
function mask (text) {
  if (!text) return text
  let out = String(text)
  // 先替换长串，避免短串（如用户名）先命中后割裂长串（如私钥路径）
  const secrets = [
    [CFG.key, '<SSH_KEY>'],
    [CFG.webroot, '<WEBROOT>'],
    [CFG.domain, '<DOMAIN>'],
    [CFG.host, '<HOST>'],
    [CFG.backupPrefix, '<SITE>'],
    [CFG.user, '<USER>']
  ].filter(([v]) => v).sort((a, b) => String(b[0]).length - String(a[0]).length)
  for (const [value, placeholder] of secrets) {
    out = out.split(String(value)).join(placeholder)
  }
  return out
}

// 未显式要求明文时，输出统一脱敏，避免 IP/域名/用户名进入日志或截图
const SHOW_SECRETS = has('--show-secrets') || readEnv('DEPLOY_SHOW_SECRETS') === '1'
const s = (text) => (SHOW_SECRETS ? String(text) : mask(text))

// ---- 命令封装 ----
function run (cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts })
  // 超时被杀时 spawnSync 把 ETIMEDOUT 放在 error 里，status 为 null；
  // 调用方按 status 判断即可，故转成非零退出而不抛出
  if (r.error && r.error.code === 'ETIMEDOUT') return { ...r, status: 124, stdout: r.stdout || '', stderr: `命令超时：${cmd}` }
  if (r.error) throw r.error
  return r
}

function mustRun (cmd, args, msg, opts = {}) {
  const r = run(cmd, args, opts)
  if (r.status !== 0) {
    if (r.stdout) console.error(s(r.stdout.trim()))
    if (r.stderr) console.error(s(r.stderr.trim()))
    die(msg)
  }
  return (r.stdout || '').trim()
}

const SSH_OPTS = [
  ...(CFG.key ? ['-i', CFG.key] : []),
  '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=15',
  '-o', 'StrictHostKeyChecking=accept-new'
]
// ssh 用 -p，scp 用 -P
const SSH_PORT = ['-p', CFG.port]
const SCP_PORT = ['-P', CFG.port]

/** 在服务器上执行脚本：经 stdin 传入，规避多层引号转义 */
function ssh (script, { check = true, label = '远程命令执行失败' } = {}) {
  const r = run('ssh', [...SSH_OPTS, ...SSH_PORT, REMOTE, 'bash -s'], { input: `set -euo pipefail\n${script}` })
  if (check && r.status !== 0) {
    if (r.stdout) console.error(s(r.stdout.trim()))
    if (r.stderr) console.error(s(r.stderr.trim()))
    die(label)
  }
  return { out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), status: r.status }
}

/** 递归列出目录下所有文件，返回相对 POSIX 路径（已排序） */
function listFiles (dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    return e.isDirectory()
      ? listFiles(full, base)
      : [path.relative(base, full).split(path.sep).join('/')]
  }).sort()
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

/** HTTPS GET，返回 { code, body, headers } */
function httpsGet (url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 30000 }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ code: res.statusCode, body: Buffer.concat(chunks), headers: res.headers }))
    })
    req.on('timeout', () => req.destroy(new Error('请求超时')))
    req.on('error', reject)
  })
}

// ---- 备份管理 ----
async function listBackups () {
  const { out } = ssh(`ls -1t ${CFG.backupDir}/*.tar.gz 2>/dev/null || true`)
  return out ? out.split('\n').filter(Boolean) : []
}

async function cmdListBackups () {
  const backups = await listBackups()
  if (!backups.length) return console.log('\n服务器上暂无备份\n')
  console.log('\n服务器备份（按时间倒序）：')
  const { out } = ssh(`ls -lht ${CFG.backupDir}/*.tar.gz 2>/dev/null | head -20 || true`)
  console.log(s(out) + '\n')
}

async function cmdRollback () {
  head('查找可用备份')
  const backups = await listBackups()
  if (!backups.length) die('服务器上没有任何备份，无法回滚')
  const latest = backups[0]
  ok(`将回滚到：${s(path.posix.basename(latest))}`)
  if (backups.length > 1) info(`（另有 ${backups.length - 1} 个更早的备份，如需指定请手动解包）`)

  if (!has('--yes') && !(await confirm('确认回滚？此操作会覆盖当前线上产物'))) return console.log('\n已取消\n')

  head('回滚')
  ssh(`
    TMP=$(mktemp -d)
    tar xzf "${latest}" -C "$TMP"
    # 备份包内含一层顶层目录（打包时的 webroot 目录名）
    SRC="$TMP/$(ls "$TMP" | head -1)"
    [ -d "$SRC" ] || { echo "备份结构异常"; exit 1; }
    sudo rm -rf ${CFG.webroot}.rollback-tmp
    sudo mv "$SRC" ${CFG.webroot}.rollback-tmp
    sudo rm -rf ${CFG.webroot}
    sudo mv ${CFG.webroot}.rollback-tmp ${CFG.webroot}
    sudo chown -R ${CFG.user}:${CFG.user} ${CFG.webroot}
    sudo find ${CFG.webroot} -type d -exec chmod 755 {} \\;
    sudo find ${CFG.webroot} -type f -exec chmod 644 {} \\;
    rm -rf "$TMP"
    sudo systemctl reload nginx
  `, { label: '回滚失败' })
  ok('回滚完成，nginx 已 reload')

  head('验证')
  await verifySite()
  console.log(`\n${C.g}回滚完成${C.x} → ${s(SITE)}/\n`)
}

function confirm (question) {
  return new Promise((resolve) => {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout })
    rl.question(`\n${C.y}${question} [y/N] ${C.x}`, (a) => {
      rl.close()
      resolve(/^y(es)?$/i.test(a.trim()))
    })
  })
}

// ---- 站点验证 ----
async function verifySite () {
  const home = await httpsGet(`${SITE}/`)
  if (home.code !== 200) die(`首页返回 HTTP ${home.code}`)
  const html = home.body.toString('utf8')
  ok(`首页 HTTP 200（${home.body.length} 字节）`)

  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1]
  if (title) ok(`页面标题：${title}`)

  // index.html 引用的每个 JS/CSS 都必须可访问，否则页面白屏
  const assets = [...new Set(html.match(/\/(?:js|css)\/[A-Za-z0-9._-]+/g) || [])]
  if (!assets.length) warn('未从 index.html 解析出资源引用')
  for (const a of assets) {
    const r = await httpsGet(SITE + a)
    if (r.code !== 200) die(`资源 ${a} 返回 HTTP ${r.code}`)
    ok(`${a} → 200（${r.body.length} 字节）`)
  }

  // SPA 路由回退：深链接应由 index.html 兜底而非 404
  const spa = await httpsGet(SITE + CFG.spaProbe)
  spa.code === 200 ? ok('SPA 路由回退正常') : warn(`SPA 深链接返回 HTTP ${spa.code}`)
  return html
}

// ---- 主流程 ----
/** 打印当前生效配置，便于排查「配置从哪来」；默认脱敏 */
function cmdPrintConfig () {
  const src = (k) => (process.env[k] ? '环境变量' : FILE_ENV[k] ? '.env.deploy' : '默认值')
  console.log('\n当前部署配置：')
  const rows = [
    ['DEPLOY_HOST', CFG.host],
    ['DEPLOY_USER', CFG.user],
    ['DEPLOY_PORT', CFG.port],
    ['DEPLOY_WEBROOT', CFG.webroot],
    ['DEPLOY_DOMAIN', CFG.domain],
    ['DEPLOY_SSH_KEY', CFG.key || '(使用 ssh 默认身份)'],
    ['DEPLOY_BACKUP_DIR', CFG.backupDir],
    ['DEPLOY_BACKUP_PREFIX', CFG.backupPrefix],
    ['DEPLOY_SPA_PROBE', CFG.spaProbe],
    ['DEPLOY_KEEP_BACKUPS', String(CFG.keepBackups)]
  ]
  for (const [k, v] of rows) console.log(`  ${k.padEnd(21)} ${s(v)}  ${C.d}[${src(k)}]${C.x}`)
  if (!SHOW_SECRETS) console.log(`\n${C.d}敏感值已脱敏，如需明文：--show-secrets${C.x}`)
  console.log('')
}

async function main () {
  if (has('--print-config')) return cmdPrintConfig()
  if (has('--list-backups')) return cmdListBackups()
  if (has('--rollback')) return cmdRollback()

  const dryRun = has('--dry-run')
  console.log(`\n${C.b}部署 H5 到 ${s(CFG.domain)}${C.x}`)
  info(`服务器 ${s(REMOTE)}:${s(CFG.webroot)}`)
  if (dryRun) warn('--dry-run：只构建与预检，不会改动服务器')

  // 1. Git 预检
  head('Git 预检')
  let sha = '(非 git 仓库)'
  try {
    const branch = mustRun('git', ['rev-parse', '--abbrev-ref', 'HEAD'], 'git 分支读取失败', { cwd: ROOT })
    sha = mustRun('git', ['log', '-1', '--format=%h %s'], 'git 日志读取失败', { cwd: ROOT })
    ok(`分支 ${branch} @ ${sha}`)

    const dirty = run('git', ['status', '--porcelain'], { cwd: ROOT }).stdout.trim()
    if (dirty) {
      warn(`有 ${dirty.split('\n').length} 处未提交改动，将按当前工作区内容构建`)
      info(dirty.split('\n').slice(0, 5).join('\n  '))
    } else ok('工作区干净')

    // 落后远端是上次部署到旧版本的根因，这里显式拦截。
    // fetch 走网络，加超时并禁用凭证交互，避免无网或需登录时卡死整个部署
    const fetched = run('git', ['fetch', '--quiet'], {
      cwd: ROOT,
      timeout: 20000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo', SSH_ASKPASS: 'echo' }
    })
    if (fetched.status !== 0) {
      warn('无法拉取远端信息（网络不通或需要认证），跳过「是否落后远端」检查')
      info('请自行确认当前代码为最新版本')
    }
    const upstream = run('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd: ROOT })
    if (upstream.status === 0 && fetched.status === 0) {
      const remoteBranch = upstream.stdout.trim()
      const behind = run('git', ['rev-list', '--count', `HEAD..${remoteBranch}`], { cwd: ROOT }).stdout.trim()
      const ahead = run('git', ['rev-list', '--count', `${remoteBranch}..HEAD`], { cwd: ROOT }).stdout.trim()
      if (behind !== '0') {
        warn(`本地落后 ${remoteBranch} ${behind} 个提交 —— 可能不是最新版本`)
        info(`如需同步：git merge --ff-only ${remoteBranch}`)
        if (!has('--yes') && !dryRun && !(await confirm('仍要用当前代码部署？'))) return console.log('\n已取消\n')
      } else if (ahead !== '0') {
        ok(`与 ${remoteBranch} 同步（本地领先 ${ahead} 个未推送提交）`)
      } else ok(`与 ${remoteBranch} 一致`)
    }
  } catch (e) {
    warn(`跳过 git 预检：${e.message}`)
  }

  // 2. 构建
  if (has('--skip-build')) {
    head('跳过构建')
    if (!fs.existsSync(path.join(DIST, 'index.html'))) die('dist/index.html 不存在，无法 --skip-build')
    warn('复用现有 dist，请确认它由最新代码构建')
  } else {
    head('构建 H5 生产产物')
    // 清空重建：Taro 的 outputRoot 非默认路径时旧产物可能残留
    fs.rmSync(DIST, { recursive: true, force: true })
    info('已清空 dist，开始构建（约需 1 分钟）…')
    // 直接跑 Taro CLI 的 JS 入口：新版 Node 禁止无 shell 地 spawn .cmd，绕开 npm 包装更稳
    const taroBin = path.join(ROOT, 'node_modules', '@tarojs', 'cli', 'bin', 'taro')
    if (!fs.existsSync(taroBin)) die('未找到 @tarojs/cli，请先安装依赖')
    const r = run(process.execPath, [taroBin, 'build', '--type', 'h5'], { cwd: ROOT, stdio: 'inherit' })
    if (r.status !== 0) die('构建失败')
    ok('构建完成')
  }

  // 3. 产物校验
  head('校验本地产物')
  const indexPath = path.join(DIST, 'index.html')
  if (!fs.existsSync(indexPath)) die('构建产物缺少 index.html')
  const localHtml = fs.readFileSync(indexPath, 'utf8')
  const files = listFiles(DIST)
  const bytes = files.reduce((s, f) => s + fs.statSync(path.join(DIST, f)).size, 0)
  ok(`${files.length} 个文件，共 ${(bytes / 1024 / 1024).toFixed(2)} MB`)

  const refs = [...new Set(localHtml.match(/\/(?:js|css)\/[A-Za-z0-9._-]+/g) || [])]
  for (const ref of refs) {
    if (!fs.existsSync(path.join(DIST, ref.replace(/^\//, '')))) die(`index.html 引用的 ${ref} 在产物中不存在`)
  }
  ok(`index.html 引用的 ${refs.length} 个资源均存在`)
  const title = (localHtml.match(/<title>([^<]*)<\/title>/) || [])[1]
  if (title) info(`页面标题：${title}`)

  if (dryRun) return console.log(`\n${C.y}--dry-run 结束，服务器未改动${C.x}\n`)

  if (!has('--yes') && !(await confirm(`确认发布到 ${s(SITE)}/ ？`))) return console.log('\n已取消\n')

  // 4. 打包上传
  head('打包并上传')
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const tarName = `h5-deploy-${stamp}.tar.gz`
  // 输出到项目根并用相对路径调用：GNU tar 会把 "C:\..." 里的冒号当成远程主机分隔符
  const tarball = path.join(ROOT, tarName)
  mustRun('tar', ['czf', tarName, '-C', 'dist', '.'], '打包失败', { cwd: ROOT })
  ok(`打包完成（${(fs.statSync(tarball).size / 1024).toFixed(0)} KB）`)

  const remoteTar = `/tmp/${tarName}`
  try {
    mustRun('scp', [...SSH_OPTS, ...SCP_PORT, tarName, `${REMOTE}:${remoteTar}`], '上传失败', { cwd: ROOT })
    ok('上传完成')
  } finally {
    fs.rmSync(tarball, { force: true })
  }

  // 5. 远端备份 + 解包 + 原子切换
  head('服务器端部署')
  const staging = `/tmp/h5-staging-${stamp}`
  const backupFile = `${CFG.backupDir}/${CFG.backupPrefix}-${stamp}.tar.gz`
  const { out } = ssh(`
    mkdir -p ${CFG.backupDir}
    # 备份现网产物，回滚依赖它
    if [ -d "${CFG.webroot}" ]; then
      sudo tar czf ${backupFile} -C "$(dirname ${CFG.webroot})" "$(basename ${CFG.webroot})"
      sudo chown ${CFG.user}:${CFG.user} ${backupFile}
      echo "BACKUP $(basename ${backupFile})"
    else
      echo "BACKUP (无现有产物，跳过)"
    fi

    rm -rf ${staging} && mkdir -p ${staging}
    tar xzf ${remoteTar} -C ${staging}
    [ -f ${staging}/index.html ] || { echo "解包后缺少 index.html"; exit 1; }

    # 切换前确认引用资源齐全，避免线上白屏
    cd ${staging}
    for f in $(grep -oE "/(js|css)/[A-Za-z0-9._-]+" index.html | sort -u); do
      [ -f ".$f" ] || { echo "缺少资源 $f"; exit 1; }
    done

    find ${staging} -type d -exec chmod 755 {} \\;
    find ${staging} -type f -exec chmod 644 {} \\;

    # 原子替换：mv 是瞬时的，用户不会看到半更新状态
    sudo rm -rf ${CFG.webroot}.old
    [ -d "${CFG.webroot}" ] && sudo mv ${CFG.webroot} ${CFG.webroot}.old
    sudo mv ${staging} ${CFG.webroot}
    sudo chown -R ${CFG.user}:${CFG.user} ${CFG.webroot}
    rm -f ${remoteTar}

    sudo nginx -t 2>&1 | tail -1
    sudo systemctl reload nginx
    echo "DEPLOYED $(find ${CFG.webroot} -type f | wc -l) files"

    # 只保留最近若干份备份
    ls -1t ${CFG.backupDir}/*.tar.gz 2>/dev/null | tail -n +$((${CFG.keepBackups} + 1)) | xargs -r rm -f
  `, { label: '服务器端部署失败' })
  out.split('\n').forEach((l) => l.trim() && ok(s(l.trim())))

  // 6. 逐文件比对，确认服务器内容与本地字节一致
  head('校验服务器文件一致性')
  const remoteSums = ssh(`cd ${CFG.webroot} && find . -type f | sort | xargs sha256sum`).out
  const remoteMap = new Map(
    remoteSums.split('\n').filter(Boolean).map((line) => {
      const [hash, ...rest] = line.trim().split(/\s+/)
      return [rest.join(' ').replace(/^\.\//, ''), hash]
    })
  )
  const mismatched = []
  for (const f of files) {
    const remoteHash = remoteMap.get(f)
    if (!remoteHash) mismatched.push(`${f}（服务器缺失）`)
    else if (remoteHash !== sha256(path.join(DIST, f))) mismatched.push(`${f}（内容不同）`)
  }
  const extra = [...remoteMap.keys()].filter((f) => !files.includes(f))
  if (mismatched.length) {
    mismatched.forEach((m) => console.error(`  ${C.r}✗${C.x} ${m}`))
    die('服务器文件与本地产物不一致')
  }
  if (extra.length) warn(`服务器多出 ${extra.length} 个文件：${extra.slice(0, 5).join(', ')}`)
  ok(`${files.length} 个文件校验和逐一相同`)

  // 7. 线上验证
  head('线上验证')
  const liveHtml = await verifySite()
  if (liveHtml.trim() !== localHtml.trim()) warn('线上 index.html 与本地不同（可能是 CDN 或缓存）')
  else ok('线上 index.html 与本地一致')

  // 8. 收尾
  head('清理')
  ssh(`sudo rm -rf ${CFG.webroot}.old`)
  ok(`已移除旧产物目录（备份仍保留在 ${s(CFG.backupDir)}）`)

  console.log(`\n${C.g}部署成功${C.x} → ${s(SITE)}/`)
  info(`版本 ${sha}`)
  info(`回滚：node scripts/deploy-h5.js --rollback\n`)
}

main().catch((e) => die(s(e.stack || e.message)))
