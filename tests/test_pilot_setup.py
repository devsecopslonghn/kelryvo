import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout

spec = importlib.util.spec_from_file_location('pilot', Path(__file__).resolve().parents[1] / 'scripts/pilot.py')
pilot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pilot)


class PilotSetupTests(unittest.TestCase):
    def test_private_configuration_is_exclusive_and_never_starts_services(self):
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp) / 'installation'
            cert, key = Path(temp) / 'cert', Path(temp) / 'key'
            cert.write_text('TEST CERTIFICATE\n')
            key.write_text('PRIVATE_KEY_CANARY\n')
            output = io.StringIO()
            with patch.object(pilot.os, 'geteuid', return_value=0), patch.object(pilot.os, 'chown'), redirect_stdout(output):
                pilot.prepare(home, 'kelryvo:pilot-2026-11-08', cert=cert, key=key)
                self.assertEqual((home / 'secrets/tls.key').stat().st_mode & 0o777, 0o400)
                self.assertEqual((home / 'pilot.env').stat().st_mode & 0o777, 0o600)
                self.assertEqual(home.stat().st_mode & 0o777, 0o700)
                self.assertNotEqual((home / 'secrets/developer-token').read_text(), (home / 'secrets/approver-token').read_text())
                self.assertIn('NOSUPERUSER NOCREATEDB', (home / 'init/10-app.sh').read_text())
                self.assertIn('Services have not been started', output.getvalue())
                self.assertNotIn('PRIVATE_KEY_CANARY', output.getvalue())
                with self.assertRaises(ValueError):
                    pilot.prepare(home, 'kelryvo:pilot-2026-11-08')
                self.assertEqual((home / 'secrets/tls.key').read_text(), 'PRIVATE_KEY_CANARY\n')

    def test_invalid_inputs_and_unprivileged_setup_do_not_create_an_installation(self):
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp) / 'installation'
            with patch.object(pilot.os, 'geteuid', return_value=1000), self.assertRaises(ValueError):
                pilot.prepare(home, 'kelryvo:pilot')
            with patch.object(pilot.os, 'geteuid', return_value=0):
                for image in ['image\nEVIL=1', 'image $(command)', '']:
                    with self.assertRaises(ValueError):
                        pilot.prepare(home, image)
                with self.assertRaises(ValueError):
                    pilot.prepare(home, 'kelryvo:pilot', cert='/private/cert')
            self.assertFalse(home.exists())


if __name__ == '__main__':
    unittest.main()
