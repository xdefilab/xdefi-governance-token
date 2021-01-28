require('dotenv').config();

const HDWalletProvider = require('@truffle/hdwallet-provider');
const mnemonic = process.env.MNEMONIC;

var kovanProvider = new HDWalletProvider(mnemonic, process.env.RPC_URL_KOVAN);

module.exports = {
    networks: {
        development: {
            host: 'localhost', // Localhost (default: none)
            port: 8545, // Standard Ethereum port (default: none)
            network_id: '*', // Any network (default: none)
            gas: 5800000,
            timeoutBlocks: 200,
        },
        kovan: {
            provider: kovanProvider,
            network_id: 42,       // Ropsten's id
            gas: 5500000,
            gasPrice: '10000000000',
            timeoutBlocks: 200,  // # of blocks before a deployment times out  (minimum/default: 50)
            skipDryRun: true
        },
    },
    // Configure your compilers
    compilers: {
        solc: {
            version: '0.5.17',
            settings: { // See the solidity docs for advice about optimization and evmVersion
                optimizer: {
                    enabled: true,
                    runs: 200,
                }
                //evmVersion: 'byzantium',
            },
        },
    },
};
