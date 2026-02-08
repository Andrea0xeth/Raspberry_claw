#!/usr/bin/env bash
###############################################################################
# 01-install-openclaw.sh
# Installazione e configurazione OpenClaw con accesso root completo
# Eseguire come root: sudo bash 01-install-openclaw.sh
###############################################################################
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; }
info() { echo -e "${BLUE}[i]${NC} $1"; }

if [[ $EUID -ne 0 ]]; then
    err "Eseguire come root: sudo bash $0"
    exit 1
fi

# Percorso base del progetto
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo ""
echo "============================================================"
echo "  PICLAW - Installazione OpenClaw"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================================"
echo ""

# ─── Step 1: Crea utente openclaw ───────────────────────────────────────────
info "Step 1/8: Creazione utente dedicato 'openclaw'..."

if id "openclaw" &>/dev/null; then
    log "Utente 'openclaw' gia' esiste"
else
    useradd -r -m -s /bin/bash \
        -d /home/openclaw \
        -c "OpenClaw AI Agent" \
        openclaw
    log "Utente 'openclaw' creato"
fi

# Aggiungi a gruppi hardware
GROUPS=(gpio i2c spi dialout docker video audio plugdev netdev sudo)
for grp in "${GROUPS[@]}"; do
    if getent group "$grp" &>/dev/null; then
        usermod -aG "$grp" openclaw 2>/dev/null || true
    fi
done
log "Utente 'openclaw' aggiunto ai gruppi: ${GROUPS[*]}"

# ─── Step 2: Configura sudoers NOPASSWD ─────────────────────────────────────
info "Step 2/8: Configurazione sudoers NOPASSWD..."

# Copia sudoers dal progetto o crea
SUDOERS_FILE="/etc/sudoers.d/openclaw"
cat > "$SUDOERS_FILE" << 'SUDOERS'
# OpenClaw AI Agent - Accesso root COMPLETO senza password
# ATTENZIONE: Questo da' accesso root completo all'agente AI
# Assicurarsi che il sistema sia in un ambiente sicuro/controllato

# Accesso completo NOPASSWD
openclaw ALL=(ALL:ALL) NOPASSWD: ALL

# Alternativa piu' restrittiva (decommentare se preferita):
# openclaw ALL=(ALL) NOPASSWD: /usr/bin/systemctl, /usr/bin/journalctl
# openclaw ALL=(ALL) NOPASSWD: /usr/sbin/reboot, /usr/sbin/shutdown
# openclaw ALL=(ALL) NOPASSWD: /usr/bin/apt-get, /usr/bin/apt
# openclaw ALL=(ALL) NOPASSWD: /usr/bin/docker
# openclaw ALL=(ALL) NOPASSWD: /usr/local/bin/gpio
# openclaw ALL=(ALL) NOPASSWD: /usr/bin/i2cdetect, /usr/bin/i2cget, /usr/bin/i2cset
# openclaw ALL=(ALL) NOPASSWD: /usr/bin/tee /sys/class/gpio/*
# openclaw ALL=(ALL) NOPASSWD: /bin/ip, /usr/sbin/iptables, /usr/sbin/ufw
SUDOERS
chmod 440 "$SUDOERS_FILE"

# Verifica sintassi sudoers
visudo -c -f "$SUDOERS_FILE"
log "Sudoers NOPASSWD configurato per 'openclaw'"

# ─── Step 3: Installazione OpenClaw ─────────────────────────────────────────
info "Step 3/8: Installazione OpenClaw..."

OPENCLAW_DIR="/opt/openclaw"
mkdir -p "$OPENCLAW_DIR"

# Metodo 1: Installazione da npm (se disponibile)
if npm search openclaw 2>/dev/null | grep -q openclaw; then
    npm install -g openclaw
    log "OpenClaw installato da npm"
