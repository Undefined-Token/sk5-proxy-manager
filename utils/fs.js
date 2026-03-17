const fs = require('node:fs/promises')

async function pathExists (_p){
    try{
        await fs.access(_p)
        return true
    }catch{
        return false
    }
}

async function ensureDir (_dir){
    await fs.mkdir(_dir, { recursive: true })
}

async function removePath (_p){
    await fs.rm(_p, { recursive: true, force: true })
}

async function copyPath (_src, _dst, { dereference = true } = {}){
    await fs.cp(_src, _dst, { recursive: true, force: true, dereference })
}

module.exports = {
    fs,
    pathExists,
    ensureDir,
    removePath,
    copyPath,
}

