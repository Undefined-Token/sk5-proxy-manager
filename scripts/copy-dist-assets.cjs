const fs = require('node:fs/promises')
const path = require('path')

async function copyIfExists (_src, _dst){
    try{
        await fs.access(_src)
    }catch{
        return
    }
    await fs.cp(_src, _dst, { recursive: true, force: true, dereference: true })
}

async function main (){
    const _root = __dirname ? path.resolve(__dirname, '..') : process.cwd()
    const _dist = path.join(_root, 'dist')

    await fs.mkdir(_dist, { recursive: true })

    // 运行所需资源：按现有 server.js 逻辑使用 __dirname 相对路径
    await copyIfExists(path.join(_root, 'bin'), path.join(_dist, 'bin'))
    await copyIfExists(path.join(_root, 'config'), path.join(_dist, 'config'))

    await copyIfExists(path.join(_root, 'template.json'), path.join(_dist, 'template.json'))
    await copyIfExists(path.join(_root, 'proxies.json'), path.join(_dist, 'proxies.json'))
    await copyIfExists(path.join(_root, 'sslconf.json'), path.join(_dist, 'sslconf.json'))
    await copyIfExists(path.join(_root, 'sumgr.html'), path.join(_dist, 'sumgr.html'))

    // 运行时依赖的本地模块（若未被打包进 dist/server.js）
    await copyIfExists(path.join(_root, 'utils', 'logger.js'), path.join(_dist, 'utils', 'logger.js'))
    await copyIfExists(path.join(_root, 'utils', 'process.js'), path.join(_dist, 'utils', 'process.js'))
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})

