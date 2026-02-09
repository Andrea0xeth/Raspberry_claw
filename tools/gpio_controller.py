#!/usr/bin/env python3
"""
PiClaw GPIO Controller
Controllo avanzato GPIO pins del Raspberry Pi 4 via Python.
Supporta: Digital I/O, PWM, I2C scan, eventi.

Uso standalone:
    python3 gpio_controller.py --pin 17 --action read
    python3 gpio_controller.py --pin 18 --action pwm --value 50
    python3 gpio_controller.py --action i2c-scan

Uso come modulo:
    from gpio_controller import GPIOController
    ctrl = GPIOController()
    ctrl.digital_read(17)
    ctrl.digital_write(17, 1)
    ctrl.pwm_start(18, frequency=1000, duty_cycle=50)
"""

import argparse
import json
import logging
import signal
import sys
import time
from pathlib import Path

# Configurazione logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('/data/logs/gpio.log', mode='a'),
    ]
)
logger = logging.getLogger('PiClaw.GPIO')

# Prova importazione librerie GPIO (fallback graceful se non su RPi)
GPIO_AVAILABLE = False
GPIOZERO_AVAILABLE = False
SMBUS_AVAILABLE = False

try:
    import RPi.GPIO as GPIO
    GPIO_AVAILABLE = True
except ImportError:
    logger.warning("RPi.GPIO non disponibile (non su Raspberry Pi?)")

try:
    from gpiozero import LED, Button, PWMOutputDevice, DigitalInputDevice
    GPIOZERO_AVAILABLE = True
except ImportError:
    logger.warning("gpiozero non disponibile")

try:
    import smbus2
    SMBUS_AVAILABLE = True
except ImportError:
    logger.warning("smbus2 non disponibile")


