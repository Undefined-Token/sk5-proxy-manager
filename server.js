const express = require('express')
const app = express()
const fs = require('node:fs/promises')
const path = require('path')
const logger = require('./utils/logger')
const { startProcess, stopProcess, restartProcess } = require('./utils/process')
const { applyCert } = require('./utils/cert')
const {
    getCliArgValue,
    randomString,
    normalizeCountry,
    renderMagicVars,
    normalizeSNIDomain,
    getCertStatus: getCertStatusUtil,
} = require('./utils')
const { pathExists, ensureDir } = require('./utils/fs')

const httpServerPort = parseInt(getCliArgValue('--port') || '', 10) || 10240

const webAuth = (getCliArgValue('--password') || '').trim()
if( !webAuth ){
    logger.error('启动参数缺失：请使用 node server.js --password <密码> 启动')
    process.exit(1)
}

function isAuthed (_request){
    const _auth = (_request.query && _request.query.auth) || _request.headers['x-auth'] || ''
    return typeof _auth === 'string' && _auth === webAuth
}

function requireAuth (_request, _response){
    if( isAuthed(_request) ){
        return true
    }
    _response.status(403).json({ code: 403, error: 'Forbidden' })
    return false
}

async function listInstancesFromConfigDir (){
    const _files = await fs.readdir('./config')
    const _build = []
    for( const _file of _files ){
        try{
            _build.push(JSON.parse(await fs.readFile(`./config/${_file}`, 'UTF-8')))
        }catch(_e){}
    }
    return _build
}

async function createInstanceFromParams (_params){
    const _certStatus = await getCertStatus()
    if( !_certStatus.ready ){
        throw new Error('尚未申请/配置证书，请先在「SNI 配置」中申请证书')
    }

    if( !Object.keys(sk5proxys || {}).length ){
        await loadProxiesConfig()
    }
    if( !Object.keys(sk5proxys || {}).length ){
        throw new Error('尚未添加任何 SK5 提供商，请先在「SK5 提供商」中添加并启用')
    }

    if( !sk5proxys[_params.proxy_name] ){
        await loadProxiesConfig()
        if( !sk5proxys[_params.proxy_name] ){
            throw new Error('未适配的IP提供商')
        }
    }

    const _sslconf = await readSslconf()
    const _sniTrim = (_params.sni || '').trim()
    if( !_sniTrim ){
        throw new Error('SNI 不能为空')
    }
    if( !_sslconf.sni ){
        throw new Error('尚未配置 SNI，请先在「SNI 配置」中设置主域名（sslconf.json）')
    }
    const _normalized = normalizeSNIDomain(_params.sni)
    if( !_normalized || _normalized !== normalizeSNIDomain(_sslconf.sni) ){
        throw new Error('当前 SNI 须与已配置的主域名一致，且为主域名（不含子域名、不带协议）')
    }

    const _randPrefix = Math.random().toString(36).slice(2, 10)
    const _finalSni = `${_randPrefix}.${_sslconf.sni}`

    const _template = JSON.parse(await fs.readFile('./template.json', 'UTF-8'))
    _template.local_port = parseInt(_params.port)
    _template.password = [ _params.passwd ]
    _template.ssl ||= {}
    _template.ssl.sni = _finalSni
    _template.meta_data = {
        port: _template.local_port,
        passwd: _params.passwd,
        sni: _finalSni,
        proxy_name: _params.proxy_name,
        country: 'us',
    }
    _template.forward_proxy = await buildForwardProxy(
        _template.meta_data.proxy_name,
        _template.meta_data.country
    )

    const _confile = `./config/inst_${_params.port}.json`
    if( await pathExists(_confile) ){
        await fs.unlink(_confile)
    }
    await fs.writeFile(_confile, JSON.stringify(_template, null, 4))

    const _name = `inst_${_params.port}`
    startProcess(_name, trojanBin, getTrojanArgsByPort(_params.port), { cwd: trojanCwd })
}

async function deleteInstanceByPort (_port){
    const _confile = `./config/inst_${_port}.json`
    const _name = `inst_${_port}`
    stopProcess(_name)
    if( await pathExists(_confile) ){
        await fs.unlink(_confile)
    }
}

const trojanBin = path.join(__dirname, 'bin', 'trojan-go')
const trojanCwd = path.join(__dirname, 'bin')

function getTrojanArgsByPort (port) {
    return ['-config', `../config/inst_${port}.json`]
}

function randomSession6 (){
    return randomString(6)
}

let sk5proxys = {}

const proxiesConfigPath = path.join(__dirname, 'proxies.json')
const sslconfPath = path.join(__dirname, 'sslconf.json')

