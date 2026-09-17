#!/bin/sh
# One-shot: authorize the deployment automation to SSH in as root on this
# server. Idempotent, safe to re-run. Called via the noVNC console because
# noVNC's keyboard emulation mangles shell operators (&&, @, |) on non-US
# layouts and cannot be trusted to paste an ed25519 public key intact.
set -e

# Clean up empty directories created by an earlier noVNC paste that mangled
# `&&` into `77` and split one shell command into stray `mkdir` arguments.
cd /root
for d in 77 chmod 700 echo; do
  if [ -d "$d" ]; then
    rmdir "$d" 2>/dev/null || true
  fi
done
find /root -maxdepth 1 -type d -name 'ssh-ed25519 *' -empty -delete 2>/dev/null || true

mkdir -p /root/.ssh
chmod 700 /root/.ssh

KEY='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKrsK40Mwup7vo5X5uwiH8fHJ1jZRWfkkFUzTbArXfNJ droid@tin'
if [ -f /root/.ssh/authorized_keys ] && grep -qxF "$KEY" /root/.ssh/authorized_keys; then
  :
else
  echo "$KEY" >> /root/.ssh/authorized_keys
fi
chmod 600 /root/.ssh/authorized_keys

echo OK
