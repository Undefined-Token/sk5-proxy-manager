const { spawn } = require('child_process')
const path = require('path')
const logger = require('./logger')

// 简单的进程管理器，用 name 标识每个 trojan 实例
const processes = new Map()

function _wireChildOutputToLogger (name, child){
    // stdio=pipe 才会有 stdout/stderr
    const MAX_LINE_LEN = 4000

    const makeLineLogger = (level) => {
        let _buf = ''
        return (chunk) => {
            try{
                _buf += chunk.toString('utf8')
                const parts = _buf.split(/\r?\n/)
                _buf = parts.pop() || ''
                for( const line of parts ){
                    const _line = (line || '').trimEnd()
                    if( !_line ){ continue }
                    const clipped = _line.length > MAX_LINE_LEN ? (_line.slice(0, MAX_LINE_LEN) + '…(clipped)') : _line
                    logger[level](`[process] ${name}: ${clipped}`)
                }
            }catch(_e){}
        }
    }

    if( child && child.stdout ){
        child.stdout.on('data', makeLineLogger('info'))
    }
    if( child && child.stderr ){
        child.stderr.on('data', makeLineLogger('warn'))
    }
}

function startProcess (name, command, args = [], options = {}) {
    // 已存在则先尝试停止旧进程
    if (processes.has(name)) {
        stopProcess(name)
    }

    const spawnOptions = {
        cwd: options.cwd || process.cwd(),
        // 让 trojan-go 的输出可被采集到日志中（stdout/stderr）
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
    }

    logger.log(`[process] spawning ${name}:`, {
        command,
        args,
        cwd: spawnOptions.cwd,
    })

    const child = spawn(command, args, spawnOptions)

    processes.set(name, child)

    _wireChildOutputToLogger(name, child)

    child.on('exit', (code, signal) => {
        // 进程退出时自动从管理列表中移除
        if (processes.get(name) === child) {
            processes.delete(name)
        }
        logger.warn(`[process] ${name} exited with code=${code} signal=${signal}`)
    })

    child.on('error', (err) => {
        logger.error(`[process] ${name} spawn error:`, {
            message: err.message,
            code: err.code,
            errno: err.errno,
            syscall: err.syscall,
            path: err.path,
            spawnargs: err.spawnargs,
        })
    })

    logger.info(`[process] started ${name} (pid=${child.pid || 'spawn_failed'})`)
}

function stopProcess (name) {
    const child = processes.get(name)
    if (!child) {
        return
    }

    try {
        child.kill('SIGTERM')
        logger.info(`[process] sent SIGTERM to ${name} (pid=${child.pid})`)
    } catch (err) {
        logger.error(`[process] failed to kill ${name}:`, err)
    } finally {
        processes.delete(name)
    }
}

function restartProcess (name, command, args = [], options = {}) {
    stopProcess(name)
    startProcess(name, command, args, options)
}

function listProcesses () {
    return Array.from(processes.keys())
}

module.exports = {
    startProcess,
    stopProcess,
    restartProcess,
    listProcesses,
}

