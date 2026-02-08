#!/usr/bin/env python3
"""
PiClaw Decision Engine
Motore decisionale AI autonomo che interfaccia Ollama con i tool di sistema.
Analizza situazioni, pianifica azioni, esegue e verifica.

Uso standalone:
    python3 decision_engine.py "Analizza lo stato del sistema e suggerisci ottimizzazioni"
    python3 decision_engine.py --execute "Gestisci batteria bassa: prepara shutdown sicuro"
    python3 decision_engine.py --monitor  # Monitoring proattivo continuo

Uso come modulo:
    from decision_engine import DecisionEngine
    engine = DecisionEngine()
    decision = engine.decide("Temperatura alta, cosa fare?")
    results = engine.execute_decision(decision)
"""

import argparse
import json
import logging
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

# Setup logging
LOG_DIR = Path('/data/logs/decision-engine')
LOG_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(LOG_DIR / 'decisions.log', mode='a'),
    ]
)
logger = logging.getLogger('PiClaw.DecisionEngine')


class DecisionEngine:
    """Motore decisionale AI per PiClaw."""

    def __init__(
        self,
        ollama_url: str = "http://localhost:11434",
        model: str = "piclaw-agent",
        timeout: int = 120
    ):
        self.ollama_url = ollama_url
        self.model = model
        self.timeout = timeout
        self.history = []
        self.max_history = 100

    def _gather_system_context(self) -> dict:
        """Raccogli contesto sistema corrente per il modello AI."""
        context = {"timestamp": datetime.now().isoformat()}

        # CPU
        try:
            with open('/proc/loadavg') as f:
                context["load_average"] = f.read().strip()
        except Exception:
            context["load_average"] = "N/A"

        # Temperatura
        try:
            temp = Path('/sys/class/thermal/thermal_zone0/temp').read_text().strip()
            context["cpu_temp_c"] = round(int(temp) / 1000.0, 1)
        except Exception:
            context["cpu_temp_c"] = "N/A"

        # Memoria
        try:
            result = subprocess.run(
                ['free', '-m'],
                capture_output=True, text=True, timeout=5
            )
            lines = result.stdout.strip().split('\n')
            if len(lines) >= 2:
                parts = lines[1].split()
                context["memory"] = {
                    "total_mb": int(parts[1]),
                    "used_mb": int(parts[2]),
                    "available_mb": int(parts[6]) if len(parts) > 6 else 0,
                }
        except Exception:
            pass

        # Disco
        try:
            result = subprocess.run(
                ['df', '-h', '/', '/data'],
                capture_output=True, text=True, timeout=5
            )
            context["disk"] = result.stdout.strip()
        except Exception:
            pass

        # Uptime
        try:
            result = subprocess.run(
                ['uptime', '-p'],
                capture_output=True, text=True, timeout=5
            )
            context["uptime"] = result.stdout.strip()
        except Exception:
            pass

        # Servizi critici
        for service in ['ollama', 'openclaw', 'docker', 'ssh']:
            try:
                result = subprocess.run(
                    ['systemctl', 'is-active', service],
                    capture_output=True, text=True, timeout=5
                )
                context[f"service_{service}"] = result.stdout.strip()
            except Exception:
                context[f"service_{service}"] = "unknown"

        return context

    def decide(self, prompt: str, additional_context: Optional[dict] = None) -> dict:
        """
        Invia situazione al modello AI e ottieni decisione strutturata.

        Args:
            prompt: Descrizione situazione/richiesta
            additional_context: Contesto aggiuntivo opzionale

        Returns:
            dict con analisi, piano, azioni, priorita'
        """
        # Raccogli contesto
        system_context = self._gather_system_context()
        if additional_context:
            system_context.update(additional_context)

        # Costruisci prompt completo
        full_prompt = f"""CONTESTO SISTEMA ATTUALE:
{json.dumps(system_context, indent=2)}

SITUAZIONE/RICHIESTA:
{prompt}

Rispondi ESCLUSIVAMENTE con un JSON valido nel seguente formato:
{{
    "analysis": "analisi dettagliata della situazione",
    "plan": ["step 1 specifico", "step 2 specifico", "step 3 specifico"],
    "actions": [
        {{"tool": "shell", "params": {{"command": "comando specifico"}}}},
        {{"tool": "system_info", "params": {{}}}}
    ],
    "priority": "low|medium|high|critical",
    "explanation": "motivazione della decisione"
}}"""

        logger.info(f"Richiesta decisione: {prompt[:100]}...")

        if not REQUESTS_AVAILABLE:
            logger.error("requests non disponibile. pip install requests")
            return self._fallback_decision(prompt, system_context)

        try:
            response = requests.post(
                f"{self.ollama_url}/api/generate",
                json={
                    "model": self.model,
                    "prompt": full_prompt,
                    "stream": False,
                    "options": {
                        "temperature": 0.3,
                        "num_predict": 2048,
                    }
                },
                timeout=self.timeout
            )
            response.raise_for_status()

            ai_response = response.json().get('response', '')
            logger.info(f"Risposta AI ricevuta ({len(ai_response)} chars)")

            # Estrai JSON dalla risposta
            decision = self._extract_json(ai_response)
            if decision:
                # Salva in cronologia
                self._save_to_history(prompt, decision)
                return decision
            else:
                logger.warning("Risposta non strutturata dal modello")
                return {
                    "analysis": ai_response[:500],
                    "plan": [],
                    "actions": [],
                    "priority": "low",
                    "explanation": "Risposta non strutturata, interpretazione manuale necessaria",
                    "raw_response": ai_response
                }

        except requests.exceptions.ConnectionError:
            logger.error("Ollama non raggiungibile")
            return self._fallback_decision(prompt, system_context)
        except requests.exceptions.Timeout:
            logger.error("Timeout nella richiesta a Ollama")
            return self._fallback_decision(prompt, system_context)
        except Exception as e:
            logger.error(f"Errore decisione: {e}")
            return self._fallback_decision(prompt, system_context)

    def _extract_json(self, text: str) -> Optional[dict]:
        """Estrai JSON da risposta testuale."""
        # Prova a parsare direttamente
        try:
            return json.loads(text.strip())
        except json.JSONDecodeError:
            pass

        # Cerca JSON nel testo
        import re
        json_patterns = [
            r'\{[\s\S]*"analysis"[\s\S]*"plan"[\s\S]*\}',
            r'\{[\s\S]*"analysis"[\s\S]*\}',
            r'```json\s*([\s\S]*?)```',
            r'```\s*([\s\S]*?)```',
        ]

        for pattern in json_patterns:
            match = re.search(pattern, text)
            if match:
                try:
                    json_str = match.group(1) if match.lastindex else match.group(0)
                    return json.loads(json_str)
                except (json.JSONDecodeError, IndexError):
                    continue

        return None

    def _fallback_decision(self, prompt: str, context: dict) -> dict:
        """Decisione di fallback basata su regole quando Ollama non e' disponibile."""
        logger.warning("Usando decisione rule-based (fallback)")

        prompt_lower = prompt.lower()
        decision = {
            "analysis": "Decisione basata su regole (Ollama non disponibile)",
            "plan": [],
            "actions": [],
            "priority": "medium",
            "explanation": "Fallback rule-based decision",
            "fallback": True
        }

        # Regole per scenari comuni
        if any(w in prompt_lower for w in ['temperatura', 'temperature', 'caldo', 'hot']):
            temp = context.get('cpu_temp_c', 0)
            if isinstance(temp, (int, float)) and temp > 75:
                decision["priority"] = "high"
                decision["plan"] = [
                    "Controllare temperatura CPU",
                    "Ridurre carico se necessario",
                    "Verificare ventola/dissipatore"
                ]
                decision["actions"] = [
                    {"tool": "shell", "params": {"command": "vcgencmd measure_temp"}},
                    {"tool": "shell", "params": {"command": "top -bn1 | head -20"}},
                ]

        elif any(w in prompt_lower for w in ['disco', 'disk', 'storage', 'pieno', 'full']):
            decision["plan"] = [
                "Controllare spazio disco",
                "Identificare file grandi",
                "Pulire cache se necessario"
            ]
            decision["actions"] = [
                {"tool": "shell", "params": {"command": "df -h / /data"}},
                {"tool": "shell", "params": {"command": "du -sh /data/ollama/models/*"}},
                {"tool": "shell", "params": {"command": "sudo journalctl --disk-usage"}},
            ]

        elif any(w in prompt_lower for w in ['batteria', 'battery', 'shutdown', 'spegni']):
            decision["priority"] = "critical"
            decision["plan"] = [
                "Salvare stato servizi",
                "Sync filesystem",
                "Shutdown sicuro"
            ]
            decision["actions"] = [
                {"tool": "shell", "params": {"command": "sync"}},
                {"tool": "shell", "params": {"command": "sudo systemctl stop openclaw"}},
                {"tool": "shell", "params": {"command": "sudo shutdown -h +1 'Batteria bassa - shutdown programmato'"}},
            ]

        elif any(w in prompt_lower for w in ['memoria', 'memory', 'ram', 'oom']):
            decision["plan"] = [
                "Analizzare utilizzo memoria",
                "Identificare processi memory-hungry",
                "Liberare memoria se critico"
            ]
            decision["actions"] = [
                {"tool": "shell", "params": {"command": "free -h"}},
                {"tool": "shell", "params": {"command": "ps aux --sort=-%mem | head -15"}},
            ]

        elif any(w in prompt_lower for w in ['rete', 'network', 'internet', 'connessione']):
            decision["plan"] = [
                "Verificare connettivita'",
                "Controllare DNS",
                "Diagnosticare interfacce"
            ]
            decision["actions"] = [
                {"tool": "shell", "params": {"command": "ping -c 3 8.8.8.8"}},
                {"tool": "shell", "params": {"command": "ip addr show"}},
                {"tool": "shell", "params": {"command": "cat /etc/resolv.conf"}},
            ]

        else:
            decision["plan"] = ["Raccogliere informazioni sistema"]
            decision["actions"] = [
                {"tool": "shell", "params": {"command": "uname -a && uptime && free -h && df -h / /data"}},
            ]

        self._save_to_history(prompt, decision)
        return decision

    def execute_decision(self, decision: dict, dry_run: bool = False) -> list:
        """
        Esegui le azioni decise dall'AI.

        Args:
            decision: Decisione con campo 'actions'
            dry_run: Se True, mostra solo cosa farebbe

        Returns:
            Lista risultati esecuzione
        """
        actions = decision.get('actions', [])
        if not actions:
            logger.info("Nessuna azione da eseguire")
            return []

        results = []
        for i, action in enumerate(actions):
            tool = action.get('tool', '')
            params = action.get('params', {})

            logger.info(f"Azione {i+1}/{len(actions)}: {tool} - {json.dumps(params)[:100]}")

            if dry_run:
                results.append({
                    "tool": tool,
                    "params": params,
                    "dry_run": True,
                    "would_execute": True
                })
                continue

            if tool == 'shell':
                result = self._execute_shell(params.get('command', ''))
            elif tool == 'system_info':
                result = {"success": True, "context": self._gather_system_context()}
            else:
                result = {"success": False, "error": f"Tool '{tool}' non implementato localmente"}

            results.append({"tool": tool, "params": params, "result": result})

        return results

    def _execute_shell(self, command: str) -> dict:
        """Esegui comando shell."""
        if not command:
            return {"success": False, "error": "Comando vuoto"}

        logger.info(f"Esecuzione shell: {command}")
        try:
            result = subprocess.run(
                command, shell=True,
                capture_output=True, text=True,
                timeout=60,
                env={**os.environ, 'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'}
            )
            return {
                "success": result.returncode == 0,
                "stdout": result.stdout.strip()[:5000],
                "stderr": result.stderr.strip()[:1000],
                "return_code": result.returncode
            }
        except subprocess.TimeoutExpired:
            return {"success": False, "error": "Timeout (60s)"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _save_to_history(self, prompt: str, decision: dict):
        """Salva decisione nella cronologia."""
        entry = {
            "timestamp": datetime.now().isoformat(),
            "prompt": prompt[:200],
            "priority": decision.get('priority', 'unknown'),
            "actions_count": len(decision.get('actions', [])),
        }
        self.history.append(entry)
        if len(self.history) > self.max_history:
            self.history.pop(0)

        # Salva anche su file
        try:
            history_file = LOG_DIR / 'history.jsonl'
            with open(history_file, 'a') as f:
                f.write(json.dumps(entry) + '\n')
        except Exception:
            pass

    def proactive_monitor(self, interval: int = 300):
        """
        Monitoring proattivo continuo.
        Controlla periodicamente il sistema e prende decisioni autonome.

        Args:
            interval: Secondi tra i check (default 300 = 5 minuti)
        """
        logger.info(f"Avvio monitoring proattivo (intervallo: {interval}s)")

        while True:
            try:
                context = self._gather_system_context()

                issues = []

                # Check temperatura
                temp = context.get('cpu_temp_c', 0)
                if isinstance(temp, (int, float)) and temp > 75:
                    issues.append(f"Temperatura CPU alta: {temp}°C")

                # Check memoria
                mem = context.get('memory', {})
                if mem:
                    total = mem.get('total_mb', 1)
                    available = mem.get('available_mb', total)
                    mem_pct = (1 - available / total) * 100 if total > 0 else 0
                    if mem_pct > 90:
                        issues.append(f"Memoria critica: {mem_pct:.0f}%")

                # Check servizi
                for service in ['ollama', 'openclaw']:
                    status = context.get(f'service_{service}', 'unknown')
                    if status != 'active':
                        issues.append(f"Servizio {service}: {status}")

                if issues:
                    prompt = f"Problemi rilevati dal monitoring proattivo:\n" + "\n".join(f"- {i}" for i in issues)
                    logger.warning(f"Issues rilevati: {issues}")

                    decision = self.decide(prompt, context)

                    if decision.get('priority') in ('critical', 'high'):
                        logger.warning(f"Esecuzione automatica azioni (priority: {decision['priority']})")
                        results = self.execute_decision(decision)
                        logger.info(f"Risultati: {json.dumps(results, default=str)[:500]}")
                    else:
                        logger.info(f"Issues non critici, solo logging (priority: {decision.get('priority')})")
                else:
                    logger.debug("Nessun problema rilevato")

            except Exception as e:
                logger.error(f"Errore nel monitoring: {e}")

            time.sleep(interval)


def main():
    parser = argparse.ArgumentParser(description='PiClaw Decision Engine')
    parser.add_argument('prompt', nargs='?', help='Prompt/situazione da analizzare')
    parser.add_argument('--execute', action='store_true', help='Esegui azioni decise')
    parser.add_argument('--dry-run', action='store_true', help='Mostra azioni senza eseguire')
    parser.add_argument('--monitor', action='store_true', help='Monitoring proattivo continuo')
    parser.add_argument('--interval', type=int, default=300, help='Intervallo monitoring (sec)')
    parser.add_argument('--model', default='piclaw-agent', help='Modello Ollama')
    parser.add_argument('--json', action='store_true', help='Output JSON')

    args = parser.parse_args()
    engine = DecisionEngine(model=args.model)

    if args.monitor:
        engine.proactive_monitor(interval=args.interval)
        return

    if not args.prompt:
        parser.print_help()
        sys.exit(1)

    # Ottieni decisione
    decision = engine.decide(args.prompt)

    if args.json:
        output = {"decision": decision}
    else:
        print(f"\n{'='*60}")
        print(f"  PiClaw Decision Engine")
        print(f"  Prompt: {args.prompt[:80]}")
        print(f"{'='*60}\n")
        print(f"  Priorita': {decision.get('priority', 'N/A')}")
        print(f"  Analisi: {decision.get('analysis', 'N/A')[:300]}")
        print(f"\n  Piano:")
        for i, step in enumerate(decision.get('plan', []), 1):
            print(f"    {i}. {step}")
        print(f"\n  Azioni ({len(decision.get('actions', []))}):")
        for action in decision.get('actions', []):
            print(f"    - {action.get('tool', '?')}: {json.dumps(action.get('params', {}))[:80]}")
        print(f"\n  Spiegazione: {decision.get('explanation', 'N/A')[:300]}")

    # Esegui se richiesto
    if args.execute or args.dry_run:
        results = engine.execute_decision(decision, dry_run=args.dry_run)

        if args.json:
            output["execution_results"] = results
        else:
            print(f"\n{'='*60}")
            print(f"  {'DRY RUN - ' if args.dry_run else ''}Risultati Esecuzione")
            print(f"{'='*60}\n")
            for i, res in enumerate(results, 1):
                tool = res.get('tool', '?')
                if args.dry_run:
                    print(f"  {i}. [DRY] {tool}: {json.dumps(res.get('params', {}))[:80]}")
                else:
                    result = res.get('result', {})
                    status = "OK" if result.get('success') else "FAIL"
                    print(f"  {i}. [{status}] {tool}")
                    if result.get('stdout'):
                        print(f"      Output: {result['stdout'][:200]}")
                    if result.get('error'):
                        print(f"      Errore: {result['error'][:200]}")

    if args.json:
        print(json.dumps(output, indent=2, default=str))

    print()


if __name__ == '__main__':
    main()
