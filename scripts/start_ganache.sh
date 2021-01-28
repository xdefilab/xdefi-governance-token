#!/bin/sh

source /etc/bashrc

BIN=ganache-cli

res=`ps aux | grep ${BIN} | grep -v grep | awk '{print $2}'`
if [ "$res" == "" ]; then
  echo "the ${BIN} is not running, begin startup..."
else
  echo 'current running pid is '$res', begin to stopping...'

  kill -9 `ps aux | grep ${BIN} |egrep -v "grep"|awk '{print $2}'` && sleep 1s && echo -e "${BIN} killed successfully"
fi

ganache-cli --chainId="0x2a" --networkId="0x2a" --port="8545" --mnemonic "copy obey episode awake damp vacant protect hold wish primary travel shy" --gasLimit=3000000000000 --gasPrice=20000

