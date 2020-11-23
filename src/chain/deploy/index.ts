import { Contract, ContractFactory, Signer } from "ethers"

export const deploy = async <T extends Contract>(
    signer: Signer,
    compilerOutput: unknown,
    ...args: unknown[]
): Promise<T> => {
    const contractFactory = ContractFactory.fromSolidity(compilerOutput, signer)
    const contract: T = (await contractFactory.deploy(...args)) as T
    return (await contract.deployed()) as T
}
