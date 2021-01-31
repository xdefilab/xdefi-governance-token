#!/bin/sh

source /etc/bashrc

truffle compile --all 

truffle migrate --reset --network development

truffle test test/XDEXTest.js --compile-all --network development

sleep 1s

truffle test test/XHalfLifeTest.js --compile-all --network development

sleep 1s

truffle test test/XdexStreamTest.js --compile-all --network development

sleep 1s

truffle test test/FarmMasterTest.js --compile-all --network development