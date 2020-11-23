module.exports = {
  contracts_directory: "./src/chain/contracts",
  contracts_build_directory: "src/chain/abis",

  // Configure your compilers
  compilers: {
    solc: {
      version: "0.5.17",
      settings: {
        optimizer: {
          enabled: true,
          runs: 200
        },
        evmVersion: "istanbul"
      }
    }
  }
};
