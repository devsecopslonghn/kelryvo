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
    def test_grants_are_explicit_and_preserve_separate_authorities(self):
        project = '00000000-0000-4000-8000-000000000001'
        prefix = ['exec', '-T', 'kelryvo', 'node', 'scripts/container-membership.mjs']
        with patch.object(pilot, 'compose') as compose:
            pilot.main(['database-grant', '--directory', '/srv/kelryvo-pilot'])
            compose.assert_called_once_with('/srv/kelryvo-pilot', [*prefix, 'database-grant', 'kelryvo-developer'])
            compose.reset_mock()
            pilot.main(['deploy-grant', '--directory', '/srv/kelryvo-pilot', '--project', project])
            compose.assert_called_once_with('/srv/kelryvo-pilot', [*prefix, 'deploy-grant', project, 'kelryvo-developer'])
            compose.reset_mock()
            pilot.main(['grant', '--directory', '/srv/kelryvo-pilot', '--project', project])
            self.assertEqual([call.args[1] for call in compose.call_args_list], [
                [*prefix, 'grant', project, 'kelryvo-developer'],
                [*prefix, 'grant', project, 'kelryvo-approver'],
            ])
            compose.reset_mock()
            with self.assertRaises(ValueError):
                pilot.main(['deploy-grant', '--directory', '/srv/kelryvo-pilot', '--project', 'not-a-uuid'])
            compose.assert_not_called()

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
                self.assertEqual((home / 'vault/oracle-vault-private.pem').stat().st_mode & 0o777, 0o400)
                self.assertEqual((home / 'secrets/oracle-vault-public.pem').stat().st_mode & 0o777, 0o400)
                self.assertIn('BEGIN PUBLIC KEY', (home / 'secrets/oracle-vault-public.pem').read_text())
                self.assertNotIn('PRIVATE KEY', (home / 'secrets/oracle-vault-public.pem').read_text())
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
