const path = require('path')
const { fs } = require('./fs')

function getCliArgValue (_key){
    const _argv = process.argv || []
    const _idx = _argv.indexOf(_key)
    if( _idx >= 0 ){
        return _argv[_idx + 1] || ''
    }
    const _prefix = `${_key}=`
    const _hit = _argv.find(_a => typeof _a === 'string' && _a.startsWith(_prefix))
    return _hit ? _hit.slice(_prefix.length) : ''
}

function randomString (_len = 8){
    // base36: [0-9a-z]
    const _raw = Math.random().toString(36).slice(2)
    return _raw.slice(0, Math.max(1, _len))
}

function normalizeCountry (_country){
    const _c = (_country || '').toString().trim()
    return _c ? _c.toLowerCase() : 'us'
}

function renderMagicVars (_tpl, _vars){
    if( typeof _tpl !== 'string' ){
        return _tpl
    }
    return _tpl
        .replaceAll('${country}', _vars.country)
        .replaceAll('${session}', _vars.session)
}

// 校验并规范化 SNI：主域名（不含子域名）、不带协议
function normalizeSNIDomain (_input){
    if( typeof _input !== 'string' || !_input ){
        return null
    }
    let _s = _input.trim().toLowerCase()
    _s = _s.replace(/^https?:\/\//i, '').replace(/\/.*$/, '')
    const _firstSlash = _s.indexOf('/')
    if( _firstSlash >= 0 ){
        _s = _s.slice(0, _firstSlash)
    }
    _s = _s.replace(/:\d+$/, '')
    if( !_s ){
        return null
    }
    const _parts = _s.split('.')
    if( _parts.length !== 2 || !_parts[0] || !_parts[1] ){
        return null
    }
    const _ok = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i
    if( !_ok.test(_parts[0]) || !_ok.test(_parts[1]) ){
        return null
    }
    return `${_parts[0]}.${_parts[1]}`
}

async function getCertStatus (_baseDir){
    const _certPath = path.join(_baseDir, 'bin', 'cert.crt')
    const _keyPath = path.join(_baseDir, 'bin', 'key.key')
    try{
        const _certStat = await fs.stat(_certPath).catch(() => null)
        const _keyStat = await fs.stat(_keyPath).catch(() => null)
        const _certReady = !!(_certStat?.isFile?.() && _certStat.size > 0)
        const _keyReady = !!(_keyStat?.isFile?.() && _keyStat.size > 0)
        return { cert_ready: _certReady, key_ready: _keyReady, ready: _certReady && _keyReady }
    }catch{
        return { cert_ready: false, key_ready: false, ready: false }
    }
}

module.exports = {
    getCliArgValue,
    randomString,
    normalizeCountry,
    renderMagicVars,
    normalizeSNIDomain,
    getCertStatus,
}

