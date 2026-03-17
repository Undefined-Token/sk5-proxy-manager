const path = require('path')
const fs = require('node:fs/promises')
const esbuild = require('esbuild')

async function copyIfExists (_src, _dst){
    try{
        await fs.access(_src)
    }catch{
        return
    }
    await fs.cp(_src, _dst, { recursive: true, force: true, dereference: true })
}

async function main (){
    const _root = path.resolve(__dirname, '..')
    const _dist = path.join(_root, 'dist')
    const _unpack = path.join(_dist, 'unpack')

    await fs.rm(_dist, { recursive: true, force: true })
    await fs.mkdir(_unpack, { recursive: true })

    // 1) 打包为单文件 dist/unpack/server.js
    await esbuild.build({
        entryPoints: [path.join(_root, 'server.js')],
        outfile: path.join(_unpack, 'server.js'),
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: ['node18'],
        sourcemap: false,
        minify: true,
        legalComments: 'none',
        logLevel: 'info',
    })

    // 2) 复制运行时资源到 dist/unpack/（server.js 会用 __dirname 相对路径读取）
    await copyIfExists(path.join(_root, 'bin'), path.join(_unpack, 'bin'))
    await copyIfExists(path.join(_root, 'template.json'), path.join(_unpack, 'template.json'))
    await copyIfExists(path.join(_root, 'sumgr.html'), path.join(_unpack, 'sumgr.html'))

    // 构建产物不携带本地端口实例配置：创建空 config 目录
    await fs.mkdir(path.join(_unpack, 'config'), { recursive: true })

    // 构建产物不携带本地敏感配置：写入空的 proxies.json / sslconf.json
    await fs.writeFile(
        path.join(_unpack, 'proxies.json'),
        JSON.stringify({ providers: {}, enabled: [] }, null, 4)
    )
    await fs.writeFile(
        path.join(_unpack, 'sslconf.json'),
        JSON.stringify({ sni: null, cloudflare_key: null }, null, 4)
    )
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})

