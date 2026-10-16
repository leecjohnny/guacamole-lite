#!/bin/sh
set -eu

# Build for the managed Debian Trixie image, independently of the host OS.
output_dir=${1:?Usage: build-guacd.sh OUTPUT_DIRECTORY}
mkdir -p "$output_dir"
output_dir=$(cd "$output_dir" && pwd)
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

docker run --rm -i --platform linux/amd64 \
    -v "$output_dir:/out" \
    -v "$script_dir/install-guacd.sh:/install-guacd.sh:ro" \
    debian:trixie-slim sh -es <<'BUILD'
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    build-essential pkg-config uuid-dev libcairo2-dev libjpeg62-turbo-dev \
    libpng-dev libvncserver-dev libssl-dev libtool-bin curl ca-certificates
mkdir -p /build /bundle/rootfs
cd /build
curl -fsSLO https://downloads.apache.org/guacamole/1.6.0/source/guacamole-server-1.6.0.tar.gz
curl -fsSLO https://downloads.apache.org/guacamole/1.6.0/source/guacamole-server-1.6.0.tar.gz.sha256
sha256sum -c guacamole-server-1.6.0.tar.gz.sha256
tar -xzf guacamole-server-1.6.0.tar.gz
cd guacamole-server-1.6.0
./configure --disable-guacenc --disable-guaclog
make -j2
make install-strip DESTDIR=/bundle/rootfs
cp /install-guacd.sh /bundle/install.sh
tar -C /bundle -czf /out/guacd-1.6.0-debian-trixie-amd64.tar.gz .
chown --reference=/out /out/guacd-1.6.0-debian-trixie-amd64.tar.gz
BUILD
