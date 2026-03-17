const path = require('path')
const { execSync } = require('child_process')
const fs = require('node:fs/promises')

function run (_cmd, _cwd){
    execSync(_cmd, { stdio: 'inherit', cwd: _cwd })
}

async function main (){
    const _root = path.resolve(__dirname, '..')
    const _dist = path.join(_root, 'dist')
    const _unpack = path.join(_dist, 'unpack')
    const _zipPath = path.join(_dist, 'dist.zip')

    try{
        await fs.access(_unpack)
    }catch{
        throw new Error('dist/unpack 不存在，请先运行 npm run build')
    }

    await fs.rm(_zipPath, { force: true })
    // 在 dist/unpack 内打包，zip 文件输出到 dist/dist.zip
    run(`zip -r "${_zipPath}" .`, _unpack)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})

