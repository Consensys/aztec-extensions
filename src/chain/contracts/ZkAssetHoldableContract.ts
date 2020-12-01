import { Contract, Signer } from "ethers"
import * as zkAssetHoldableCompilerOutput from "../abis/ZkAssetHoldable.json"
import providerFactory from "../provider/providerFactory"
import { ZkAssetHoldable } from "../types"

export const compilerOutput = zkAssetHoldableCompilerOutput

export default async (
    signer: Signer | null = null,
    ensOrAddress?: string
): Promise<ZkAssetHoldable> => {
    const provider = await providerFactory()
    const instance = new Contract(ensOrAddress, compilerOutput.abi, provider)
    const signerInstance = signer ? instance.connect(signer) : instance
    return signerInstance as ZkAssetHoldable
}