async function readProxiesJson (){
    if( await pathExists(proxiesConfigPath) ){
        try{
            const _json = JSON.parse(await fs.readFile(proxiesConfigPath, 'UTF-8'))
            if( _json && typeof _json === 'object' ){
                return {
                    providers: (_json.providers && typeof _json.providers === 'object') ? _json.providers : {},
                    enabled: Array.isArray(_json.enabled) ? _json.enabled : [],
                }
            }
        }catch(_error){}
    }
    return { providers: {}, enabled: [] }
}

// SSL 配置（sslconf.json），含 SNI / Cloudflare Key 等，不写入 template。文件不存在时不读盘，直接返回空
async function readSslconf (){
    if( await pathExists(sslconfPath) ){
        try{
            const _json = JSON.parse(await fs.readFile(sslconfPath, 'UTF-8'))
            return {
                sni: (_json && typeof _json.sni === 'string' && _json.sni.trim()) ? _json.sni.trim() : null,
                cloudflare_key: (_json && typeof _json.cloudflare_key === 'string' && _json.cloudflare_key.trim()) ? _json.cloudflare_key.trim() : null,
            }
        }catch(_error){}
    }
    return { sni: null, cloudflare_key: null }
}

async function writeSslconf (_json){
    const _sni = (_json && _json.sni !== undefined && _json.sni !== null) ? String(_json.sni).trim() : null
    const _cloudflareKey = (_json && _json.cloudflare_key !== undefined && _json.cloudflare_key !== null)
        ? String(_json.cloudflare_key).trim()
        : null
    await fs.writeFile(sslconfPath, JSON.stringify({
        sni: _sni || null,
        cloudflare_key: _cloudflareKey || null,
    }, null, 4))
}

async function getCertStatus (){
    return await getCertStatusUtil(__dirname)
}

async function writeProxiesJson (_json){
    const _safe = {
        providers: (_json && _json.providers && typeof _json.providers === 'object') ? _json.providers : {},
        enabled: Array.isArray(_json && _json.enabled) ? _json.enabled : [],
    }
    await fs.writeFile(proxiesConfigPath, JSON.stringify(_safe, null, 4))
}

async function loadProxiesConfig (){
    // 每次加载前重置为「无内置代理」
    sk5proxys = {}

    let _enabled = []

    const _json = await readProxiesJson()

    if( _json.providers && typeof _json.providers === 'object' ){
        for( const _name of Object.keys(_json.providers) ){
            const _cfg = _json.providers[_name]
            if( !_cfg || typeof _cfg !== 'object' ){
                continue
            }
            const { proxy_addr: _proxyAddr, proxy_port: _proxyPort, username: _username, password: _password } = _cfg
            if( !_proxyAddr || !_proxyPort || !_username || !_password ){
                continue
            }
            // 注意：这里返回的是「模板值」，真正的魔法变量渲染在构造 forward_proxy 时完成
            sk5proxys[_name] = {
                proxy_addr: _proxyAddr,
                proxy_port: _proxyPort,
                username: _username,
                password: _password,
            }
        }
    }

    if( Array.isArray(_json.enabled) && _json.enabled.length > 0 ){
        _enabled = _json.enabled.filter($ => typeof $ === 'string' && !!sk5proxys[$])
    }

    return {
        enabled: _enabled,
        all: Object.keys(sk5proxys)
    }
}

async function buildForwardProxy (providerName, country){
    const _tpl = sk5proxys[providerName]
    if( !_tpl ){
        throw new Error('未适配的IP提供商')
    }
    const _vars = {
        country: normalizeCountry(country),
        session: randomSession6(),
    }
    return {
        enabled: true,
        proxy_addr: _tpl.proxy_addr,
        proxy_port: _tpl.proxy_port,
        username: renderMagicVars(_tpl.username, _vars),
        password: renderMagicVars(_tpl.password, _vars),
    }
}

async function resolveConfigPathByPort (localport){
    const _localConfile = `./config/inst_${localport}.json`
    const _wsConfile = `/wsdata/trojan_server/config/inst_${localport}.json`

    const _localExists = await pathExists(_localConfile)
    const _wsExists = await pathExists(_wsConfile)

    if( _localExists ){
        return _localConfile
    }
    if( _wsExists ){
        return _wsConfile
    }
    throw new Error('端口不存在')
}

