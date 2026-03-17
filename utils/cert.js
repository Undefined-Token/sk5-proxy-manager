const path = require('path')
const os = require('os')
const { exec } = require('child_process')
const { fs, ensureDir, pathExists, removePath, copyPath } = require('./fs')

function applyCert ({ baseDir, domain, cloudflareKey, logger }){
    return new Promise(async (resolve, reject) => {
        try{
            const _domain = String(domain || '').trim()
            const _key = String(cloudflareKey || '').trim()
            if( !_domain ){
                return reject(new Error('domain 不能为空'))
            }
            if( !_key ){
                return reject(new Error('cloudflare_key 不能为空'))
            }

            const _email = `cert@${_domain}`

            const _tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'trojan-sslconf-'))
            const _tmpCredentials = path.join(_tmpBase, 'cloudflare.ini')
            const _tmpConfigDir = path.join(_tmpBase, 'config')
            const _tmpWorkDir = path.join(_tmpBase, 'work')
            const _tmpLogsDir = path.join(_tmpBase, 'logs')
            await ensureDir(_tmpConfigDir)
            await ensureDir(_tmpWorkDir)
            await ensureDir(_tmpLogsDir)

            // certbot dns-cloudflare 插件支持 API Token（推荐）
            // 若你给的是全局 API Key，需要改成 dns_cloudflare_email + dns_cloudflare_api_key 两行
            const _iniContent = `dns_cloudflare_api_token = ${_key}\n`
            await fs.writeFile(_tmpCredentials, _iniContent, { mode: 0o600 })

            const _cmd = [
                'certbot certonly',
                '--dns-cloudflare',
                `--dns-cloudflare-credentials "${_tmpCredentials}"`,
                '--server https://acme-v02.api.letsencrypt.org/directory',
                `-d "${_domain}"`,
                `-d "*.${_domain}"`,
                '--preferred-challenges dns-01',
                '--non-interactive',
                '--agree-tos',
                `--email "${_email}"`,
                `--config-dir "${_tmpConfigDir}"`,
                `--work-dir "${_tmpWorkDir}"`,
                `--logs-dir "${_tmpLogsDir}"`,
            ].join(' ')

            exec(_cmd, async (_error, _stdout, _stderr) => {
                try{
                    if( _error ){
                        logger?.error?.('apply_cert error:', _error, _stderr)
                        return reject(new Error(`certbot 执行失败: ${_error.message || _error}`))
                    }

                    const _liveDir = path.join(_tmpConfigDir, 'live', _domain)
                    const _srcCert = path.join(_liveDir, 'fullchain.pem')
                    const _srcKey = path.join(_liveDir, 'privkey.pem')
                    const _dstCert = path.join(baseDir, 'bin', 'cert.crt')
                    const _dstKey = path.join(baseDir, 'bin', 'key.key')

                    const _certExists = await pathExists(_srcCert)
                    const _keyExists = await pathExists(_srcKey)
                    if( !_certExists || !_keyExists ){
                        return reject(new Error('证书文件未找到，请检查 certbot 输出和 live 目录'))
                    }

                    await removePath(_dstCert)
                    await removePath(_dstKey)
                    await fs.cp(_srcCert, _dstCert, { force: true, dereference: true })
                    await fs.cp(_srcKey, _dstKey, { force: true, dereference: true })

                    resolve({ ok: true })
                }catch(_innerError){
                    logger?.error?.('apply_cert copy error:', _innerError)
                    reject(_innerError)
                }
            })
        }catch(_e){
            reject(_e)
        }
    })
}

module.exports = { applyCert }

