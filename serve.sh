#!/usr/bin/env sh
#
# Serve Wolimons on this machine and on the local network, so other devices
# (phones, tablets) on the same Wi-Fi can open it.
#
#   ./serve.sh          # port 8080
#   ./serve.sh 3000     # some other port
#
# Works in Termux, Linux and macOS. Needs only Python.

set -eu

PORT="${1:-8080}"

# Serve from the repo root whatever directory this was called from - the
# pages use root-absolute paths (/css/..., /assets/...), so the server has
# to be rooted here or everything 404s.
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

# Termux ships `python`; most desktops ship `python3`.
if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "Python isn't installed."
  echo "In Termux:  pkg install -y python"
  exit 1
fi

# This machine's address on the LAN. Opening a UDP socket to a public IP
# makes the OS pick the interface it would route out of, which is the one
# the tablets can reach. Nothing is actually sent.
LAN_IP=$("$PY" - <<'EOF' 2>/dev/null || true
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
try:
    s.connect(("192.0.2.1", 1))       # reserved, never routed
    print(s.getsockname()[0])
except OSError:
    pass                              # no network - stay quiet
finally:
    s.close()
EOF
)

echo
echo "  Wolimons is running."
echo
echo "  On this device:   http://localhost:$PORT/"
if [ -n "$LAN_IP" ]; then
  echo "  On the network:   http://$LAN_IP:$PORT/"
  echo
  echo "  Open that second link on the tablets. They have to be on the"
  echo "  same Wi-Fi as this device."
else
  echo "  On the network:   (couldn't detect an address - are you on Wi-Fi?)"
fi
echo
echo "  Press Ctrl+C to stop."
echo

# Bind all interfaces, not just loopback, so the LAN address works. This is
# python -m http.server's default, but it is set explicitly here so the
# intent survives someone editing this line later.
exec "$PY" -m http.server "$PORT" --bind 0.0.0.0
