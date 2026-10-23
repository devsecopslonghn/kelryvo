/* Kelryvo Linux container bootstrap and PID 1. No shell, network listener or restart loop. */
#define _GNU_SOURCE
#include <errno.h>
#include <grp.h>
#include <linux/capability.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#ifndef KELRYVO_ROOT
#define KELRYVO_ROOT "/opt/kelryvo"
#endif
#ifndef KELRYVO_NODE
#define KELRYVO_NODE "/usr/local/bin/node"
#endif

static volatile sig_atomic_t stopping = 0;
static void stop(int signal_number) { (void)signal_number; stopping = 1; }
static long milliseconds(void) {
  struct timespec now;
  if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) _exit(1);
  return now.tv_sec * 1000L + now.tv_nsec / 1000000L;
}
static void fail(void) {
  fputs("Kelryvo runtime unavailable.\n", stderr);
  exit(1);
}
static void capabilities(unsigned int effective) {
  struct __user_cap_header_struct header = { _LINUX_CAPABILITY_VERSION_3, 0 };
  struct __user_cap_data_struct data[2] = {{0}, {0}};
  data[0].effective = effective;
  data[0].permitted = effective;
  if (syscall(SYS_capset, &header, data) != 0) _exit(1);
}
static void sanitize_environment(void) {
  const char *keys[] = {"KELRYVO_SECRET_DIR", "KELRYVO_INSTALLATION_DIR", "KELRYVO_BIND_HOST", "KELRYVO_PORT",
    "KELRYVO_EXECUTION_ENABLED", "KELRYVO_DISCOVERY_ENABLED", "SCHEMAFORGE_JAVA_HOME", NULL};
  char *values[8] = {0};
  for (int i = 0; keys[i]; i++) {
    const char *value = getenv(keys[i]);
    if (value && (strlen(value) > 4096 || !(values[i] = strdup(value)))) fail();
  }
  if (clearenv() != 0) fail();
  for (int i = 0; keys[i]; i++) if (values[i]) {
    if (setenv(keys[i], values[i], 1) != 0) fail();
    free(values[i]);
  }
  if (setenv("PATH", "/usr/local/bin:/usr/bin:/bin", 1) || setenv("LANG", "C", 1)
      || setenv("TZ", "UTC", 1) || setenv("NODE_ENV", "production", 1)) fail();
}
static int prepare(int api_only) {
  pid_t child = fork();
  if (child < 0) return 1;
  if (child == 0) {
    if (api_only) execl(KELRYVO_NODE, "node", "apps/runtime/bootstrap.mjs", "--api-only", (char *)NULL);
    else execl(KELRYVO_NODE, "node", "apps/runtime/bootstrap.mjs", (char *)NULL);
    _exit(1);
  }
  long deadline = milliseconds() + 25000;
  for (;;) {
    int status = 0;
    pid_t ended = waitpid(child, &status, WNOHANG);
    if (ended == child) return WIFEXITED(status) && WEXITSTATUS(status) == 0 ? 0 : 1;
    if (ended < 0 && errno != EINTR) return 1;
    if (stopping || milliseconds() >= deadline) {
      kill(child, SIGKILL);
      while (waitpid(child, &status, 0) < 0 && errno == EINTR) {}
      return 1;
    }
    usleep(10000);
  }
}
static pid_t launch(const char *entry, uid_t uid, int own_fd, int other_fd, int ready_fd, int other_ready_fd) {
  pid_t child = fork();
  if (child != 0) return child;
  if (setsid() < 0) _exit(1);
  close(other_fd);
  close(other_ready_fd);
  if (own_fd != 3) { if (dup2(own_fd, 3) < 0) _exit(1); close(own_fd); }
  if (dup2(ready_fd, 4) < 0) _exit(1);
  close(ready_fd);
  if (setgroups(0, NULL) || setgid(uid) || setuid(uid)) _exit(1);
  capabilities(0);
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) _exit(1);
  unsetenv("KELRYVO_INSTALLATION_DIR");
  if (setenv("KELRYVO_SECRET_DIR", "/run/kelryvo/runtime/api/secrets", 1)) _exit(1);
  if (setenv("KELRYVO_READY_FD", "4", 1)) _exit(1);
  if (uid == 10001) {
    unsetenv("KELRYVO_EXECUTION_ENABLED"); unsetenv("KELRYVO_DISCOVERY_ENABLED");
    if (setenv("KELRYVO_DISCOVERY_FD", "3", 1)) _exit(1);
  } else unsetenv("KELRYVO_SECRET_DIR");
  execl(KELRYVO_NODE, "node", entry, (char *)NULL);
  _exit(1);
}

int main(int argc, char **argv) {
  int api_only = argc == 2 && strcmp(argv[1], "--prepare") == 0;
  if (getuid() != 0 || (argc != 1 && !api_only) || chdir(KELRYVO_ROOT)) fail();
  struct rlimit no_core = {0, 0};
  if (setrlimit(RLIMIT_CORE, &no_core) || prctl(PR_SET_DUMPABLE, 0) || prctl(PR_SET_CHILD_SUBREAPER, 1)) fail();
  sanitize_environment();
  struct sigaction action = {0};
  action.sa_handler = stop;
  sigemptyset(&action.sa_mask);
  if (sigaction(SIGTERM, &action, NULL) || sigaction(SIGINT, &action, NULL)) fail();
  if (prepare(api_only)) fail();
  if (api_only) return 0;
  int channel[2];
  if (socketpair(AF_UNIX, SOCK_STREAM, 0, channel)) fail();
  int ready[2];
  if (pipe(ready)) fail();
  pid_t execution = launch("apps/runtime/execution-main.mjs", 10002, channel[1], channel[0], ready[0], ready[1]);
  if (execution < 0) fail();
  pid_t api = launch("apps/api/container-main.mjs", 10001, channel[0], channel[1], ready[1], ready[0]);
  close(channel[0]); close(channel[1]);
  close(ready[0]); close(ready[1]);
  if (api < 0) { kill(-execution, SIGKILL); fail(); }
  // Neither metadata/Oracle credentials nor privilege to launch another user is needed by PID 1.
  unsetenv("KELRYVO_SECRET_DIR"); unsetenv("KELRYVO_INSTALLATION_DIR");
  capabilities(1U << CAP_KILL);
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) { kill(-api, SIGKILL); kill(-execution, SIGKILL); fail(); }
  int failed = 0, api_alive = 1, execution_alive = 1, sent = 0;
  long deadline = 0;
  for (;;) {
    int status = 0;
    pid_t ended;
    while ((ended = waitpid(-1, &status, WNOHANG)) > 0) {
      if (ended == api || ended == execution) {
        if (!stopping || !WIFEXITED(status) || WEXITSTATUS(status) != 0) failed = 1;
        if (ended == api) api_alive = 0;
        if (ended == execution) execution_alive = 0;
        stopping = 1;
      }
    }
    if (ended < 0 && errno == ECHILD) break;
    if (stopping && !sent) {
      // Both groups include their supervised descendants. Never restart a child or replay a job.
      kill(-api, SIGTERM); kill(-execution, SIGTERM);
      sent = 1; deadline = milliseconds() + 25000;
    }
    if (sent && milliseconds() >= deadline) {
      kill(-api, SIGKILL); kill(-execution, SIGKILL);
      failed = 1;
      // Container termination kills any session-escaping descendants; metadata remains ambiguous.
      if (api_alive || execution_alive) usleep(10000);
      break;
    }
    usleep(10000);
  }
  if (failed) fputs("Kelryvo runtime stopped; inspect retained history before further execution.\n", stderr);
  return failed ? 1 : 0;
}
