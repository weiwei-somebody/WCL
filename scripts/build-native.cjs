// 编译 WCL 桌面原生助手与游戏内 jar 到 out/main。
// C# 助手随包分发用于 DWM 材质修复与 QuickPlay 游戏窗口聚焦；
// 两个 jar 随包分发用于桥接 MOD 与离线皮肤。
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const outMain = path.join(root, 'out/main')

const run = (file, args) => execFileSync(file, args, { stdio: 'inherit', windowsHide: true })
const javaTool = (name) => process.env.JAVA_HOME
  ? path.join(process.env.JAVA_HOME, 'bin', name + (process.platform === 'win32' ? '.exe' : ''))
  : name

function compileNativeHelpers() {
  if (process.platform !== 'win32') {
    console.log('跳过 C# 原生助手：仅 Windows 需要')
    return
  }
  const compiler = path.join(process.env.SystemRoot || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
  if (!fs.existsSync(compiler)) throw new Error(`找不到 C# 编译器：${compiler}`)
  fs.mkdirSync(outMain, { recursive: true })
  for (const name of ['WindowMaterial', 'GameWindowFocus']) {
    const output = path.join(outMain, `${name}.exe`)
    run(compiler, ['/nologo', '/target:exe', '/platform:anycpu', '/optimize+', `/out:${output}`, path.join(root, `native/${name}.cs`)])
    console.log(`已编译 ${name}.exe`)
  }
}

function buildOfflineSkinAgent() {
  const project = path.join(root, 'offline-skin-agent')
  const classes = path.join(project, 'build/classes')
  if (!classes.startsWith(project + path.sep)) throw new Error('离线皮肤构建输出路径非法')
  fs.rmSync(classes, { recursive: true, force: true })
  fs.mkdirSync(classes, { recursive: true })
  run(javaTool('javac'), ['-encoding', 'UTF-8', '--release', '8', '-d', classes, path.join(project, 'src/cn/wcl/skin/OfflineSkinAgent.java')])
  const manifest = path.join(project, 'build/MANIFEST.MF')
  fs.mkdirSync(path.dirname(manifest), { recursive: true })
  fs.writeFileSync(manifest, 'Manifest-Version: 1.0\nPremain-Class: cn.wcl.skin.OfflineSkinAgent\nCan-Redefine-Classes: false\nCan-Retransform-Classes: false\n\n')
  fs.mkdirSync(outMain, { recursive: true })
  const output = path.join(outMain, 'wcl-offline-skin.jar')
  run(javaTool('jar'), ['cfm', output, manifest, '-C', classes, '.'])
  console.log('已构建 wcl-offline-skin.jar')
}

const bridgeDependencies = [
  {
    file: 'net/fabricmc/fabric-loader/0.19.5/fabric-loader-0.19.5.jar',
    bases: ['https://maven.fabricmc.net/'],
    hash: '93044e4dd46de5d8136701292f05e868da096d2c9fddb4793e4fdbcc63efc695'
  },
  {
    file: 'com/google/code/gson/gson/2.14.0/gson-2.14.0.jar',
    bases: ['https://maven.aliyun.com/repository/public/', 'https://repo.maven.apache.org/maven2/'],
    hash: '2cbd119bf1961c28788310963dc80ba65f58cdeec1dd139c8bdb1240faa2c36f'
  }
]

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

async function fetchDependency(dependency, cache) {
  fs.mkdirSync(path.dirname(cache), { recursive: true })
  if (fs.existsSync(cache) && sha256(cache) === dependency.hash) return cache
  for (const base of dependency.bases) {
    try {
      const response = await fetch(base + dependency.file)
      if (!response.ok) { console.warn(`构建依赖 HTTP ${response.status}：${base}`); continue }
      const data = Buffer.from(await response.arrayBuffer())
      if (crypto.createHash('sha256').update(data).digest('hex') !== dependency.hash) {
        console.warn(`构建依赖校验和不符：${base}`); continue
      }
      fs.writeFileSync(cache, data)
      return cache
    } catch (error) {
      console.warn(`构建依赖下载失败：${base} ${error.message}`)
    }
  }
  throw new Error(`无法获取构建依赖 ${path.basename(dependency.file)}`)
}

async function buildBridge() {
  const bridge = path.join(root, 'bridge')
  const classes = path.join(bridge, 'build/classes')
  if (!classes.startsWith(bridge + path.sep)) throw new Error('桥接构建输出路径非法')
  const classpath = []
  for (const dependency of bridgeDependencies) {
    classpath.push(await fetchDependency(dependency, path.join(bridge, '.cache', path.basename(dependency.file))))
  }
  fs.rmSync(classes, { recursive: true, force: true })
  fs.mkdirSync(classes, { recursive: true })
  const sources = []
  const scan = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) scan(file)
      else if (file.endsWith('.java')) sources.push(file)
    }
  }
  scan(path.join(bridge, 'src/cn'))
  run(javaTool('javac'), ['-encoding', 'UTF-8', '--release', '17', '-cp', classpath.join(path.delimiter), '-d', classes, ...sources])
  fs.copyFileSync(path.join(bridge, 'src/fabric.mod.json'), path.join(classes, 'fabric.mod.json'))
  fs.mkdirSync(outMain, { recursive: true })
  run(javaTool('jar'), ['cf', path.join(outMain, 'wcl-bridge.jar'), '-C', classes, '.'])
  console.log('已构建 wcl-bridge.jar')
}

async function main() {
  compileNativeHelpers()
  buildOfflineSkinAgent()
  await buildBridge()
  console.log('原生助手与游戏内 jar 已全部就绪')
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
