const MAX_LOGS = 10000

/**
 * In-memory logger (ring buffer) for backend logs.
 * - No file persistence
 * - Max 10k entries
 */
let _nextId = 1
const _logs = []

function _stringifyParts (parts){
    return parts.map(p => {
        if( p instanceof Error ){
            return p.stack || p.message || String(p)
        }
        if( typeof p === 'string' ){
            return p
        }
        try{
            return JSON.stringify(p)
        }catch(_e){
            return String(p)
        }
    }).join(' ')
}

function push (level, ...parts){
    const entry = {
        id: _nextId++,
        ts: Date.now(),
        level: level || 'log',
        msg: _stringifyParts(parts),
    }
    _logs.push(entry)
    if( _logs.length > MAX_LOGS ){
        _logs.splice(0, _logs.length - MAX_LOGS)
    }

    // 同时输出到 stdout/stderr，便于直接看服务日志
    try{
        const _lv = entry.level
        const _line = `[${new Date(entry.ts).toISOString()}] [${_lv}] ${entry.msg}`
        if( _lv === 'error' ){
            console.error(_line)
        }else if( _lv === 'warn' ){
            console.warn(_line)
        }else if( _lv === 'info' ){
            console.info(_line)
        }else{
            console.log(_line)
        }
    }catch(_e){}

    return entry
}

function log (...parts){ return push('log', ...parts) }
function info (...parts){ return push('info', ...parts) }
function warn (...parts){ return push('warn', ...parts) }
function error (...parts){ return push('error', ...parts) }

function list ({ afterId = 0, limit = 500 } = {}){
    const _after = parseInt(afterId) || 0
    const _limit = Math.max(1, Math.min(2000, parseInt(limit) || 500))
    const items = _logs.filter(l => l.id > _after)
    return items.slice(-_limit)
}

function latestId (){
    return _logs.length ? _logs[_logs.length - 1].id : 0
}

function clear (){
    _logs.length = 0
}

module.exports = {
    MAX_LOGS,
    push,
    log,
    info,
    warn,
    error,
    list,
    latestId,
    clear,
}

