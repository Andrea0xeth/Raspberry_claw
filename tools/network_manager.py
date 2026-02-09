#!/usr/bin/env python3
"""
PiClaw Network Manager
Gestione e diagnostica rete per Raspberry Pi 4.

Uso standalone:
    python3 network_manager.py --action status
    python3 network_manager.py --action scan-wifi
    python3 network_manager.py --action ping --target 8.8.8.8
    python3 network_manager.py --action ports
    python3 network_manager.py --action dns --target example.com

Uso come modulo:
    from network_manager import NetworkManager
    nm = NetworkManager()
    nm.get_status()
    nm.check_connectivity()
"""

import argparse
import json
import logging
import re
import socket
import subprocess
from typing import Optional

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger('PiClaw.Network')


class NetworkManager:
    """Gestore rete completo per Raspberry Pi 4."""

    def get_status(self) -> dict:
        """Stato completo della rete."""
        return {
            "interfaces": self._get_interfaces(),
            "connectivity": self.check_connectivity(),
            "dns": self._get_dns_servers(),
            "gateway": self._get_default_gateway(),
            "hostname": socket.gethostname(),
            "fqdn": socket.getfqdn(),
        }

    def _get_interfaces(self) -> dict:
        """Lista interfacce di rete con dettagli."""
        interfaces = {}
        try:
            result = subprocess.run(
                ['ip', '-j', 'addr', 'show'],
                capture_output=True, text=True, timeout=10
            )
            if result.returncode == 0:
                ifaces = json.loads(result.stdout)
                for iface in ifaces:
                    name = iface.get('ifname', '')
                    if name == 'lo':
                        continue
                    info = {
                        "state": iface.get('operstate', 'UNKNOWN'),
                        "mac": iface.get('address', ''),
                        "mtu": iface.get('mtu', 0),
                        "addresses": [],
                    }
                    for addr_info in iface.get('addr_info', []):
                        info["addresses"].append({
                            "family": addr_info.get('family', ''),
                            "address": addr_info.get('local', ''),
                            "prefix_len": addr_info.get('prefixlen', 0),
                        })
                    interfaces[name] = info
        except Exception as e:
            logger.error(f"Errore lettura interfacce: {e}")

        return interfaces

    def _get_dns_servers(self) -> list:
        """Lista server DNS configurati."""
        servers = []
        try:
            with open('/etc/resolv.conf') as f:
                for line in f:
                    if line.startswith('nameserver'):
                        servers.append(line.split()[1])
        except Exception:
            pass
        return servers

    def _get_default_gateway(self) -> Optional[str]:
        """Gateway predefinito."""
        try:
            result = subprocess.run(
                ['ip', 'route', 'show', 'default'],
                capture_output=True, text=True, timeout=5
            )
            match = re.search(r'default via (\S+)', result.stdout)
            if match:
                return match.group(1)
        except Exception:
            pass
        return None

    def check_connectivity(self, hosts: Optional[list] = None) -> dict:
        """Test connettivita' internet."""
        targets = hosts or ['8.8.8.8', '1.1.1.1', 'google.com']
        results = {}

        for host in targets:
            try:
                result = subprocess.run(
                    ['ping', '-c', '3', '-W', '3', host],
                    capture_output=True, text=True, timeout=15
                )
                if result.returncode == 0:
                    # Estrai statistiche
                    stats_match = re.search(
                        r'(\d+) packets transmitted, (\d+) received.*time (\d+)ms',
                        result.stdout
                    )
                    rtt_match = re.search(
                        r'rtt min/avg/max/mdev = ([\d.]+)/([\d.]+)/([\d.]+)/([\d.]+)',
                        result.stdout
                    )
                    results[host] = {
                        "reachable": True,
                        "packets_sent": int(stats_match.group(1)) if stats_match else 3,
                        "packets_received": int(stats_match.group(2)) if stats_match else 0,
                        "avg_ms": float(rtt_match.group(2)) if rtt_match else None,
                        "min_ms": float(rtt_match.group(1)) if rtt_match else None,
                        "max_ms": float(rtt_match.group(3)) if rtt_match else None,
                    }
                else:
                    results[host] = {"reachable": False, "error": "timeout"}
            except subprocess.TimeoutExpired:
                results[host] = {"reachable": False, "error": "timeout"}
            except Exception as e:
                results[host] = {"reachable": False, "error": str(e)}

        return {
            "online": any(r.get("reachable") for r in results.values()),
            "results": results
        }

    def ping(self, target: str, count: int = 4) -> dict:
        """Ping specifico host."""
        try:
            result = subprocess.run(
                ['ping', '-c', str(count), '-W', '5', target],
                capture_output=True, text=True, timeout=30
            )
            return {
                "success": result.returncode == 0,
                "target": target,
                "output": result.stdout.strip(),
            }
        except Exception as e:
            return {"success": False, "target": target, "error": str(e)}

    def get_listening_ports(self) -> list:
        """Lista porte in ascolto."""
        ports = []
        try:
            result = subprocess.run(
                ['ss', '-tlnp'],
                capture_output=True, text=True, timeout=10
            )
            for line in result.stdout.strip().split('\n')[1:]:
                parts = line.split()
                if len(parts) >= 5:
                    local = parts[3]
                    process = parts[6] if len(parts) > 6 else ''
                    ports.append({
                        "local_address": local,
                        "state": parts[0],
                        "process": process,
                    })
        except Exception as e:
            logger.error(f"Errore lettura porte: {e}")

        return ports

    def dns_lookup(self, domain: str) -> dict:
        """Risoluzione DNS."""
        try:
            result = subprocess.run(
                ['dig', '+short', domain],
                capture_output=True, text=True, timeout=10
            )
            addresses = [l.strip() for l in result.stdout.strip().split('\n') if l.strip()]
            return {"success": True, "domain": domain, "addresses": addresses}
        except FileNotFoundError:
            # Fallback Python
            try:
                addrs = socket.getaddrinfo(domain, None)
                unique = list(set(a[4][0] for a in addrs))
                return {"success": True, "domain": domain, "addresses": unique}
            except Exception as e:
                return {"success": False, "domain": domain, "error": str(e)}
        except Exception as e:
            return {"success": False, "domain": domain, "error": str(e)}

    def scan_wifi(self) -> dict:
        """Scansione reti WiFi disponibili."""
        try:
            result = subprocess.run(
                ['sudo', 'iwlist', 'wlan0', 'scan'],
                capture_output=True, text=True, timeout=30
            )
            networks = []
            current = {}
            for line in result.stdout.split('\n'):
                line = line.strip()
                if 'Cell' in line and 'Address' in line:
                    if current:
                        networks.append(current)
                    current = {"mac": line.split('Address:')[1].strip() if 'Address:' in line else ''}
                elif 'ESSID' in line:
                    current["ssid"] = line.split('"')[1] if '"' in line else ''
                elif 'Quality' in line:
                    match = re.search(r'Quality=(\d+)/(\d+)', line)
                    if match:
                        current["quality"] = f"{match.group(1)}/{match.group(2)}"
                        current["quality_pct"] = round(int(match.group(1)) / int(match.group(2)) * 100)
                    sig_match = re.search(r'Signal level=(-?\d+)', line)
                    if sig_match:
                        current["signal_dbm"] = int(sig_match.group(1))
                elif 'Encryption key' in line:
                    current["encrypted"] = 'on' in line.lower()

            if current:
                networks.append(current)

            return {"success": True, "networks": networks, "count": len(networks)}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_firewall_status(self) -> dict:
        """Stato firewall UFW."""
        try:
            result = subprocess.run(
                ['sudo', 'ufw', 'status', 'verbose'],
                capture_output=True, text=True, timeout=10
            )
            return {
                "success": True,
                "output": result.stdout.strip(),
                "active": 'active' in result.stdout.lower() and 'inactive' not in result.stdout.lower()
            }
        except Exception as e:
            return {"success": False, "error": str(e)}


def main():
    parser = argparse.ArgumentParser(description='PiClaw Network Manager')
    parser.add_argument('--action', required=True,
                        choices=['status', 'ping', 'ports', 'dns', 'scan-wifi',
                                 'connectivity', 'firewall'],
                        help='Azione da eseguire')
    parser.add_argument('--target', help='Target (host/domain)')
    parser.add_argument('--json', action='store_true', help='Output JSON')

    args = parser.parse_args()
    nm = NetworkManager()

    if args.action == 'status':
        result = nm.get_status()
    elif args.action == 'ping':
        result = nm.ping(args.target or '8.8.8.8')
    elif args.action == 'ports':
        result = {"ports": nm.get_listening_ports()}
    elif args.action == 'dns':
        result = nm.dns_lookup(args.target or 'google.com')
    elif args.action == 'scan-wifi':
        result = nm.scan_wifi()
    elif args.action == 'connectivity':
        result = nm.check_connectivity()
    elif args.action == 'firewall':
        result = nm.get_firewall_status()
    else:
        result = {"error": f"Azione sconosciuta: {args.action}"}

    if args.json:
        print(json.dumps(result, indent=2, default=str))
    else:
        print(json.dumps(result, indent=2, default=str))


if __name__ == '__main__':
    main()