async function startAllTrojanInstancesOnBoot (){
    // 服务启动时自动拉起 ./config 下所有 inst_*.json
    try{
        await ensureDir('./config')
        const _files = await fs.readdir('./config')
        const _instFiles = _files.filter(_f => /^inst_\d+\.json$/.test(_f))
        if( _instFiles.length === 0 ){
            logger.info('[boot] no inst_*.json found, skip auto start')
            return
        }

        logger.info(`[boot] auto starting ${_instFiles.length} trojan instances...`)
        for( const _f of _instFiles ){
            try{
                const _fullPath = path.join('./config', _f)
                const _raw = await fs.readFile(_fullPath, 'utf-8')
                const _cfg = JSON.parse(_raw)
                const _port = parseInt(_cfg && _cfg.local_port)
                if( isNaN(_port) ){
                    logger.warn('[boot] invalid local_port in', _f)
                    continue
                }
                const _name = `inst_${_port}`
                startProcess(_name, trojanBin, getTrojanArgsByPort(_port), { cwd: trojanCwd })
            }catch(_e){
                logger.error('[boot] failed to start from', _f, _e.message || _e)
            }
        }
    }catch(_e){
        logger.error('[boot] startAllTrojanInstancesOnBoot error:', _e.message || _e)
    }
}

