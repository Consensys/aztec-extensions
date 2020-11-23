const config = {
    chain: {
        timestampPrecision: 1,
        network: {
            chainId: 1337,
        },
        wallet: {
            privateKey:
                "0x0000000000000000000000000000000000000000000000000000000000000001",
            nonceInMemory: true,
            gasPrice: "0x0",
            gasLimit: "0x10000000",
        },
        provider: {
            url: "http://localhost:8545",
            pollingInterval: 1,
        },
    },
}

export default config
