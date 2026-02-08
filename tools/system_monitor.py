#!/usr/bin/env python3
"""
PiClaw System Monitor
Monitoring completo del sistema Raspberry Pi 4.
Raccoglie: CPU, RAM, temperatura, disco, rete, processi.

Uso standalone:
    python3 system_monitor.py                    # Report completo
    python3 system_monitor.py --watch 5          # Monitoring continuo (ogni 5s)
    python3 system_monitor.py --json             # Output JSON
    python3 system_monitor.py --alert            # Solo se ci sono alert

Uso come modulo:
    from system_monitor import SystemMonitor
    mon = SystemMonitor()
    info = mon.get_full_report()
    alerts = mon.check_alerts()
"""

import argparse
import json
import logging
import os
import platform
import subprocess
import time
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Optional

# Configurazione logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger('PiClaw.Monitor')

try:
    import psutil
    PSUTIL_AVAILABLE = True
except ImportError:
    PSUTIL_AVAILABLE = False
    logger.warning("psutil non disponibile. Funzionalita' limitate.")


@dataclass
class AlertThresholds:
    """Soglie per alert di sistema."""
    temp_warn: float = 70.0
    temp_critical: float = 80.0
    mem_warn: float = 85.0
    mem_critical: float = 95.0
    disk_warn: float = 85.0
    disk_critical: float = 95.0
    cpu_warn: float = 90.0
    cpu_critical: float = 98.0
    swap_warn: float = 80.0
    load_warn: float = 3.5  # Per 4 core


