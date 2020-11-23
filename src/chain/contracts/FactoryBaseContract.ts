import { Contract, Signer } from "ethers"
import * as FactoryBaseCompilerOutput from "../abis/FactoryBase201907.json"
import providerFactory from "../provider/providerFactory"
import { FactoryBase201907 as FactoryBase } from "../types/FactoryBase201907"

export const compilerOutput = FactoryBaseCompilerOutput

export default async (
    signer: Signer | null = null,
    ensOrAddress?: string
): Promise<FactoryBase> => {
    const provider = await providerFactory()
    const instance = new Contract(ensOrAddress, compilerOutput.abi, provider)
    const signerInstance = signer ? instance.connect(signer) : instance
    return signerInstance as FactoryBase
}
