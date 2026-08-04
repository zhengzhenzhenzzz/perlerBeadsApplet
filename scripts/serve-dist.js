/**
 * 本地预览 dist 产物的简易静态服务器（支持 H5 browser 路由回退）
 * 用法：node scripts/serve-dist.js [port]
 */
const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = Number(process.argv[2]) || 10086
const ROOT = path.resolve(__dirname, '..', 'dist')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.map': 'application/json'
}

http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0])
  let filePath = path.join(ROOT, urlPath)
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // 静态资源路径不存在时直接返回 404，避免 SPA 回退掩盖资源缺失
      if (/\.(js|css|png|jpe?g|svg|ico|woff2?|ttf|eot|map|json)(\?.*)?$/i.test(urlPath)) {
        res.writeHead(404)
        res.end('Not Found')
        return
      }
      // SPA 路由回退
      filePath = path.join(ROOT, 'index.html')
    }
    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        res.writeHead(404)
        res.end('Not Found')
        return
      }
      const ext = path.extname(filePath).toLowerCase()
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
      res.end(data)
    })
  })
}).listen(PORT, () => {
  console.log(`dist preview running at http://localhost:${PORT}`)
})
