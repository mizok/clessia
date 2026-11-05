#!/bin/bash
# r.sh <name> <js>   或  r.sh new '<json>'
if [ "$1" = new ]; then curl -s -XPOST 127.0.0.1:9496/new --data "$2"; else curl -s -XPOST "127.0.0.1:9496/run?name=$1" --data-binary "$2"; fi; echo
