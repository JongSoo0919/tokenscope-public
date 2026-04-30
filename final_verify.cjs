const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();

function getSessions() {
    const sessions = [];
    
    // 1. Claude
    const claudeDir = path.join(HOME, '.claude', 'projects');
    if (fs.existsSync(claudeDir)) {
        fs.readdirSync(claudeDir).forEach(p => {
            const pPath = path.join(claudeDir, p);
            if (fs.statSync(pPath).isDirectory()) {
                fs.readdirSync(pPath).forEach(f => {
                    if (f.endsWith('.jsonl')) sessions.push({ provider: 'claude', path: path.join(pPath, f) });
                });
            }
        });
    }

    // 2. Gemini Tmp
    const geminiTmp = path.join(HOME, '.gemini', 'tmp');
    if (fs.existsSync(geminiTmp)) {
        const scan = (dir, proj) => {
            fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
                const full = path.join(dir, e.name);
                if (e.isDirectory()) scan(full, proj);
                else if (e.name.endsWith('.json') || e.name.endsWith('.jsonl')) {
                    if (!['logs.json', 'projects.json', 'settings.json'].includes(e.name)) {
                        sessions.push({ provider: 'gemini', path: full });
                    }
                }
            });
        };
        fs.readdirSync(geminiTmp).forEach(p => {
            const pPath = path.join(geminiTmp, p);
            if (fs.statSync(pPath).isDirectory()) scan(pPath, p);
        });
    }

    // 3. Global OMC
    const omcDir = path.join(HOME, '.omc', 'state', 'sessions');
    if (fs.existsSync(omcDir)) {
        const scan = (dir) => {
            fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
                const full = path.join(dir, e.name);
                if (e.isDirectory()) scan(full);
                else if (e.name.endsWith('.json') || e.name.endsWith('.jsonl')) {
                    if (!e.name.includes('state.json')) sessions.push({ provider: 'omc-global', path: full });
                }
            });
        };
        scan(omc_sessions_dir = omcDir);
    }

    return sessions;
}

const list = getSessions();
console.log(`[VERIFICATION] Found total ${list.length} sessions.`);
const geminiCount = list.filter(s => s.provider === 'gemini').length;
console.log(`[VERIFICATION] Gemini specific sessions: ${geminiCount}`);

if (geminiCount > 5) {
    console.log('[SUCCESS] Multiple Gemini sessions found. Logic is robust.');
    process.exit(0);
} else {
    console.log('[FAILURE] Still not finding enough Gemini sessions.');
    process.exit(1);
}