class SystemMonitor:
    """Monitor di sistema completo per Raspberry Pi 4."""

    def __init__(self, thresholds: Optional[AlertThresholds] = None):
        self.thresholds = thresholds or AlertThresholds()
        self.history = []
        self.max_history = 100

    def get_cpu_info(self) -> dict:
        """Informazioni CPU."""
        info = {
            "model": "N/A",
            "cores": os.cpu_count() or 0,
            "architecture": platform.machine(),
            "usage_percent": 0.0,
            "frequency_mhz": 0,
            "load_average": [0, 0, 0],
            "per_core": []
        }

        # Modello CPU
        try:
            with open('/proc/cpuinfo') as f:
                for line in f:
                    if 'model name' in line.lower() or 'Model' in line:
                        info["model"] = line.split(':')[1].strip()
                        break
        except Exception:
            pass

        if PSUTIL_AVAILABLE:
            info["usage_percent"] = psutil.cpu_percent(interval=1)
            info["per_core"] = psutil.cpu_percent(interval=0, percpu=True)
            freq = psutil.cpu_freq()
            if freq:
                info["frequency_mhz"] = int(freq.current)

        info["load_average"] = list(os.getloadavg())
        return info

    def get_memory_info(self) -> dict:
        """Informazioni memoria RAM e swap."""
        if PSUTIL_AVAILABLE:
            mem = psutil.virtual_memory()
            swap = psutil.swap_memory()
            return {
                "ram": {
                    "total_mb": int(mem.total / 1024 / 1024),
                    "used_mb": int(mem.used / 1024 / 1024),
                    "available_mb": int(mem.available / 1024 / 1024),
                    "percent": mem.percent,
                    "cached_mb": int(getattr(mem, 'cached', 0) / 1024 / 1024),
                    "buffers_mb": int(getattr(mem, 'buffers', 0) / 1024 / 1024),
                },
                "swap": {
                    "total_mb": int(swap.total / 1024 / 1024),
                    "used_mb": int(swap.used / 1024 / 1024),
                    "free_mb": int(swap.free / 1024 / 1024),
                    "percent": swap.percent,
                }
            }
        else:
            # Fallback: leggi da /proc/meminfo
            meminfo = {}
            try:
                with open('/proc/meminfo') as f:
                    for line in f:
                        parts = line.split(':')
                        if len(parts) == 2:
                            key = parts[0].strip()
                            val = int(parts[1].strip().split()[0])  # kB
                            meminfo[key] = val
            except Exception:
                pass

            total = meminfo.get('MemTotal', 0) // 1024
            available = meminfo.get('MemAvailable', 0) // 1024
            used = total - available
            return {
                "ram": {
                    "total_mb": total,
                    "used_mb": used,
                    "available_mb": available,
                    "percent": round(used / total * 100, 1) if total > 0 else 0,
                },
                "swap": {
                    "total_mb": meminfo.get('SwapTotal', 0) // 1024,
                    "used_mb": (meminfo.get('SwapTotal', 0) - meminfo.get('SwapFree', 0)) // 1024,
                    "free_mb": meminfo.get('SwapFree', 0) // 1024,
                }
            }

    def get_temperature(self) -> dict:
        """Temperatura CPU/GPU."""
        temps = {"cpu": None, "gpu": None}

        # CPU via thermal zone
        try:
            temp_str = Path('/sys/class/thermal/thermal_zone0/temp').read_text().strip()
            temps["cpu"] = round(int(temp_str) / 1000.0, 1)
        except Exception:
            pass

        # GPU via vcgencmd
        try:
            result = subprocess.run(
                ['vcgencmd', 'measure_temp'],
                capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0:
                temp_val = result.stdout.strip().replace("temp=", "").replace("'C", "")
                temps["gpu"] = float(temp_val)
        except Exception:
            pass

        # Throttling status
        try:
            result = subprocess.run(
                ['vcgencmd', 'get_throttled'],
                capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0:
                throttle_hex = result.stdout.strip().split('=')[1]
                throttle_int = int(throttle_hex, 16)
                temps["throttled"] = {
                    "raw": throttle_hex,
                    "under_voltage": bool(throttle_int & 0x1),
                    "freq_capped": bool(throttle_int & 0x2),
                    "throttled": bool(throttle_int & 0x4),
                    "soft_temp_limit": bool(throttle_int & 0x8),
                }
        except Exception:
            pass

        return temps

    def get_disk_info(self) -> dict:
        """Informazioni dischi e partizioni."""
        disks = {}

        if PSUTIL_AVAILABLE:
            for part in psutil.disk_partitions():
                try:
                    usage = psutil.disk_usage(part.mountpoint)
                    disks[part.mountpoint] = {
                        "device": part.device,
                        "fstype": part.fstype,
                        "total_gb": round(usage.total / 1024**3, 1),
                        "used_gb": round(usage.used / 1024**3, 1),
                        "free_gb": round(usage.free / 1024**3, 1),
                        "percent": usage.percent,
                        "opts": part.opts,
                    }
                except (PermissionError, OSError):
                    pass
        else:
            try:
                result = subprocess.run(
                    ['df', '-h', '--output=source,target,fstype,size,used,avail,pcent'],
                    capture_output=True, text=True, timeout=10
                )
                for line in result.stdout.strip().split('\n')[1:]:
                    parts = line.split()
                    if len(parts) >= 7 and not parts[0].startswith('tmpfs'):
                        disks[parts[1]] = {
                            "device": parts[0],
                            "fstype": parts[2],
                            "total": parts[3],
                            "used": parts[4],
                            "free": parts[5],
                            "percent": float(parts[6].rstrip('%')),
                        }
            except Exception:
                pass

        return disks

    def get_network_info(self) -> dict:
        """Informazioni rete."""
        info = {"interfaces": {}, "connectivity": False}

        if PSUTIL_AVAILABLE:
            # Interfacce
            addrs = psutil.net_if_addrs()
            stats = psutil.net_if_stats()
            io = psutil.net_io_counters(pernic=True)

            for iface, addr_list in addrs.items():
                if iface == 'lo':
                    continue
                iface_info = {
                    "addresses": [],
                    "is_up": stats.get(iface, type('', (), {'isup': False})).isup,
                    "speed_mbps": getattr(stats.get(iface), 'speed', 0),
                }
                for addr in addr_list:
                    if addr.family.name in ('AF_INET', 'AF_INET6'):
                        iface_info["addresses"].append({
                            "family": addr.family.name,
                            "address": addr.address,
                            "netmask": addr.netmask,
                        })
                if iface in io:
                    iface_info["bytes_sent"] = io[iface].bytes_sent
                    iface_info["bytes_recv"] = io[iface].bytes_recv
                info["interfaces"][iface] = iface_info

        # Test connettivita'
        try:
            result = subprocess.run(
                ['ping', '-c', '1', '-W', '3', '8.8.8.8'],
                capture_output=True, timeout=5
            )
            info["connectivity"] = result.returncode == 0
        except Exception:
            info["connectivity"] = False

        return info

    def get_process_info(self, top_n: int = 10) -> list:
        """Top N processi per utilizzo memoria."""
        processes = []

        if PSUTIL_AVAILABLE:
            for proc in psutil.process_iter(['pid', 'name', 'memory_percent', 'cpu_percent', 'status']):
                try:
                    pinfo = proc.info
                    if pinfo['memory_percent'] and pinfo['memory_percent'] > 0.1:
                        processes.append(pinfo)
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass

            processes.sort(key=lambda x: x.get('memory_percent', 0), reverse=True)
            return processes[:top_n]

        return []

    def get_uptime(self) -> dict:
        """Uptime del sistema."""
        try:
            uptime_seconds = float(Path('/proc/uptime').read_text().split()[0])
            days = int(uptime_seconds // 86400)
            hours = int((uptime_seconds % 86400) // 3600)
            minutes = int((uptime_seconds % 3600) // 60)
            return {
                "seconds": int(uptime_seconds),
                "human": f"{days}d {hours}h {minutes}m",
                "boot_time": datetime.fromtimestamp(
                    time.time() - uptime_seconds
                ).isoformat()
            }
        except Exception:
            return {"seconds": 0, "human": "N/A"}

    def get_full_report(self) -> dict:
        """Report completo del sistema."""
        report = {
            "timestamp": datetime.now().isoformat(),
            "hostname": platform.node(),
            "os": f"{platform.system()} {platform.release()}",
            "uptime": self.get_uptime(),
            "cpu": self.get_cpu_info(),
            "memory": self.get_memory_info(),
            "temperature": self.get_temperature(),
            "disks": self.get_disk_info(),
            "network": self.get_network_info(),
            "top_processes": self.get_process_info(),
        }

        # Salva in cronologia
        self.history.append({
            "timestamp": report["timestamp"],
            "cpu_percent": report["cpu"]["usage_percent"],
            "mem_percent": report["memory"]["ram"]["percent"],
            "temp_cpu": report["temperature"]["cpu"],
        })
        if len(self.history) > self.max_history:
            self.history.pop(0)

        return report

    def check_alerts(self) -> list:
        """Controlla se ci sono condizioni di alert."""
        alerts = []
        report = self.get_full_report()

        # Temperatura
        temp = report["temperature"].get("cpu")
        if temp is not None:
            if temp >= self.thresholds.temp_critical:
                alerts.append({
                    "level": "CRITICAL", "type": "temperature",
                    "message": f"Temperatura CPU CRITICA: {temp}°C",
                    "value": temp, "threshold": self.thresholds.temp_critical
                })
            elif temp >= self.thresholds.temp_warn:
                alerts.append({
                    "level": "WARNING", "type": "temperature",
                    "message": f"Temperatura CPU alta: {temp}°C",
                    "value": temp, "threshold": self.thresholds.temp_warn
                })

        # Memoria
        mem_pct = report["memory"]["ram"]["percent"]
        if mem_pct >= self.thresholds.mem_critical:
            alerts.append({
                "level": "CRITICAL", "type": "memory",
                "message": f"Memoria RAM CRITICA: {mem_pct}%",
                "value": mem_pct, "threshold": self.thresholds.mem_critical
            })
        elif mem_pct >= self.thresholds.mem_warn:
            alerts.append({
                "level": "WARNING", "type": "memory",
                "message": f"Memoria RAM alta: {mem_pct}%",
                "value": mem_pct, "threshold": self.thresholds.mem_warn
            })

        # Disco
        for mount, disk in report["disks"].items():
            pct = disk.get("percent", 0)
            if pct >= self.thresholds.disk_critical:
                alerts.append({
                    "level": "CRITICAL", "type": "disk",
                    "message": f"Disco {mount} CRITICO: {pct}%",
                    "value": pct, "mount": mount, "threshold": self.thresholds.disk_critical
                })
            elif pct >= self.thresholds.disk_warn:
                alerts.append({
                    "level": "WARNING", "type": "disk",
                    "message": f"Disco {mount} quasi pieno: {pct}%",
                    "value": pct, "mount": mount, "threshold": self.thresholds.disk_warn
                })

        # CPU
        cpu_pct = report["cpu"]["usage_percent"]
        if cpu_pct >= self.thresholds.cpu_critical:
            alerts.append({
                "level": "CRITICAL", "type": "cpu",
                "message": f"CPU CRITICA: {cpu_pct}%",
                "value": cpu_pct, "threshold": self.thresholds.cpu_critical
            })

        # Connettivita'
        if not report["network"]["connectivity"]:
            alerts.append({
                "level": "WARNING", "type": "network",
                "message": "Connettivita' internet assente"
            })

        # Throttling
        throttle = report["temperature"].get("throttled", {})
        if throttle.get("under_voltage"):
            alerts.append({
                "level": "CRITICAL", "type": "power",
                "message": "Sotto-tensione rilevata! Alimentatore insufficiente."
            })
        if throttle.get("throttled"):
            alerts.append({
                "level": "WARNING", "type": "throttle",
                "message": "CPU throttling attivo (temperatura o voltaggio)"
            })

        return alerts


def format_report(report: dict) -> str:
    """Formatta report per output terminale."""
    lines = []
    lines.append("=" * 60)
    lines.append(f"  PiClaw System Report - {report['timestamp']}")
    lines.append(f"  Host: {report['hostname']} | OS: {report['os']}")
    lines.append(f"  Uptime: {report['uptime']['human']}")
    lines.append("=" * 60)

    # CPU
    cpu = report['cpu']
    lines.append(f"\n  CPU: {cpu['model']}")
    lines.append(f"  Cores: {cpu['cores']} | Usage: {cpu['usage_percent']}% | Freq: {cpu['frequency_mhz']}MHz")
    lines.append(f"  Load: {' '.join(f'{l:.2f}' for l in cpu['load_average'])}")

    # Memoria
    mem = report['memory']
    ram = mem['ram']
    swap = mem['swap']
    lines.append(f"\n  RAM: {ram['used_mb']}MB / {ram['total_mb']}MB ({ram['percent']}%)")
    lines.append(f"  Swap: {swap['used_mb']}MB / {swap['total_mb']}MB")

    # Temperatura
    temp = report['temperature']
    temp_str = f"CPU: {temp['cpu']}°C" if temp['cpu'] else "N/A"
    if temp.get('gpu'):
        temp_str += f" | GPU: {temp['gpu']}°C"
    lines.append(f"\n  Temperatura: {temp_str}")

    # Dischi
    lines.append("\n  Dischi:")
    for mount, disk in report['disks'].items():
        if isinstance(disk.get('total_gb'), (int, float)):
            lines.append(f"    {mount}: {disk['used_gb']}/{disk['total_gb']}GB ({disk['percent']}%)")
        else:
            lines.append(f"    {mount}: {disk.get('used', '?')}/{disk.get('total', '?')} ({disk.get('percent', '?')}%)")

    # Rete
    net = report['network']
    lines.append(f"\n  Rete: {'Online' if net['connectivity'] else 'OFFLINE'}")
    for iface, info in net.get('interfaces', {}).items():
        addrs = [a['address'] for a in info.get('addresses', []) if a['family'] == 'AF_INET']
        if addrs:
            status = "UP" if info.get('is_up') else "DOWN"
            lines.append(f"    {iface}: {addrs[0]} ({status})")

    lines.append("\n" + "=" * 60)
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description='PiClaw System Monitor')
    parser.add_argument('--json', action='store_true', help='Output JSON')
    parser.add_argument('--alert', action='store_true', help='Mostra solo alert')
    parser.add_argument('--watch', type=int, metavar='SECONDS', help='Monitoring continuo')
    parser.add_argument('--compact', action='store_true', help='Output compatto')

    args = parser.parse_args()
    monitor = SystemMonitor()

    if args.alert:
        alerts = monitor.check_alerts()
        if args.json:
            print(json.dumps(alerts, indent=2))
        elif alerts:
            for alert in alerts:
                print(f"  [{alert['level']}] {alert['message']}")
        else:
            print("  Nessun alert attivo")
        return

    if args.watch:
        try:
            while True:
                os.system('clear' if os.name == 'posix' else 'cls')
                if args.json:
                    print(json.dumps(monitor.get_full_report(), indent=2))
                else:
                    print(format_report(monitor.get_full_report()))

                # Alert
                alerts = monitor.check_alerts()
                if alerts:
                    print("\n  ⚠ ALERT:")
                    for alert in alerts:
                        print(f"    [{alert['level']}] {alert['message']}")

                time.sleep(args.watch)
        except KeyboardInterrupt:
            print("\nMonitoring terminato.")
    else:
        report = monitor.get_full_report()
        if args.json:
            print(json.dumps(report, indent=2))
        else:
            print(format_report(report))


if __name__ == '__main__':
    main()