else
    # Metodo 2: Installazione da repository GitHub
    info "Tentativo installazione da GitHub..."
    
    if [[ -d "${OPENCLAW_DIR}/src" ]]; then
        cd "${OPENCLAW_DIR}/src"
        git pull origin main 2>/dev/null || true
    else
        # Clone repository (sostituire con URL reale quando disponibile)
        git clone https://github.com/openclaw-ai/openclaw.git "${OPENCLAW_DIR}/src" 2>/dev/null || {
            warn "Repository OpenClaw non accessibile."
            info "Creazione installazione standalone..."
        }
    fi
    
    # Se clone fallito, crea struttura manuale
    if [[ ! -d "${OPENCLAW_DIR}/src" ]]; then
        mkdir -p "${OPENCLAW_DIR}/src"
        
        # Crea package.json per progetto OpenClaw standalone
        cat > "${OPENCLAW_DIR}/src/package.json" << 'PACKAGE_JSON'
{
  "name": "piclaw-openclaw",
  "version": "1.0.0",
  "description": "PiClaw OpenClaw Agent for Raspberry Pi",
  "main": "index.js",
  "type": "module",
  "scripts": {
    "start": "node index.js",
    "dev": "node --watch index.js"
  },
  "dependencies": {
    "express": "^4.18.0",
    "axios": "^1.6.0",
    "ws": "^8.16.0",
    "dotenv": "^16.3.0",
    "winston": "^3.11.0",
    "node-cron": "^3.0.3"
  }
}
PACKAGE_JSON

        # Installa dipendenze
        cd "${OPENCLAW_DIR}/src"
        npm install
        log "Dipendenze OpenClaw installate"
    fi
fi

# ─── Step 4: Crea agent principale ──────────────────────────────────────────
info "Step 4/8: Creazione agent OpenClaw principale..."

cat > "${OPENCLAW_DIR}/src/index.js" << 'AGENT_JS'
/**
 * PiClaw - OpenClaw Agent for Raspberry Pi 4
 * Agent AI autonomo con accesso completo al sistema
 */

import express from 'express';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import { createLogger, format, transports } from 'winston';
import cron from 'node-cron';

const execAsync = promisify(exec);

// ─── Configuration ─────────────────────────────────────────────────────────
const CONFIG = {
    port: parseInt(process.env.OPENCLAW_PORT || '3100'),
    ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
    ollamaModel: process.env.OLLAMA_MODEL || 'piclaw-agent',
    logDir: process.env.LOG_DIR || '/data/logs/openclaw',
    dataDir: process.env.DATA_DIR || '/data',
    maxConcurrentTools: 3,
    decisionInterval: '*/5 * * * *', // Ogni 5 minuti
};

// ─── Logger ─────────────────────────────────────────────────────────────────
await fs.mkdir(CONFIG.logDir, { recursive: true });

const logger = createLogger({
    level: 'info',
    format: format.combine(
        format.timestamp(),
        format.json()
    ),
    transports: [
        new transports.File({ filename: path.join(CONFIG.logDir, 'error.log'), level: 'error' }),
        new transports.File({ filename: path.join(CONFIG.logDir, 'agent.log') }),
        new transports.Console({
            format: format.combine(
                format.colorize(),
                format.simple()
            )
        })
    ]
});

