import { Contract, Signer } from "ethers"
import * as FactoryAdjustableCompilerOutput from "../abis/FactoryAdjustable201907.json"
import providerFactory from "../provider/providerFactory"
import { FactoryAdjustable201907 as FactoryAdjustable } from "../types/FactoryAdjustable201907"

export const compilerOutput = FactoryAdjustableCompilerOutput

export default async (
    signer: Signer | null = null,
    ensOrAddress?: string
): Promise<FactoryAdjustable> => {
    const provider = await providerFactory()
    const instance = new Contract(ensOrAddress, compilerOutput.abi, provider)
    const signerInstance = signer ? instance.connect(signer) : instance
    return signerInstance as FactoryAdjustable
}
