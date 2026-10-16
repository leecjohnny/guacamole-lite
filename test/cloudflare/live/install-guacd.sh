#!/bin/sh
set -eu

# Included in the bundle. Run inside the managed Debian Trixie VM as root.
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    libcairo2 libjpeg62-turbo libpng16-16t64 libvncclient1 libssl3t64 libuuid1 \
    tigervnc-standalone-server x11-xserver-utils
cp -a "$(dirname "$0")/rootfs/." /
ldconfig
guacd -v