// ─── Tools Registry ─────────────────────────────────────────────────────────
const tools = {
    /**
     * Esegui comando shell con privilegi root
     */
    shell: async ({ command, timeout = 30000 }) => {
        logger.info(`[TOOL:shell] Executing: ${command}`);
        try {
            const { stdout, stderr } = await execAsync(command, {
                timeout,
                env: { ...process.env, PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' }
            });
            return { success: true, stdout: stdout.trim(), stderr: stderr.trim() };
        } catch (error) {
            return { success: false, error: error.message, stderr: error.stderr?.trim() };
        }
    },

    /**
     * Leggi file dal filesystem
     */
    read_file: async ({ path: filePath }) => {
        logger.info(`[TOOL:read_file] Reading: ${filePath}`);
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            return { success: true, content, size: content.length };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Scrivi file sul filesystem
     */
    write_file: async ({ path: filePath, content, mode = '0644' }) => {
        logger.info(`[TOOL:write_file] Writing: ${filePath}`);
        try {
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, content, 'utf-8');
            await fs.chmod(filePath, parseInt(mode, 8));
            return { success: true, path: filePath, size: content.length };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Controlla GPIO pin
     */
    gpio: async ({ pin, action, value = null }) => {
        logger.info(`[TOOL:gpio] Pin ${pin}: ${action} ${value !== null ? '= ' + value : ''}`);
        try {
            let result;
            switch (action) {
                case 'export':
                    await execAsync(`echo ${pin} | sudo tee /sys/class/gpio/export 2>/dev/null || true`);
                    result = { exported: true };
                    break;
                case 'direction':
                    await execAsync(`echo ${value} | sudo tee /sys/class/gpio/gpio${pin}/direction`);
                    result = { direction: value };
                    break;
                case 'read':
                    const { stdout } = await execAsync(`cat /sys/class/gpio/gpio${pin}/value`);
                    result = { value: parseInt(stdout.trim()) };
                    break;
                case 'write':
                    await execAsync(`echo ${value} | sudo tee /sys/class/gpio/gpio${pin}/value`);
                    result = { written: value };
                    break;
                case 'unexport':
                    await execAsync(`echo ${pin} | sudo tee /sys/class/gpio/unexport 2>/dev/null || true`);
                    result = { unexported: true };
                    break;
                default:
                    return { success: false, error: `Unknown GPIO action: ${action}` };
            }
            return { success: true, pin, action, ...result };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Monitoring sistema
     */
    system_info: async () => {
        logger.info('[TOOL:system_info] Collecting system information');
        try {
            const [cpu, mem, disk, temp, uptime, load] = await Promise.all([
                execAsync("top -bn1 | grep 'Cpu(s)' | awk '{print $2}'").then(r => r.stdout.trim()),
                execAsync("free -m | awk 'NR==2{printf \"%s/%sMB (%.1f%%)\", $3, $2, $3*100/$2}'").then(r => r.stdout.trim()),
                execAsync("df -h / /data 2>/dev/null | tail -n +2").then(r => r.stdout.trim()),
                execAsync("vcgencmd measure_temp 2>/dev/null || echo 'temp=N/A'").then(r => r.stdout.trim().replace('temp=', '')),
                execAsync("uptime -p").then(r => r.stdout.trim()),
                execAsync("cat /proc/loadavg").then(r => r.stdout.trim()),
            ]);
            return {
                success: true,
                cpu_usage: cpu,
                memory: mem,
                disk,
                temperature: temp,
                uptime,
                load_average: load,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Gestione servizi systemd
     */
    service: async ({ name, action }) => {
        logger.info(`[TOOL:service] ${action} ${name}`);
        const validActions = ['start', 'stop', 'restart', 'status', 'enable', 'disable'];
        if (!validActions.includes(action)) {
            return { success: false, error: `Invalid action: ${action}` };
        }
        try {
            const { stdout } = await execAsync(`sudo systemctl ${action} ${name} 2>&1`);
            return { success: true, service: name, action, output: stdout.trim() };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Gestione rete
     */
    network: async ({ action, params = {} }) => {
        logger.info(`[TOOL:network] ${action}`);
        try {
            let result;
            switch (action) {
                case 'interfaces':
                    result = await execAsync('ip -j addr show');
                    return { success: true, interfaces: JSON.parse(result.stdout) };
                case 'connectivity':
                    result = await execAsync('ping -c 3 -W 5 8.8.8.8 2>&1');
                    return { success: true, connected: true, output: result.stdout.trim() };
                case 'dns':
                    result = await execAsync(`dig ${params.domain || 'google.com'} +short 2>&1`);
                    return { success: true, resolved: result.stdout.trim() };
                case 'ports':
                    result = await execAsync('ss -tlnp 2>&1');
                    return { success: true, listening_ports: result.stdout.trim() };
                default:
                    return { success: false, error: `Unknown network action: ${action}` };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    /**
     * Gestione processi
     */
    process: async ({ action, params = {} }) => {
        logger.info(`[TOOL:process] ${action}`);
        try {
            let result;
            switch (action) {
                case 'list':
                    result = await execAsync('ps aux --sort=-%mem | head -20');
                    return { success: true, processes: result.stdout.trim() };
                case 'kill':
                    if (!params.pid) return { success: false, error: 'PID required' };
                    await execAsync(`sudo kill ${params.signal || '-15'} ${params.pid}`);
                    return { success: true, killed: params.pid };
                case 'find':
                    result = await execAsync(`pgrep -la "${params.name || ''}"`);
                    return { success: true, found: result.stdout.trim() };
                default:
                    return { success: false, error: `Unknown process action: ${action}` };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
};

// ─── AI Decision Engine ─────────────────────────────────────────────────────
class DecisionEngine {
    constructor() {
        this.history = [];
        this.maxHistory = 50;
    }

    /**
     * Invia prompt a Ollama e ottieni decisione
     */
    async decide(prompt, context = {}) {
        const systemContext = await this.gatherContext();
        
        const fullPrompt = `
CONTESTO SISTEMA ATTUALE:
${JSON.stringify(systemContext, null, 2)}

CONTESTO AGGIUNTIVO:
${JSON.stringify(context, null, 2)}

RICHIESTA/SITUAZIONE:
${prompt}

Rispondi con un JSON valido contenente:
{
    "analysis": "analisi della situazione",
    "plan": ["step1", "step2", ...],
    "actions": [
        {"tool": "nome_tool", "params": {...}},
        ...
    ],
    "priority": "low|medium|high|critical",
    "explanation": "spiegazione decisione"
}`;

        try {
            const response = await axios.post(`${CONFIG.ollamaUrl}/api/generate`, {
                model: CONFIG.ollamaModel,
                prompt: fullPrompt,
                stream: false,
                options: {
                    temperature: 0.3,
                    num_predict: 2048,
                }
            }, { timeout: 120000 });

            const aiResponse = response.data.response;
            
            // Estrai JSON dalla risposta
            const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const decision = JSON.parse(jsonMatch[0]);
                this.history.push({
                    timestamp: new Date().toISOString(),
                    prompt: prompt.substring(0, 200),
                    decision
                });
                if (this.history.length > this.maxHistory) {
                    this.history.shift();
                }
                return decision;
            }
            
            return {
                analysis: aiResponse,
                plan: [],
                actions: [],
                priority: 'low',
                explanation: 'Risposta non strutturata dal modello'
            };
        } catch (error) {
            logger.error(`AI Decision error: ${error.message}`);
            return {
                analysis: 'Errore comunicazione con Ollama',
                plan: [],
                actions: [],
                priority: 'low',
                explanation: error.message
            };
        }
    }

    /**
     * Raccogli contesto sistema per le decisioni
     */
    async gatherContext() {
        try {
            return await tools.system_info();
        } catch {
            return { error: 'Unable to gather system context' };
        }
    }

    /**
     * Esegui azioni decise dall'AI
     */
    async executeActions(actions) {
        const results = [];
        for (const action of actions) {
            if (tools[action.tool]) {
                logger.info(`Executing AI action: ${action.tool}`);
                const result = await tools[action.tool](action.params);
                results.push({ tool: action.tool, result });
            } else {
                results.push({ tool: action.tool, result: { success: false, error: 'Tool not found' } });
            }
        }
        return results;
    }
}

const engine = new DecisionEngine();

// ─── Express API Server ─────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', agent: 'piclaw', uptime: process.uptime() });
});

// Esegui tool direttamente
app.post('/tool/:name', async (req, res) => {
    const toolName = req.params.name;
    if (!tools[toolName]) {
        return res.status(404).json({ error: `Tool '${toolName}' not found` });
    }
    try {
        const result = await tools[toolName](req.body);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Richiedi decisione AI
app.post('/decide', async (req, res) => {
    const { prompt, context = {}, execute = false } = req.body;
    if (!prompt) {
        return res.status(400).json({ error: 'prompt required' });
    }
    try {
        const decision = await engine.decide(prompt, context);
        
        if (execute && decision.actions && decision.actions.length > 0) {
            const results = await engine.executeActions(decision.actions);
            return res.json({ decision, execution_results: results });
        }
        
        res.json({ decision });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Lista tools disponibili
app.get('/tools', (req, res) => {
    res.json({
        tools: Object.keys(tools),
        descriptions: {
            shell: 'Esegui comandi shell con privilegi root',
            read_file: 'Leggi file dal filesystem',
            write_file: 'Scrivi file sul filesystem',
            gpio: 'Controlla GPIO pins (export, read, write, direction)',
            system_info: 'Informazioni complete sul sistema',
            service: 'Gestisci servizi systemd',
            network: 'Operazioni di rete (interfaces, connectivity, dns, ports)',
            process: 'Gestione processi (list, kill, find)'
        }
    });
});

// Cronologia decisioni
app.get('/history', (req, res) => {
    res.json({ history: engine.history });
});

// System info endpoint
app.get('/system', async (req, res) => {
    const info = await tools.system_info();
    res.json(info);
});

// ─── Monitoring Proattivo (Cron) ────────────────────────────────────────────
cron.schedule(CONFIG.decisionInterval, async () => {
    logger.info('[CRON] Proactive system check...');
    try {
        const sysInfo = await tools.system_info();
        
        // Controlla temperatura
        const tempMatch = sysInfo.temperature?.match(/([\d.]+)/);
        if (tempMatch && parseFloat(tempMatch[1]) > 75) {
            logger.warn(`[CRON] Temperature alta: ${sysInfo.temperature}`);
            const decision = await engine.decide(
                `Temperatura CPU alta: ${sysInfo.temperature}. Analizza e suggerisci azioni.`,
                sysInfo
            );
            if (decision.priority === 'critical' || decision.priority === 'high') {
                await engine.executeActions(decision.actions);
            }
        }
        
        // Controlla disco
        const diskLines = sysInfo.disk?.split('\n') || [];
        for (const line of diskLines) {
            const useMatch = line.match(/(\d+)%/);
            if (useMatch && parseInt(useMatch[1]) > 90) {
                logger.warn(`[CRON] Disco quasi pieno: ${line}`);
                await engine.decide(`Spazio disco critico: ${line}`, sysInfo);
            }
        }

        // Controlla memoria
        const memMatch = sysInfo.memory?.match(/([\d.]+)%/);
        if (memMatch && parseFloat(memMatch[1]) > 90) {
            logger.warn(`[CRON] Memoria alta: ${sysInfo.memory}`);
            await engine.decide(`Memoria quasi esaurita: ${sysInfo.memory}`, sysInfo);
        }

    } catch (error) {
        logger.error(`[CRON] Check error: ${error.message}`);
    }
});

// ─── Start Server ───────────────────────────────────────────────────────────
app.listen(CONFIG.port, '0.0.0.0', () => {
    logger.info(`PiClaw OpenClaw Agent running on port ${CONFIG.port}`);
    logger.info(`Ollama backend: ${CONFIG.ollamaUrl} (model: ${CONFIG.ollamaModel})`);
    logger.info(`Tools available: ${Object.keys(tools).join(', ')}`);
    logger.info(`Proactive monitoring: every 5 minutes`);
});
AGENT_JS

log "Agent OpenClaw creato: ${OPENCLAW_DIR}/src/index.js"

# Installa dipendenze
cd "${OPENCLAW_DIR}/src"
npm install 2>/dev/null || true
log "Dipendenze npm installate"

# ─── Step 5: Configurazione OpenClaw ────────────────────────────────────────
info "Step 5/8: Configurazione OpenClaw..."

# Crea directory config
mkdir -p "${OPENCLAW_DIR}/config"

# Copia configurazioni dal progetto
if [[ -d "${PROJECT_DIR}/config/openclaw" ]]; then
    cp -r "${PROJECT_DIR}/config/openclaw/"* "${OPENCLAW_DIR}/config/" 2>/dev/null || true
fi

# Environment file
cat > "${OPENCLAW_DIR}/config/.env" << 'ENV_FILE'
# PiClaw OpenClaw Configuration
OPENCLAW_PORT=3100
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=piclaw-agent
LOG_DIR=/data/logs/openclaw
DATA_DIR=/data
NODE_ENV=production
ENV_FILE

log "Configurazione OpenClaw creata"

# ─── Step 6: Systemd Service ────────────────────────────────────────────────
info "Step 6/8: Creazione systemd service..."

cat > /etc/systemd/system/openclaw.service << SYSTEMD_SERVICE
[Unit]
Description=PiClaw OpenClaw AI Agent
Documentation=https://github.com/YOUR_USER/Raspberry_claw
After=network-online.target ollama.service
Wants=network-online.target ollama.service

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=${OPENCLAW_DIR}/src
EnvironmentFile=${OPENCLAW_DIR}/config/.env
ExecStart=/usr/bin/node ${OPENCLAW_DIR}/src/index.js
ExecReload=/bin/kill -HUP \$MAINPID

# Restart policy
Restart=always
RestartSec=10
StartLimitIntervalSec=300
StartLimitBurst=5

# Limiti risorse
LimitNOFILE=65535
LimitNPROC=4096

# Timeout
TimeoutStartSec=30
TimeoutStopSec=30

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=openclaw

# Security (accesso completo, ma con audit)
AmbientCapabilities=CAP_SYS_RAWIO CAP_SYS_ADMIN CAP_NET_ADMIN CAP_NET_RAW CAP_DAC_OVERRIDE
CapabilityBoundingSet=~
ProtectClock=no
ProtectKernelModules=no
ProtectKernelTunables=no

[Install]
WantedBy=multi-user.target
SYSTEMD_SERVICE

# Copia anche nella directory config del progetto
cp /etc/systemd/system/openclaw.service "${PROJECT_DIR}/config/systemd/" 2>/dev/null || true

systemctl daemon-reload
systemctl enable openclaw
log "Systemd service 'openclaw' creato e abilitato"

# ─── Step 7: Capabilities per binari ────────────────────────────────────────
info "Step 7/8: Configurazione capabilities..."

# Node.js capabilities per accesso hardware diretto
NODE_BIN=$(which node)
if [[ -n "$NODE_BIN" ]]; then
    setcap 'cap_sys_rawio,cap_net_admin,cap_net_raw+eip' "$NODE_BIN" 2>/dev/null || {
        warn "setcap su node fallito (non critico con sudo)"
    }
    log "Capabilities impostate su $NODE_BIN"
fi

# Python capabilities per GPIO
PYTHON_BIN=$(which python3)
if [[ -n "$PYTHON_BIN" ]]; then
    setcap 'cap_sys_rawio+eip' "$PYTHON_BIN" 2>/dev/null || true
    log "Capabilities impostate su $PYTHON_BIN"
fi

# ─── Step 8: Copia tools Python ─────────────────────────────────────────────
info "Step 8/8: Installazione tools Python..."

# Crea virtual environment per tools
python3 -m venv "${OPENCLAW_DIR}/venv"
source "${OPENCLAW_DIR}/venv/bin/activate"

pip install --upgrade pip 2>/dev/null || true
pip install gpiozero RPi.GPIO smbus2 psutil requests 2>/dev/null || {
    warn "Alcune librerie Python non installabili (normale se non su RPi)"
}

# Copia tools dal progetto
if [[ -d "${PROJECT_DIR}/tools" ]]; then
    cp -r "${PROJECT_DIR}/tools/"*.py "${OPENCLAW_DIR}/tools/" 2>/dev/null || true
    mkdir -p "${OPENCLAW_DIR}/tools"
fi

deactivate

# ─── Imposta ownership ──────────────────────────────────────────────────────
chown -R openclaw:openclaw "${OPENCLAW_DIR}"
chown -R openclaw:openclaw /data/logs/openclaw 2>/dev/null || {
    mkdir -p /data/logs/openclaw
    chown -R openclaw:openclaw /data/logs/openclaw
}

# ─── Avvia servizio ─────────────────────────────────────────────────────────
info "Avvio servizio OpenClaw..."
systemctl start openclaw 2>/dev/null || {
    warn "Avvio OpenClaw fallito (Ollama potrebbe non essere ancora installato)"
    warn "Il servizio si avviera' dopo l'installazione di Ollama"
}

# ─── Riepilogo ──────────────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "  OPENCLAW INSTALLATO"
echo "============================================================"
echo ""
log "Utente 'openclaw' creato con accesso root NOPASSWD"
log "OpenClaw installato in: ${OPENCLAW_DIR}"
log "Systemd service: openclaw.service (root-owned)"
log "API endpoint: http://localhost:3100"
log "Capabilities hardware configurate"
echo ""
info "Comandi utili:"
echo "  sudo systemctl status openclaw     # Stato servizio"
echo "  sudo journalctl -u openclaw -f     # Log in tempo reale"
echo "  curl http://localhost:3100/health   # Health check"
echo "  curl http://localhost:3100/tools    # Lista tools"
echo "  curl http://localhost:3100/system   # Info sistema"
echo ""
info "PROSSIMO STEP:"
info "  sudo bash scripts/04-ai-engine/01-install-ollama.sh"
echo ""
