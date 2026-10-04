#!/bin/bash
# Seed the fixture dataset inside the container (runs once at start).
set -e
mkdir -p /data/nested/deep
echo "hello stratofold" > /data/hello.txt
truncate -s 4294967296 /data/sparse4g.bin
dd if=/dev/urandom of=/data/nested/deep/rand1m.bin bs=1M count=1 status=none
dd if=/dev/urandom of=/data/secret.bin bs=4096 count=1 status=none
chmod 000 /data/secret.bin
