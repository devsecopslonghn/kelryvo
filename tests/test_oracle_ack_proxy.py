import asyncio
import copy
import importlib.util
from pathlib import Path
import sys
import time
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('oracle_ack_proxy', Path(__file__).resolve().parents[1] / 'scripts/oracle-ack-proxy.py')
proxy_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proxy_module)
spec = importlib.util.spec_from_file_location('installed_oracle', Path(__file__).resolve().parents[1] / 'scripts/test-rust-installed-oracle.py')
installed_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installed_module)


class FixtureNetworkTests(unittest.TestCase):
    def test_fixture_schema_scope_is_closed(self):
        self.assertEqual(installed_module.fixture_schemas({}), ('KRV_APP', ['KRV_APP']))
        marker = {'schemaOwner': 'KRV_ACK', 'readerSchemas': ['KRV_ACK', 'KRV_APP']}
        self.assertEqual(installed_module.fixture_schemas(marker), ('KRV_ACK', ['KRV_ACK', 'KRV_APP']))
        for value in ({'schemaOwner': 'SYS'}, {'readerSchemas': ['KRV_APP', 'SYS']},
                      {'schemaOwner': 'KRV_ACK'}, {'readerSchemas': ['KRV_APP', 'KRV_APP']}):
            with self.subTest(value=value), self.assertRaises(AssertionError):
                installed_module.fixture_schemas(value)

    def test_fault_target_is_stream_specific(self):
        first = installed_module.fixture_target_id('00000000-0000-4000-8000-000000000001')
        second = installed_module.fixture_target_id('00000000-0000-4000-8000-000000000002')
        self.assertEqual(len(first), 64)
        self.assertNotEqual(first, second)
        with self.assertRaises((AssertionError, ValueError)):
            installed_module.fixture_target_id('not-a-stream-id')

    def test_wire_clock_stays_exact_above_javascript_integer_limit(self):
        import json
        value = {'connections': [{'pendingCapturedNs': 10**18 + 13, 'upstreamPort': 2485}],
                 'negativeReadStartNs': 10**18 + 7, 'oracleCommitProven': False}
        wire = json.loads(json.dumps(proxy_module.exact_clock_json(value)))
        self.assertEqual(wire['connections'][0]['pendingCapturedNs'], '1000000000000000013')
        self.assertEqual(wire['negativeReadStartNs'], '1000000000000000007')
        self.assertEqual(wire['connections'][0]['upstreamPort'], 2485)
        self.assertIs(wire['oracleCommitProven'], False)

    def fixture(self):
        return [
            [{'ifname': 'lo', 'link_type': 'loopback'},
             {'ifname': 'oracle0', 'linkinfo': {'info_kind': 'dummy'}}],
            [{'ifname': 'lo', 'addr_info': [{'family': 'inet', 'local': '127.0.0.1', 'prefixlen': 8}]},
             {'ifname': 'oracle0', 'addr_info': [{'family': 'inet', 'local': '192.0.2.1', 'prefixlen': 32}]}],
            [{'type': 'local', 'dst': '192.0.2.1', 'dev': 'oracle0', 'table': 'local'}],
        ]

    def test_loopback_and_unconnected_dummy_are_accepted(self):
        data = self.fixture()
        installed_module.require_isolated_network(*data)
        installed_module.require_isolated_network(data[0][:1], data[1][:1], [])

    def test_connected_or_routable_networks_are_refused(self):
        for kind in ('veth', 'bridge', 'tun'):
            data = self.fixture()
            data[0][1]['linkinfo']['info_kind'] = kind
            with self.subTest(kind=kind), self.assertRaises(AssertionError):
                installed_module.require_isolated_network(*data)
        for alteration in (
            {'table': 'main', 'dst': 'default'}, {'gateway': '192.0.2.2'},
            {'nexthops': []}, {'dst': '198.51.100.1'}, {'dev': 'eth0'},
        ):
            data = copy.deepcopy(self.fixture())
            data[2][0].update(alteration)
            with self.subTest(route=alteration), self.assertRaises(AssertionError):
                installed_module.require_isolated_network(*data)

    def test_extra_interfaces_addresses_and_peers_are_refused(self):
        for change in ('interface', 'address', 'peer'):
            data = self.fixture()
            if change == 'interface':
                data[0].append({'ifname': 'eth0'})
            elif change == 'address':
                data[1][1]['addr_info'].append({'family': 'inet', 'local': '192.0.2.2', 'prefixlen': 32})
            else:
                data[0][1]['link_index'] = 4
            with self.subTest(change=change), self.assertRaises(AssertionError):
                installed_module.require_isolated_network(*data)


class AckProxyTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.messages = asyncio.Queue()
        self.clients = []
        self.echo_tasks = set()

        async def echo(reader, writer):
            task = asyncio.current_task()
            self.echo_tasks.add(task)
            try:
                while data := await reader.read(16384):
                    await self.messages.put((writer.get_extra_info('peername')[1], data))
                    writer.write(data)
                    await writer.drain()
            except OSError:
                pass
            finally:
                writer.close()
                await writer.wait_closed()
                self.echo_tasks.discard(task)

        self.upstream = await asyncio.start_server(echo, '127.0.0.1', 0)
        self.proxy = proxy_module.AckProxy(self.upstream.sockets[0].getsockname()[1], .15)
        self.port = await self.proxy.start(0)

    async def asyncTearDown(self):
        for _, writer in self.clients:
            writer.close()
            await writer.wait_closed()
        await self.proxy.close()
        self.upstream.close()
        await self.upstream.wait_closed()
        if self.echo_tasks:
            await asyncio.gather(*list(self.echo_tasks), return_exceptions=True)

    async def client(self):
        pair = await asyncio.open_connection('127.0.0.1', self.port)
        self.clients.append(pair)
        return pair

    async def pending(self, upstream_port):
        async def wait():
            while True:
                self.proxy.pending_changed.clear()
                for connection in self.proxy.snapshot()['connections']:
                    if connection['upstreamPort'] == upstream_port and connection['pendingBytes']:
                        return connection
                await self.proxy.pending_changed.wait()
        return await asyncio.wait_for(wait(), 1)

    async def test_binary_forwarding_preserves_multiple_connections(self):
        self.proxy.pass_responses()
        for payload in [b'\x16\x03\x03\x00\x07opaque\x00', b'other-stream\xff\x00']:
            reader, writer = await self.client()
            writer.write(payload)
            await writer.drain()
            self.assertEqual(await asyncio.wait_for(reader.readexactly(len(payload)), 1), payload)
        self.assertEqual(self.proxy.snapshot()['cuts'], 0)

    async def test_pending_response_is_withheld_once_and_later_connections_pass(self):
        reader, writer = await self.client()
        negative_start = time.monotonic_ns()
        writer.write(b'committed-response-canary')
        await writer.drain()
        port, _ = await asyncio.wait_for(self.messages.get(), 1)
        await self.pending(port)
        proof = self.proxy.cut_pending_response(port, negative_start)
        self.assertFalse(proof['oracleCommitProven'], 'A TCP fixture alone cannot claim Oracle commit')
        self.assertGreater(proof['withheldBytes'], 0)
        self.assertEqual(await asyncio.wait_for(reader.read(), 1), b'')
        with self.assertRaises(proxy_module.FaultWindowMissed):
            self.proxy.cut_pending_response(port, negative_start)
        reader, writer = await self.client()
        writer.write(b'fresh-connection')
        await writer.drain()
        self.assertEqual(await asyncio.wait_for(reader.readexactly(16), 1), b'fresh-connection')
        self.assertEqual(self.proxy.snapshot()['cuts'], 1)

    async def test_forwarded_response_refuses_fault_and_preserves_connection(self):
        self.proxy.pass_responses()
        reader, writer = await self.client()
        old_negative_start = time.monotonic_ns()
        writer.write(b'forwarded')
        await writer.drain()
        port, _ = await asyncio.wait_for(self.messages.get(), 1)
        self.assertEqual(await asyncio.wait_for(reader.readexactly(9), 1), b'forwarded')
        self.proxy.arm(port)
        writer.write(b'pending')
        await writer.drain()
        await self.messages.get()
        await self.pending(port)
        with self.assertRaises(proxy_module.FaultWindowMissed):
            self.proxy.cut_pending_response(port, old_negative_start)
        self.assertEqual(await asyncio.wait_for(reader.readexactly(7), 1), b'pending')
        self.assertEqual(self.proxy.snapshot()['cuts'], 0)

    async def test_selected_cut_preserves_the_other_connection(self):
        first_reader, first_writer = await self.client()
        other_reader, other_writer = await self.client()
        negative_start = time.monotonic_ns()
        first_writer.write(b'ledger')
        await first_writer.drain()
        first_port, payload = await asyncio.wait_for(self.messages.get(), 1)
        self.assertEqual(payload, b'ledger')
        other_writer.write(b'observer')
        await other_writer.drain()
        other_port, _ = await asyncio.wait_for(self.messages.get(), 1)
        self.assertNotEqual(first_port, other_port)
        await self.pending(first_port)
        await self.pending(other_port)
        self.proxy.cut_pending_response(first_port, negative_start)
        self.assertEqual(await asyncio.wait_for(first_reader.read(), 1), b'')
        self.assertEqual(await asyncio.wait_for(other_reader.readexactly(8), 1), b'observer')

    async def test_concurrent_connections_are_bounded_before_upstream_connect(self):
        self.proxy.pass_responses()
        pairs = await asyncio.gather(*(self.client() for _ in range(9)))

        async def probe(pair):
            reader, writer = pair
            try:
                writer.write(b'x')
                await writer.drain()
                return await asyncio.wait_for(reader.read(1), 1)
            except OSError:
                return b''

        replies = await asyncio.gather(*(probe(pair) for pair in pairs))
        self.assertEqual(replies.count(b'x'), 8)
        self.assertEqual(replies.count(b''), 1)
        self.assertEqual(self.proxy.snapshot()['rejected'], 1)


if __name__ == '__main__':
    unittest.main()
