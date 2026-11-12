//! PID 1 never restarts a role or a job. It reaps adopted descendants and stops
//! both process groups if startup fails, either role exits, or a signal arrives.
use crate::{API_READY, Result, Unavailable};
use nix::{
    errno::Errno,
    sys::{
        signal::{Signal, kill, killpg},
        wait::{WaitPidFlag, WaitStatus, waitpid},
    },
    unistd::Pid,
};
use std::{
    io::{Read, Write},
    process::{ChildStdin, ChildStdout},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, TryRecvError},
    },
    time::{Duration, Instant},
};
#[derive(Clone, Copy)]
pub struct Limits {
    pub startup: Duration,
    pub terminate: Duration,
    pub reap: Duration,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            startup: Duration::from_secs(25),
            terminate: Duration::from_secs(25),
            reap: Duration::from_secs(5),
        }
    }
}
enum Event {
    Ready,
    Closed,
    Invalid,
}
pub struct Startup {
    events: Receiver<Event>,
    worker: Option<ChildStdin>,
    ready: bool,
}
impl Startup {
    /// Call only after the root thread has dropped all capabilities but KILL;
    /// this reader thread must inherit the same restricted capabilities.
    pub fn new(mut api: ChildStdout, worker: ChildStdin) -> Self {
        let (send, events) = mpsc::sync_channel(2);
        std::thread::spawn(move || {
            let mut expected = vec![0; API_READY.len()];
            if api.read_exact(&mut expected).is_err() || expected != API_READY {
                let _ = send.send(Event::Invalid);
                return;
            }
            if send.send(Event::Ready).is_err() {
                return;
            }
            let mut extra = [0];
            let event = if matches!(api.read(&mut extra), Ok(0)) {
                Event::Closed
            } else {
                Event::Invalid
            };
            let _ = send.send(event);
        });
        Self {
            events,
            worker: Some(worker),
            ready: false,
        }
    }
    fn poll(&mut self, stopped: bool) -> Result<()> {
        loop {
            match self.events.try_recv() {
                Ok(Event::Ready) if !self.ready && !stopped => {
                    self.worker
                        .take()
                        .ok_or(Unavailable)?
                        .write_all(&[1])
                        .map_err(|_| Unavailable)?;
                    self.ready = true;
                }
                Ok(_) if stopped => {
                    self.worker.take();
                }
                Ok(_) => return Err(Unavailable),
                Err(TryRecvError::Empty) => return Ok(()),
                Err(TryRecvError::Disconnected) if stopped => return Ok(()),
                Err(TryRecvError::Disconnected) => return Err(Unavailable),
            }
        }
    }
}
pub fn stop_flag() -> Result<Arc<AtomicBool>> {
    let stop = Arc::new(AtomicBool::new(false));
    for signal in [libc::SIGTERM, libc::SIGINT] {
        signal_hook::flag::register(signal, stop.clone()).map_err(|_| Unavailable)?;
    }
    Ok(stop)
}
fn signal_roles(roles: [Pid; 2], signal: Signal) {
    for pid in roles {
        // A role may not yet have reached setsid when startup is cancelled.
        let _ = killpg(pid, signal);
        let _ = kill(pid, signal);
    }
    // Subreaping also adopts descendants which escaped the original group.
    // Read only this process's direct children; never enumerate other services.
    if let Ok(children) =
        std::fs::read_to_string(format!("/proc/self/task/{}/children", std::process::id()))
    {
        for pid in children
            .split_whitespace()
            .filter_map(|p| p.parse::<i32>().ok())
        {
            if pid > 1 {
                let _ = kill(Pid::from_raw(pid), signal);
            }
        }
    }
}
pub fn run(
    roles: [Pid; 2],
    stop: Arc<AtomicBool>,
    mut startup: Option<Startup>,
    limits: Limits,
) -> Result<()> {
    let started = Instant::now();
    let mut failed = false;
    let mut stopping = None;
    let mut killed = None;
    let mut main_alive = [true; 2];
    loop {
        let external_stop = stop.load(Ordering::Relaxed);
        loop {
            match waitpid(Pid::from_raw(-1), Some(WaitPidFlag::WNOHANG)) {
                Ok(WaitStatus::StillAlive) => break,
                Ok(status @ (WaitStatus::Exited(_, _) | WaitStatus::Signaled(_, _, _))) => {
                    if let Some(i) = roles.iter().position(|p| Some(*p) == status.pid()) {
                        main_alive[i] = false;
                        if !external_stop || !matches!(status, WaitStatus::Exited(_, 0)) {
                            failed = true;
                        }
                        stop.store(true, Ordering::Relaxed);
                    }
                }
                Ok(_) => {}
                Err(Errno::EINTR) => continue,
                Err(Errno::ECHILD) => {
                    return if !failed
                        && !main_alive.iter().any(|a| *a)
                        && stop.load(Ordering::Relaxed)
                    {
                        Ok(())
                    } else {
                        Err(Unavailable)
                    };
                }
                Err(_) => {
                    failed = true;
                    stop.store(true, Ordering::Relaxed);
                    break;
                }
            }
        }
        let stopped = stop.load(Ordering::Relaxed);
        if let Some(handshake) = startup.as_mut()
            && (handshake.poll(stopped).is_err()
                || !handshake.ready && started.elapsed() >= limits.startup)
        {
            failed = true;
            stop.store(true, Ordering::Relaxed);
        }
        if stop.load(Ordering::Relaxed) && stopping.is_none() {
            if let Some(handshake) = startup.as_mut() {
                handshake.worker.take();
            }
            signal_roles(roles, Signal::SIGTERM);
            stopping = Some(Instant::now());
        }
        if stopping.is_some_and(|t| t.elapsed() >= limits.terminate) && killed.is_none() {
            failed = true;
            signal_roles(roles, Signal::SIGKILL);
            killed = Some(Instant::now());
        }
        if let Some(since) = killed {
            signal_roles(roles, Signal::SIGKILL);
            if since.elapsed() >= limits.reap {
                return Err(Unavailable);
            }
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}
