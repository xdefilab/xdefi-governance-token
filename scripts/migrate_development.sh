#!/bin/sh

source /etc/bashrc

truffle migrate --compile-all --reset --network development