class GPIOController:
    """Controller GPIO completo per Raspberry Pi 4."""

    # Pin BCM disponibili su RPi4 (40-pin header)
    VALID_PINS = list(range(2, 28))  # BCM 2-27
    PWM_PINS = [12, 13, 18, 19]     # Hardware PWM

    def __init__(self, mode: str = 'BCM'):
        """
        Inizializza controller GPIO.

        Args:
            mode: 'BCM' per numerazione Broadcom, 'BOARD' per pin fisici
        """
        self.mode = mode
        self.active_pins = {}
        self.pwm_instances = {}
        self._setup_gpio()

        # Cleanup su uscita
        signal.signal(signal.SIGINT, self._cleanup_handler)
        signal.signal(signal.SIGTERM, self._cleanup_handler)

    def _setup_gpio(self):
        """Configura GPIO mode."""
        if GPIO_AVAILABLE:
            GPIO.setwarnings(False)
            if self.mode == 'BCM':
                GPIO.setmode(GPIO.BCM)
            else:
                GPIO.setmode(GPIO.BOARD)
            logger.info(f"GPIO inizializzato in modalita' {self.mode}")
        else:
            logger.warning("GPIO hardware non disponibile, modalita' simulazione")

    def _validate_pin(self, pin: int) -> bool:
        """Valida numero pin BCM."""
        if pin not in self.VALID_PINS:
            raise ValueError(f"Pin {pin} non valido. Pin disponibili: {self.VALID_PINS}")
        return True

    def digital_read(self, pin: int) -> dict:
        """
        Leggi valore digitale da un pin.

        Args:
            pin: Numero pin BCM

        Returns:
            dict con risultato lettura
        """
        self._validate_pin(pin)
        logger.info(f"Lettura digitale pin {pin}")

        if GPIO_AVAILABLE:
            GPIO.setup(pin, GPIO.IN)
            value = GPIO.input(pin)
            self.active_pins[pin] = 'IN'
            return {"success": True, "pin": pin, "value": value, "direction": "IN"}
        else:
            # Fallback sysfs
            try:
                # Export pin
                Path('/sys/class/gpio/export').write_text(str(pin))
            except OSError:
                pass  # Gia' esportato

            try:
                Path(f'/sys/class/gpio/gpio{pin}/direction').write_text('in')
                value = int(Path(f'/sys/class/gpio/gpio{pin}/value').read_text().strip())
                return {"success": True, "pin": pin, "value": value, "direction": "IN", "method": "sysfs"}
            except Exception as e:
                return {"success": False, "pin": pin, "error": str(e)}

    def digital_write(self, pin: int, value: int) -> dict:
        """
        Scrivi valore digitale su un pin.

        Args:
            pin: Numero pin BCM
            value: 0 (LOW) o 1 (HIGH)

        Returns:
            dict con risultato scrittura
        """
        self._validate_pin(pin)
        value = 1 if value else 0
        logger.info(f"Scrittura digitale pin {pin} = {value}")

        if GPIO_AVAILABLE:
            GPIO.setup(pin, GPIO.OUT)
            GPIO.output(pin, value)
            self.active_pins[pin] = 'OUT'
            return {"success": True, "pin": pin, "value": value, "direction": "OUT"}
        else:
            try:
                try:
                    Path('/sys/class/gpio/export').write_text(str(pin))
                except OSError:
                    pass
                Path(f'/sys/class/gpio/gpio{pin}/direction').write_text('out')
                Path(f'/sys/class/gpio/gpio{pin}/value').write_text(str(value))
                return {"success": True, "pin": pin, "value": value, "direction": "OUT", "method": "sysfs"}
            except Exception as e:
                return {"success": False, "pin": pin, "error": str(e)}

    def pwm_start(self, pin: int, frequency: int = 1000, duty_cycle: float = 50.0) -> dict:
        """
        Avvia PWM su un pin.

        Args:
            pin: Numero pin BCM (preferibilmente 12, 13, 18, 19 per HW PWM)
            frequency: Frequenza in Hz
            duty_cycle: Duty cycle 0-100

        Returns:
            dict con risultato
        """
        self._validate_pin(pin)
        duty_cycle = max(0, min(100, duty_cycle))
        logger.info(f"PWM pin {pin}: freq={frequency}Hz, duty={duty_cycle}%")

        if GPIO_AVAILABLE:
            GPIO.setup(pin, GPIO.OUT)
            pwm = GPIO.PWM(pin, frequency)
            pwm.start(duty_cycle)
            self.pwm_instances[pin] = pwm
            self.active_pins[pin] = 'PWM'
            return {
                "success": True, "pin": pin, "mode": "PWM",
                "frequency": frequency, "duty_cycle": duty_cycle
            }
        elif GPIOZERO_AVAILABLE:
            device = PWMOutputDevice(pin, frequency=frequency)
            device.value = duty_cycle / 100.0
            self.pwm_instances[pin] = device
            return {
                "success": True, "pin": pin, "mode": "PWM",
                "frequency": frequency, "duty_cycle": duty_cycle,
                "method": "gpiozero"
            }
        else:
            return {"success": False, "error": "Nessuna libreria PWM disponibile"}

    def pwm_stop(self, pin: int) -> dict:
        """Ferma PWM su un pin."""
        if pin in self.pwm_instances:
            try:
                self.pwm_instances[pin].stop()
            except AttributeError:
                self.pwm_instances[pin].close()
            del self.pwm_instances[pin]
            if pin in self.active_pins:
                del self.active_pins[pin]
            return {"success": True, "pin": pin, "pwm": "stopped"}
        return {"success": False, "error": f"Nessun PWM attivo su pin {pin}"}

    def i2c_scan(self, bus: int = 1) -> dict:
        """
        Scansiona dispositivi I2C.

        Args:
            bus: Numero bus I2C (default 1)

        Returns:
            dict con lista indirizzi trovati
        """
        logger.info(f"I2C scan bus {bus}")

        if SMBUS_AVAILABLE:
            try:
                bus_obj = smbus2.SMBus(bus)
                devices = []
                for addr in range(0x03, 0x78):
                    try:
                        bus_obj.read_byte(addr)
                        devices.append({"address": hex(addr), "decimal": addr})
                    except OSError:
                        pass
                bus_obj.close()
                return {
                    "success": True, "bus": bus,
                    "devices": devices, "count": len(devices)
                }
            except Exception as e:
                return {"success": False, "error": str(e)}
        else:
            # Fallback: usa i2cdetect
            import subprocess
            try:
                result = subprocess.run(
                    ['i2cdetect', '-y', str(bus)],
                    capture_output=True, text=True, timeout=10
                )
                return {
                    "success": True, "bus": bus,
                    "output": result.stdout, "method": "i2cdetect"
                }
            except Exception as e:
                return {"success": False, "error": str(e)}

    def i2c_read(self, bus: int, address: int, register: int, length: int = 1) -> dict:
        """Leggi da dispositivo I2C."""
        if SMBUS_AVAILABLE:
            try:
                bus_obj = smbus2.SMBus(bus)
                if length == 1:
                    data = bus_obj.read_byte_data(address, register)
                else:
                    data = bus_obj.read_i2c_block_data(address, register, length)
                bus_obj.close()
                return {
                    "success": True, "bus": bus, "address": hex(address),
                    "register": hex(register), "data": data
                }
            except Exception as e:
                return {"success": False, "error": str(e)}
        return {"success": False, "error": "smbus2 non disponibile"}

    def i2c_write(self, bus: int, address: int, register: int, data: int) -> dict:
        """Scrivi su dispositivo I2C."""
        if SMBUS_AVAILABLE:
            try:
                bus_obj = smbus2.SMBus(bus)
                bus_obj.write_byte_data(address, register, data)
                bus_obj.close()
                return {
                    "success": True, "bus": bus, "address": hex(address),
                    "register": hex(register), "data": data
                }
            except Exception as e:
                return {"success": False, "error": str(e)}
        return {"success": False, "error": "smbus2 non disponibile"}

    def get_pin_status(self) -> dict:
        """Ritorna stato di tutti i pin attivi."""
        return {
            "success": True,
            "active_pins": self.active_pins,
            "pwm_active": list(self.pwm_instances.keys()),
            "gpio_available": GPIO_AVAILABLE,
            "gpiozero_available": GPIOZERO_AVAILABLE,
            "smbus_available": SMBUS_AVAILABLE
        }

    def cleanup(self):
        """Pulisci tutte le risorse GPIO."""
        logger.info("Cleanup GPIO...")
        for pin, pwm in list(self.pwm_instances.items()):
            try:
                pwm.stop()
            except (AttributeError, RuntimeError):
                try:
                    pwm.close()
                except Exception:
                    pass
        self.pwm_instances.clear()
        self.active_pins.clear()

        if GPIO_AVAILABLE:
            GPIO.cleanup()
        logger.info("GPIO cleanup completato")

    def _cleanup_handler(self, signum, frame):
        """Handler per segnali di terminazione."""
        self.cleanup()
        sys.exit(0)


