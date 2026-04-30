const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const GEMINI_TMP = path.join(HOME, '.gemini', 'tmp');

function scanRecursive(dir, projectName, results) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            scanRecursive(fullPath, projectName, results);
        } else if (entry.isFile()) {
            const ext = path.extname(entry.name);
            if (ext === '.json' || ext === '.jsonl') {
                if (['logs.json', 'projects.json', 'settings.json', 'state.json'].includes(entry.name)) continue;
                
                try {
                    const content = fs.readFileSync(fullPath, 'utf8');
                    // Simple check if it's a valid session (contains sessionId or messages)
                    if (content.includes('sessionId') || content.includes('"role"') || content.includes('"type":"user"')) {
                        results.push({
                            project: projectName,
                            path: fullPath,
                            size: fs.statSync(fullPath).size
                        });
                    }
                } catch (e) {}
            }
        }
    }
}

console.log('--- Gemini Session Diagnostic ---');
console.log(`Checking directory: ${GEMINI_TMP}`);

const foundSessions = [];
if (fs.existsSync(GEMINI_TMP)) {
    const projects = fs.readdirSync(GEMINI_TMP, { withFileTypes: true });
    for (const project of projects) {
        if (project.isDirectory()) {
            console.log(`Scanning project: ${project.name}`);
            scanRecursive(path.join(GEMINI_TMP, project.name), project.name, foundSessions);
        }
    }
} else {
    console.log('Error: .gemini/tmp directory not found');
}

console.log(`\nTotal sessions found: ${foundSessions.length}`);
foundSessions.sort((a, b) => b.size - a.size).slice(0, 10).forEach(s => {
    console.log(`[${s.project}] ${s.path} (${s.size} bytes)`);
});

if (foundSessions.length < 2) {
    console.log('\nDIAGNOSIS: FAILURE - Still missing multiple sessions.');
    process.exit(1);
} else {
    console.log('\nDIAGNOSIS: SUCCESS - Found multiple sessions.');
    process.exit(0);
}
