import { Contract, Signer } from "ethers"
import * as ZkAssetConditionalOutput from "../abis/ZkAssetConditional.json"
import providerFactory from "../provider/providerFactory"
import { ZkAssetConditional } from "../types/ZkAssetConditional"

export const compilerOutput = ZkAssetConditionalOutput

export default async (
    signer: Signer | null = null,
    ensOrAddress?: string
): Promise<ZkAssetConditional> => {
    const provider = await providerFactory()
    const instance = new Contract(ensOrAddress, compilerOutput.abi, provider)
    const signerInstance = signer ? instance.connect(signer) : instance
    return signerInstance as ZkAssetConditional
}
