"""Loopback-only transport fixture for an opt-in disposable Oracle ACK test.

This module knows no Oracle protocol, credentials or SQL. The fixture operator
must independently observe a committed ledger event and supply the start time
of its last negative read. A cut is refused if any response captured since that
read has already been forwarded. Transport evidence alone never proves COMMIT.
"""
import asyncio
from collections import deque
import time


class FaultWindowMissed(Exception):
    """The fixture cannot prove that the response was still withheld."""


def exact_clock_json(value):
    """Keep monotonic nanoseconds exact across Python/JavaScript JSON clients."""
    if isinstance(value, dict):
        return {key: str(item) if key.endswith('Ns') else exact_clock_json(item)
                for key, item in value.items()}
    if isinstance(value, list):
        return [exact_clock_json(item) for item in value]
    return value


class AckProxy:
    def __init__(self, upstream_port=2485, response_delay=.1):
        if not 1 <= upstream_port <= 65535 or not 0 < response_delay <= 1:
            raise ValueError('Invalid loopback transport fixture')
        self.upstream_port = upstream_port
        self.response_delay = response_delay
        self.target_port = None
        self.delay_enabled = True
        self.used = False
        self.server = None
        self.closing = False
        self.sessions = {}
        self.finished = deque(maxlen=16)
        self.tasks = set()
        self.sequence = 0
        self.cuts = 0
        self.rejected = 0
        self.pending_changed = asyncio.Event()

    async def start(self, listen_port=2484):
        if self.server is not None or self.closing or not 0 <= listen_port <= 65535:
            raise ValueError('Transport fixture already started or invalid port')
        self.server = await asyncio.start_server(self._accept, '127.0.0.1', listen_port, limit=65536)
        return self.server.sockets[0].getsockname()[1]

    @staticmethod
    def _record(session):
        return {key: session[key] for key in (
            'id', 'upstreamPort', 'capturedBytes', 'forwardedBytes', 'droppedBytes',
            'pendingBytes', 'pendingCapturedNs', 'lastForwardedCapturedNs', 'closed',
        )}

    def snapshot(self):
        return {'cuts': self.cuts, 'rejected': self.rejected, 'used': self.used,
                'connections': [*self.finished, *(self._record(s) for s in self.sessions.values())]}

    def pass_responses(self):
        self.delay_enabled = False

    def arm(self, upstream_port):
        if self.used or not any(s['upstreamPort'] == upstream_port for s in self.sessions.values()):
            raise FaultWindowMissed('No live selected ledger connection')
        self.target_port = upstream_port
        self.delay_enabled = True

    def cut_pending_response(self, upstream_port, after_ns):
        # No await between checking the proof window and closing the selected
        # stream: forwarding cannot interleave with this decision on the loop.
        found = [s for s in self.sessions.values() if s['upstreamPort'] == upstream_port]
        if self.used or len(found) != 1 or type(after_ns) is not int or not 0 < after_ns <= time.monotonic_ns():
            raise FaultWindowMissed('Invalid or already consumed fault window')
        session = found[0]
        if (session['closed'] or not session['pendingBytes']
                or session['lastForwardedCapturedNs'] >= after_ns
                or session['pendingCapturedNs'] < after_ns):
            raise FaultWindowMissed('A response may already have reached the client')
        proof = {'upstreamPort': upstream_port, 'negativeReadStartNs': after_ns,
                 'pendingCapturedNs': session['pendingCapturedNs'],
                 'lastForwardedCapturedNs': session['lastForwardedCapturedNs'],
                 'withheldBytes': session['pendingBytes'], 'oracleCommitProven': False}
        self.used = True
        self.cuts += 1
        self.delay_enabled = False
        self.target_port = None
        self._disconnect(session)
        return proof

    def _disconnect(self, session):
        if session['closed']:
            return
        session['closed'] = True
        session['droppedBytes'] += session['pendingBytes']
        session['pendingBytes'] = 0
        for writer in session['writers']:
            writer.close()

    async def _copy(self, reader, writer, session, responses):
        while not session['closed']:
            data = await reader.read(16384)
            if not data:
                return
            if responses:
                captured = time.monotonic_ns()
                session['capturedBytes'] += len(data)
                session['pendingBytes'] = len(data)
                session['pendingCapturedNs'] = captured
                self.pending_changed.set()
                if self.delay_enabled and self.target_port in (None, session['upstreamPort']):
                    await asyncio.sleep(self.response_delay)
                if session['closed']:
                    return
                # Treat bytes queued for write as forwarded even before drain.
                # This deliberately prefers a refused fault over a false proof.
                session['lastForwardedCapturedNs'] = captured
                session['forwardedBytes'] += len(data)
                session['pendingBytes'] = 0
            writer.write(data)
            await writer.drain()

    async def _accept(self, client_reader, client_writer):
        task = asyncio.current_task()
        self.tasks.add(task)
        session = None
        upstream_writer = None
        copies = []
        try:
            # Reserve the slot before awaiting the upstream handshake. Counting
            # only connected sessions would let concurrent accepts exceed eight.
            if self.closing or len(self.tasks) > 8:
                self.rejected += 1
                return
            upstream_reader, upstream_writer = await asyncio.wait_for(
                asyncio.open_connection('127.0.0.1', self.upstream_port, limit=65536), 3)
            if self.closing:
                return
            self.sequence += 1
            session = {'id': self.sequence, 'upstreamPort': upstream_writer.get_extra_info('sockname')[1],
                       'capturedBytes': 0, 'forwardedBytes': 0, 'droppedBytes': 0,
                       'pendingBytes': 0, 'pendingCapturedNs': 0, 'lastForwardedCapturedNs': 0,
                       'closed': False, 'writers': [client_writer, upstream_writer]}
            self.sessions[session['id']] = session
            copies = [asyncio.create_task(self._copy(client_reader, upstream_writer, session, False)),
                      asyncio.create_task(self._copy(upstream_reader, client_writer, session, True))]
            await asyncio.wait(copies, return_when=asyncio.FIRST_COMPLETED)
        except (OSError, asyncio.TimeoutError):
            pass
        finally:
            if session is not None:
                self._disconnect(session)
            for copy in copies:
                copy.cancel()
            if copies:
                await asyncio.gather(*copies, return_exceptions=True)
            for writer in [client_writer, upstream_writer]:
                if writer is None:
                    continue
                writer.close()
                try:
                    await writer.wait_closed()
                except OSError:
                    pass
            if session is not None:
                self.finished.append(self._record(session))
                self.sessions.pop(session['id'], None)
            self.tasks.discard(task)

    async def close(self):
        self.closing = True
        if self.server is not None:
            self.server.close()
            await self.server.wait_closed()
        for session in list(self.sessions.values()):
            self._disconnect(session)
        if self.tasks:
            await asyncio.gather(*list(self.tasks), return_exceptions=True)


if __name__ == '__main__':
    raise SystemExit('Use only from the opt-in isolated Oracle fixture runner; no standalone listener is started.')
