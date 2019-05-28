#!/bin/sh
ganache-cli -p 9545 --gasLimit 8000000 --networkId 17 >/dev/null 2>/dev/null &
PID=$!
sleep 1
truffle test || exit 1
kill -9 $PID