;(async () => {

    app.use(express.json())
    
    app.get('/api/changeip', async (_request, _response) => {
   
        const _params = _request.query
        if( !_params.platform || !_params.localport || isNaN(_params.localport) || !_params.country ){
            return _response.status(400).json({ code: 400, error: 'Bad Request !' })
        }

        try{

            if( !sk5proxys[_params.platform] ){
                // 尝试重新加载一次配置，避免首次请求时 sk5proxys 还没初始化
                await loadProxiesConfig()
                if( !sk5proxys[_params.platform] ){
                    throw new Error('未适配的IP提供商')
                }
            }

            let _body = {
                code: 0,
                msg: `success`,
                // params: _params
            }

            const _vconfile = await resolveConfigPathByPort(_params.localport)
            const _vconfig = JSON.parse(await fs.readFile(_vconfile, 'UTF-8'))

            // 更新 meta_data
            _vconfig.meta_data = _vconfig.meta_data || {}
            _vconfig.meta_data.proxy_name = _params.platform
            _vconfig.meta_data.country = normalizeCountry(_params.country)

            // 使用 meta_data + proxies 模板 + proxyhost.json 重新生成 forward_proxy
            _vconfig.forward_proxy = await buildForwardProxy(
                _vconfig.meta_data.proxy_name,
                _vconfig.meta_data.country
            )

            await fs.writeFile(_vconfile, JSON.stringify(_vconfig, null, 4))

            // 重启对应端口的 trojan 实例
            const _name = `inst_${_params.localport}`
            restartProcess(_name, trojanBin, getTrojanArgsByPort(_params.localport), { cwd: trojanCwd })

            _response.json(_body)

        }catch(_error){

            return _response.status(500).json({ code: 500, error: `解析失败，请重新删除并重新生成此端口 => ${_error.message}` })
        }
    })
    
    app.get('/sumgr', async (_request, _response) => {
        
        const _params = _request.query
        const _auth = Array.isArray(_params.auth) ? (_params.auth[0] || '') : (_params.auth || '')
        if( !_auth || _auth !== webAuth ){
            return _response.status(404).json({ code: 403 })
        }
        const _action = _params.action
        let   _errsummary = ''

        try{
            if( _action === 'getInstances' ){

                const _instances = await listInstancesFromConfigDir()
                return _response.json({ code: 0, instances: _instances })
    
            }
    
            if( _action === 'createInstance' ){
                await createInstanceFromParams(_params)

                return _response.json({ code: 0, msg: '新增成功' })
            }

            if( _action === 'deleteInstance' ){
                await deleteInstanceByPort(_params.port)

                return _response.json({ code: 0, msg: '删除成功' })
            }
        }catch(_error){
            return _response.status(500).json({ code: 500, error: _error.message + _errsummary })
        }

        const { enabled: _enabledProxies } = await loadProxiesConfig()

        _response.send(
            (await fs.readFile('./sumgr.html', 'UTF-8'))
                .replace('sk5proxys: []', `sk5proxys: ${JSON.stringify(_enabledProxies)}`)
        )
    })

    app.post('/api/instances/list', async (_request, _response) => {
        if( !requireAuth(_request, _response) ){ return }
        try{
            const _instances = await listInstancesFromConfigDir()
            _response.json({ code: 0, instances: _instances })
        }catch(_e){
            _response.status(500).json({ code: 500, error: _e.message || '读取失败' })
        }
    })
    app.post('/api/instances/create', async (_request, _response) => {
        if( !requireAuth(_request, _response) ){ return }
        try{
            const _body = _request.body || {}
            await createInstanceFromParams(_body)
            _response.json({ code: 0, msg: '新增成功' })
        }catch(_e){
            _response.status(500).json({ code: 500, error: _e.message || '创建失败' })
        }
    })
    app.post('/api/instances/delete', async (_request, _response) => {
        if( !requireAuth(_request, _response) ){ return }
        try{
            const _body = _request.body || {}
            const _port = _body.port
            if( !_port || isNaN(_port) ){
                return _response.status(400).json({ code: 400, error: 'port 参数错误' })
            }
            await deleteInstanceByPort(_port)
            _response.json({ code: 0, msg: '删除成功' })
        }catch(_e){
            _response.status(500).json({ code: 500, error: _e.message || '删除失败' })
        }
    })

    app.get('/api/proxies', async (_request, _response) => {
        if( !requireAuth(_request, _response) ){ return }
        try{
            const { enabled: _enabledProxies, all: _allProxies } = await loadProxiesConfig()
            _response.json({
                code: 0,
                enabled: _enabledProxies,
                all: _allProxies
            })
        }catch(_error){
            _response.status(500).json({ code: 500, error: _error.message })
        }
    })

    app.post('/api/proxies', async (_request, _response) => {
        if( !requireAuth(_request, _response) ){ return }
        try{
            const { all: _allProxies } = await loadProxiesConfig()
            const _body = _request.body || {}
            const _enabled = Array.isArray(_body.enabled) ? _body.enabled : []
            const _filtered = _enabled.filter($ => typeof $ === 'string' && _allProxies.includes($))

            if( _filtered.length === 0 ){
                return _response.status(400).json({ code: 400, error: 'enabled 不能为空' })
            }

            const _json = await readProxiesJson()
            _json.enabled = _filtered
            await writeProxiesJson(_json)

            _response.json({ code: 0, msg: '保存成功', enabled: _filtered })
        }catch(_error){
            _response.status(500).json({ code: 500, error: _error.message })
        }
    })

    app.get('/api/proxy_providers', async (_request, _response) => {
        if( !requireAuth(_request, _response) ){ return }
        try{
            const _json = await readProxiesJson()
            _response.json({ code: 0, providers: _json.providers || {} })
        }catch(_error){
            _response.status(500).json({ code: 500, error: _error.message })
        }
    })

    app.post('/api/proxy_providers', async (_request, _response) => {
        if( !requireAuth(_request, _response) ){ return }
        try{
            const _body = _request.body || {}
            const _name = (_body.name || '').trim()
            if( !_name ){
                return _response.status(400).json({ code: 400, error: 'name 不能为空' })
            }
            const _provider = {
                proxy_addr: (_body.proxy_addr || '').trim(),
                proxy_port: parseInt(_body.proxy_port),
                username: (_body.username || '').trim(),
                password: (_body.password || '').trim(),
            }
            if( !_provider.proxy_addr || isNaN(_provider.proxy_port) || !_provider.username || !_provider.password ){
                return _response.status(400).json({ code: 400, error: 'proxy_addr/proxy_port/username/password 参数错误' })
            }

            const _json = await readProxiesJson()
            _json.providers = (_json.providers && typeof _json.providers === 'object') ? _json.providers : {}
            _json.providers[_name] = _provider
            await writeProxiesJson(_json)

            _response.json({ code: 0, msg: '新增成功', name: _name })
        }catch(_error){
            _response.status(500).json({ code: 500, error: _error.message })
        }
    })

    // SNI 配置（sslconf.json）：仅一个主域名 + Cloudflare Key，新建端口时从 sslconf 读取 SNI 写入实例，不写入 template
    app.get('/api/sni_config', async (_request, _response) => {
        if( !requireAuth(_request, _response) ){ return }
        try{
            const _cfg = await readSslconf()
            _response.json({
                code: 0,
                domain: _cfg.sni || null,
                cloudflare_key: _cfg.cloudflare_key || null,
            })
        }catch(_error){
            _response.status(500).json({ code: 500, error: _error.message })
        }
    })

    app.post('/api/sni_config', async (_request, _response) => {
        if( !requireAuth(_request, _response) ){ return }
        try{
            const _body = _request.body || {}
            const _raw = (_body.domain !== undefined && _body.domain !== null) ? String(_body.domain).trim() : ''
            const _cfKey = (_body.cloudflare_key !== undefined && _body.cloudflare_key !== null) ? String(_body.cloudflare_key).trim() : ''
            if( !_raw ){
                await writeSslconf({ sni: null, cloudflare_key: _cfKey || null })
                return _response.json({ code: 0, msg: '已清空', domain: null, cloudflare_key: _cfKey || null })
            }
            const _sni = normalizeSNIDomain(_raw)
            if( !_sni ){
                return _response.status(400).json({
                    code: 400,
                    error: '须为主域名（仅 xxx.yyy，不含子域名如 www、且不要带协议或路径）'
                })
            }
            await writeSslconf({ sni: _sni, cloudflare_key: _cfKey || null })
            _response.json({ code: 0, msg: '保存成功', domain: _sni, cloudflare_key: _cfKey || null })
        }catch(_error){
            _response.status(500).json({ code: 500, error: _error.message })
        }
    })

    app.post('/api/apply_cert', async (_request, _response) => {
        if( !requireAuth(_request, _response) ){ return }
        try{
            const _cfg = await readSslconf()
            if( !_cfg.sni ){
                return _response.status(400).json({ code: 400, error: '尚未配置 SNI 主域名' })
            }
            if( !_cfg.cloudflare_key ){
                return _response.status(400).json({ code: 400, error: '尚未配置 Cloudflare Key' })
            }
            await applyCert({
                baseDir: __dirname,
                domain: _cfg.sni,
                cloudflareKey: _cfg.cloudflare_key,
                logger,
            })
            _response.json({ code: 0, msg: '证书申请并替换成功' })
        }catch(_error){
            _response.status(500).json({ code: 500, error: _error.message })
        }
    })

    app.get('/api/logs', async (_request, _response) => {
        if( !requireAuth(_request, _response) ){ return }
        try{
            const _afterId = _request.query.after_id
            const _limit = _request.query.limit
            const _items = logger.list({ afterId: _afterId, limit: _limit })
            _response.json({ code: 0, logs: _items, latest_id: logger.latestId() })
        }catch(_e){
            _response.status(500).json({ code: 500, error: _e.message || '读取日志失败' })
        }
    })

    app.get('/api/ssl_status', async (_request, _response) => {
        if( !requireAuth(_request, _response) ){ return }
        const _status = await getCertStatus()
        _response.json({ code: 0, ..._status })
    })

    app.put('/api/proxy_providers/:name', async (_request, _response) => {
        if( !requireAuth(_request, _response) ){ return }
        try{
            const _name = (_response.req.params.name || '').trim()
            if( !_name ){
                return _response.status(400).json({ code: 400, error: 'name 不能为空' })
            }
            const _body = _request.body || {}
            const _provider = {
                proxy_addr: (_body.proxy_addr || '').trim(),
                proxy_port: parseInt(_body.proxy_port),
                username: (_body.username || '').trim(),
                password: (_body.password || '').trim(),
            }
            if( !_provider.proxy_addr || isNaN(_provider.proxy_port) || !_provider.username || !_provider.password ){
                return _response.status(400).json({ code: 400, error: 'proxy_addr/proxy_port/username/password 参数错误' })
            }

            const _json = await readProxiesJson()
            _json.providers = (_json.providers && typeof _json.providers === 'object') ? _json.providers : {}
            if( !_json.providers[_name] ){
                return _response.status(404).json({ code: 404, error: 'provider 不存在' })
            }
            _json.providers[_name] = _provider
            await writeProxiesJson(_json)

            _response.json({ code: 0, msg: '更新成功', name: _name })
        }catch(_error){
            _response.status(500).json({ code: 500, error: _error.message })
        }
    })

    app.delete('/api/proxy_providers/:name', async (_request, _response) => {
        if( !requireAuth(_request, _response) ){ return }
        try{
            const _name = (_response.req.params.name || '').trim()
            if( !_name ){
                return _response.status(400).json({ code: 400, error: 'name 不能为空' })
            }
            const _json = await readProxiesJson()
            _json.providers = (_json.providers && typeof _json.providers === 'object') ? _json.providers : {}
            if( !_json.providers[_name] ){
                return _response.status(404).json({ code: 404, error: 'provider 不存在' })
            }
            delete _json.providers[_name]
            _json.enabled = Array.isArray(_json.enabled) ? _json.enabled.filter($ => $ !== _name) : []
            await writeProxiesJson(_json)

            _response.json({ code: 0, msg: '删除成功', name: _name })
        }catch(_error){
            _response.status(500).json({ code: 500, error: _error.message })
        }
    })

    app.listen(httpServerPort, () => {
        logger.info(`服务器已启动，监听端口 ${httpServerPort}`)
        logger.info(`管理面板: http://127.0.0.1:${httpServerPort}/sumgr?auth=${encodeURIComponent(webAuth)}`)
        logger.info(`管理面板(局域网/公网): http://<服务器IP>:${httpServerPort}/sumgr?auth=${encodeURIComponent(webAuth)}`)
        startAllTrojanInstancesOnBoot()
    })

})();
