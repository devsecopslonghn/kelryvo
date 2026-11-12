"""Private loopback proxy control for the opt-in isolated Oracle fixture only."""
import argparse
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys

sys.dont_write_bytecode = True


def sibling_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def serve(root):
    assert os.getuid() == 0 and socket.gethostname() == 'kelryvo-oracle-fixture'
    assert root.is_absolute() and root.name == 'native-oracle-fixture' and root.parent.name == '.cache'
    private = root / 'private'
    assert private.stat().st_uid == 0 and private.stat().st_mode & 0o777 == 0o700
    guard = sibling_module('installed_guard', 'test-rust-installed-oracle.py')
    network = [json.loads(subprocess.check_output(['/usr/sbin/ip', '-j', *args]))
               for args in (['-d', 'link'], ['address'], ['route', 'show', 'table', 'all'])]
    guard.require_isolated_network(*network)
    transport = sibling_module('ack_proxy', 'oracle-ack-proxy.py')
    proxy = transport.AckProxy()
    await proxy.start()
    proxy.pass_responses()
    stop = asyncio.Event()

    async def request(reader, writer):
        try:
            raw = await asyncio.wait_for(reader.readline(), 2)
            assert len(raw) < 2048
            value = json.loads(raw)
            operation, result = value['op'], {}
            if operation == 'snapshot':
                result = proxy.snapshot()
            elif operation == 'arm':
                proxy.arm(value['port'])
            elif operation == 'cut':
                result = proxy.cut_pending_response(value['port'], int(value['afterNs']))
            elif operation == 'pass':
                proxy.pass_responses()
            elif operation == 'stop':
                stop.set()
            else:
                raise ValueError('Unsupported fixture operation')
            response = {'ok': True, 'result': transport.exact_clock_json(result)}
        except Exception as error:
            response = {'ok': False, 'error': type(error).__name__}
        try:
            writer.write(json.dumps(response).encode() + b'\n')
            await writer.drain()
        except OSError:
            pass
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except OSError:
                pass

    control_path = private / 'proxy-control.sock'
    server = await asyncio.start_unix_server(request, control_path, limit=2048)
    control_path.chmod(0o600)
    try:
        await stop.wait()
    finally:
        server.close()
        await server.wait_closed()
        await proxy.close()
        control_path.unlink()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('fixture_root', type=Path)
    asyncio.run(serve(parser.parse_args().fixture_root.resolve()))