def main():
    """CLI per GPIO controller."""
    parser = argparse.ArgumentParser(description='PiClaw GPIO Controller')
    parser.add_argument('--pin', type=int, help='Numero pin BCM (2-27)')
    parser.add_argument('--action', required=True,
                        choices=['read', 'write', 'pwm', 'pwm-stop', 'i2c-scan',
                                 'i2c-read', 'i2c-write', 'status', 'cleanup'],
                        help='Azione da eseguire')
    parser.add_argument('--value', type=float, help='Valore (0/1 per write, 0-100 per PWM)')
    parser.add_argument('--frequency', type=int, default=1000, help='Frequenza PWM (Hz)')
    parser.add_argument('--bus', type=int, default=1, help='Bus I2C')
    parser.add_argument('--address', type=lambda x: int(x, 0), help='Indirizzo I2C (hex)')
    parser.add_argument('--register', type=lambda x: int(x, 0), help='Registro I2C (hex)')
    parser.add_argument('--json', action='store_true', help='Output JSON')

    args = parser.parse_args()
    ctrl = GPIOController()

    try:
        if args.action == 'read':
            if not args.pin:
                print("Errore: --pin richiesto per read")
                sys.exit(1)
            result = ctrl.digital_read(args.pin)

        elif args.action == 'write':
            if not args.pin or args.value is None:
                print("Errore: --pin e --value richiesti per write")
                sys.exit(1)
            result = ctrl.digital_write(args.pin, int(args.value))

        elif args.action == 'pwm':
            if not args.pin:
                print("Errore: --pin richiesto per pwm")
                sys.exit(1)
            duty = args.value if args.value is not None else 50.0
            result = ctrl.pwm_start(args.pin, args.frequency, duty)

        elif args.action == 'pwm-stop':
            if not args.pin:
                print("Errore: --pin richiesto per pwm-stop")
                sys.exit(1)
            result = ctrl.pwm_stop(args.pin)

        elif args.action == 'i2c-scan':
            result = ctrl.i2c_scan(args.bus)

        elif args.action == 'i2c-read':
            if not all([args.address, args.register]):
                print("Errore: --address e --register richiesti per i2c-read")
                sys.exit(1)
            result = ctrl.i2c_read(args.bus, args.address, args.register)

        elif args.action == 'i2c-write':
            if not all([args.address, args.register, args.value is not None]):
                print("Errore: --address, --register e --value richiesti per i2c-write")
                sys.exit(1)
            result = ctrl.i2c_write(args.bus, args.address, args.register, int(args.value))

        elif args.action == 'status':
            result = ctrl.get_pin_status()

        elif args.action == 'cleanup':
            ctrl.cleanup()
            result = {"success": True, "action": "cleanup"}

        else:
            result = {"success": False, "error": f"Azione sconosciuta: {args.action}"}

        if args.json:
            print(json.dumps(result, indent=2))
        else:
            for key, value in result.items():
                print(f"  {key}: {value}")

    except Exception as e:
        error_result = {"success": False, "error": str(e)}
        if args.json:
            print(json.dumps(error_result, indent=2))
        else:
            print(f"Errore: {e}")
        sys.exit(1)
    finally:
        ctrl.cleanup()


if __name__ == '__main__':
    main()
